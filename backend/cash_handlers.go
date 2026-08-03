package main

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// Денежная касса (смена). Закрывает реальный сценарий «почему в кассе вот столько»:
// открываешь смену с разменом → система копит продажи налом и ручные внесения/изъятия →
// на закрытии вводишь фактически пересчитанные деньги → видно недостачу/излишек.

// computeShiftCash считает движение наличных за смену:
// продажи налом + ручные внесения − изъятия − расходы, оплаченные из кассы.
func computeShiftCash(accID, shiftID int, openedAt, closedAt string) (cashSales, cashIn, cashOut, cashExpenses, ownerCash float64) {
	salesQuery := `SELECT IFNULL(SUM(total),0) FROM sales WHERE account_id=? AND payment_type='cash' AND created_at >= ?`
	args := []any{accID, openedAt}
	if strings.TrimSpace(closedAt) != "" {
		salesQuery += ` AND created_at <= ?`
		args = append(args, closedAt)
	}
	_ = db.QueryRow(salesQuery, args...).Scan(&cashSales)

	_ = db.QueryRow(`SELECT IFNULL(SUM(amount),0) FROM cash_movements WHERE account_id=? AND shift_id=? AND type='in'`, accID, shiftID).Scan(&cashIn)
	_ = db.QueryRow(`SELECT IFNULL(SUM(amount),0) FROM cash_movements WHERE account_id=? AND shift_id=? AND type='out'`, accID, shiftID).Scan(&cashOut)

	// Расходы, оплаченные ИЗ КАССЫ за период смены — тоже уменьшают ожидаемую наличность.
	// (Расходы 'owner'/'card' кассу не трогают.)
	expQuery := `SELECT IFNULL(SUM(amount),0) FROM global_expenses WHERE account_id=? AND IFNULL(payment_source,'cash')='cash' AND created_at >= ?`
	expArgs := []any{accID, openedAt}
	if strings.TrimSpace(closedAt) != "" {
		expQuery += ` AND created_at <= ?`
		expArgs = append(expArgs, closedAt)
	}
	_ = db.QueryRow(expQuery, expArgs...).Scan(&cashExpenses)

	// Расчёты с владельцем за период смены: вклад +нал, возврат/изъятие −нал.
	ownerQuery := `SELECT IFNULL(SUM(CASE WHEN kind='contribution' THEN amount ELSE -amount END),0) FROM owner_ledger WHERE account_id=? AND created_at >= ?`
	ownerArgs := []any{accID, openedAt}
	if strings.TrimSpace(closedAt) != "" {
		ownerQuery += ` AND created_at <= ?`
		ownerArgs = append(ownerArgs, closedAt)
	}
	_ = db.QueryRow(ownerQuery, ownerArgs...).Scan(&ownerCash)
	return
}

type cashShiftView struct {
	ID          int     `json:"id"`
	Status      string  `json:"status"`
	OpeningCash float64 `json:"openingCash"`
	OpenedBy    string  `json:"openedBy"`
	OpenedAt    string  `json:"openedAt"`
	ClosedBy    string  `json:"closedBy"`
	ClosedAt    string  `json:"closedAt"`
	CashSales    float64 `json:"cashSales"`
	CashIn       float64 `json:"cashIn"`
	CashOut      float64 `json:"cashOut"`
	CashExpenses float64 `json:"cashExpenses"` // расходы, оплаченные из кассы за смену
	OwnerCash    float64 `json:"ownerCash"`    // расчёты с владельцем (вклад +, возврат/изъятие −) за смену
	Expected     float64 `json:"expectedCash"`
	Counted     float64 `json:"countedCash"`
	Difference  float64 `json:"difference"`
	Note        string  `json:"note"`
}

func loadOpenShift(accID int) (*cashShiftView, bool) {
	var s cashShiftView
	err := db.QueryRow(`
		SELECT id, status, opening_cash, IFNULL(opened_by,''), IFNULL(opened_at,''), IFNULL(note,'')
		FROM cash_shifts WHERE account_id=? AND status='open' ORDER BY id DESC LIMIT 1
	`, accID).Scan(&s.ID, &s.Status, &s.OpeningCash, &s.OpenedBy, &s.OpenedAt, &s.Note)
	if err != nil {
		return nil, false
	}
	s.CashSales, s.CashIn, s.CashOut, s.CashExpenses, s.OwnerCash = computeShiftCash(accID, s.ID, s.OpenedAt, "")
	s.Expected = s.OpeningCash + s.CashSales + s.CashIn - s.CashOut - s.CashExpenses + s.OwnerCash
	return &s, true
}

// GET /cash/shift/current — текущая открытая смена с живым расчётом ожидаемой наличности
func getCurrentCashShift(c *gin.Context) {
	accID := accountID(c)
	s, ok := loadOpenShift(accID)
	if !ok {
		c.JSON(http.StatusOK, gin.H{"open": false})
		return
	}
	c.JSON(http.StatusOK, gin.H{"open": true, "shift": s})
}

// POST /cash/shift/open — открыть смену с разменом
func openCashShift(c *gin.Context) {
	accID := accountID(c)
	var req struct {
		OpeningCash float64 `json:"openingCash"`
		OpenedBy    string  `json:"openedBy"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if _, ok := loadOpenShift(accID); ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Смена уже открыта. Сначала закрой текущую."})
		return
	}
	if req.OpeningCash < 0 {
		req.OpeningCash = 0
	}
	now := time.Now().Format(time.RFC3339)
	res, err := db.Exec(`
		INSERT INTO cash_shifts(account_id, status, opening_cash, opened_by, opened_at)
		VALUES(?, 'open', ?, ?, ?)
	`, accID, req.OpeningCash, strings.TrimSpace(req.OpenedBy), now)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	id, _ := res.LastInsertId()
	s, _ := loadOpenShift(accID)
	c.JSON(http.StatusOK, gin.H{"open": true, "shift": s, "id": id})
}

// POST /cash/movement — ручное внесение/изъятие наличных в текущую смену
func addCashMovement(c *gin.Context) {
	accID := accountID(c)
	var req struct {
		Type   string  `json:"type"` // in | out
		Amount float64 `json:"amount"`
		Note   string  `json:"note"`
		By     string  `json:"by"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Type != "in" && req.Type != "out" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Тип должен быть in или out"})
		return
	}
	if req.Amount <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Сумма должна быть больше нуля"})
		return
	}
	s, ok := loadOpenShift(accID)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Нет открытой смены. Сначала открой кассу."})
		return
	}
	now := time.Now().Format(time.RFC3339)
	if _, err := db.Exec(`
		INSERT INTO cash_movements(account_id, shift_id, type, amount, note, created_by, created_at)
		VALUES(?, ?, ?, ?, ?, ?, ?)
	`, accID, s.ID, req.Type, req.Amount, strings.TrimSpace(req.Note), strings.TrimSpace(req.By), now); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	updated, _ := loadOpenShift(accID)
	c.JSON(http.StatusOK, gin.H{"open": true, "shift": updated})
}

// POST /cash/shift/close — закрыть смену с фактическим пересчётом наличных
func closeCashShift(c *gin.Context) {
	accID := accountID(c)
	var req struct {
		CountedCash float64 `json:"countedCash"`
		ClosedBy    string  `json:"closedBy"`
		Note        string  `json:"note"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	s, ok := loadOpenShift(accID)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Нет открытой смены"})
		return
	}
	if req.CountedCash < 0 {
		req.CountedCash = 0
	}
	now := time.Now().Format(time.RFC3339)
	// Фиксируем итоги на момент закрытия
	cashSales, cashIn, cashOut, cashExpenses, ownerCash := computeShiftCash(accID, s.ID, s.OpenedAt, now)
	expected := s.OpeningCash + cashSales + cashIn - cashOut - cashExpenses + ownerCash
	difference := req.CountedCash - expected

	if _, err := db.Exec(`
		UPDATE cash_shifts SET
			status='closed', closed_by=?, closed_at=?,
			cash_sales=?, cash_in=?, cash_out=?, cash_expenses=?, expected_cash=?, counted_cash=?, difference=?, note=?
		WHERE id=? AND account_id=?
	`, strings.TrimSpace(req.ClosedBy), now, cashSales, cashIn, cashOut, cashExpenses, expected, req.CountedCash, difference,
		strings.TrimSpace(req.Note), s.ID, accID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"open":         false,
		"expectedCash": expected,
		"countedCash":  req.CountedCash,
		"difference":   difference,
		"cashSales":    cashSales,
		"cashIn":       cashIn,
		"cashOut":      cashOut,
		"cashExpenses": cashExpenses,
		"ownerCash":    ownerCash,
		"openingCash":  s.OpeningCash,
	})
}

// GET /cash/shifts — история закрытых смен
func listCashShifts(c *gin.Context) {
	accID := accountID(c)
	rows, err := db.Query(`
		SELECT id, status, opening_cash, IFNULL(opened_by,''), IFNULL(opened_at,''), IFNULL(closed_by,''), IFNULL(closed_at,''),
		       cash_sales, cash_in, cash_out, IFNULL(cash_expenses,0), expected_cash, counted_cash, difference, IFNULL(note,'')
		FROM cash_shifts WHERE account_id=? AND status='closed' ORDER BY id DESC LIMIT 60
	`, accID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	list := []cashShiftView{}
	for rows.Next() {
		var s cashShiftView
		if rows.Scan(&s.ID, &s.Status, &s.OpeningCash, &s.OpenedBy, &s.OpenedAt, &s.ClosedBy, &s.ClosedAt,
			&s.CashSales, &s.CashIn, &s.CashOut, &s.CashExpenses, &s.Expected, &s.Counted, &s.Difference, &s.Note) == nil {
			list = append(list, s)
		}
	}
	c.JSON(http.StatusOK, list)
}
