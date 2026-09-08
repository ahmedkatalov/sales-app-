package main

import (
	"database/sql"
	"fmt"
	"github.com/gin-gonic/gin"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// customerOutstanding — текущий остаток долга клиента: сумма открытых долгов
// минус сумма всех его платежей. Может уйти в ≤0, если долг полностью погашен.
func customerOutstanding(accID, customerID int) float64 {
	var open, paid float64
	_ = db.QueryRow(`SELECT IFNULL(SUM(amount),0) FROM debts WHERE account_id=? AND customer_id=? AND status='open'`, accID, customerID).Scan(&open)
	_ = db.QueryRow(`SELECT IFNULL(SUM(amount),0) FROM debt_payments WHERE account_id=? AND customer_id=?`, accID, customerID).Scan(&paid)
	return open - paid
}

func ensureDebtCustomer(accountID int, name string) (int, error) {
	clean := strings.TrimSpace(name)
	var id int
	err := db.QueryRow(`SELECT id FROM debt_customers WHERE account_id = ? AND lower(name) = lower(?) ORDER BY id DESC LIMIT 1`, accountID, clean).Scan(&id)
	if err == nil {
		return id, nil
	}
	res, err := db.Exec(`INSERT INTO debt_customers(account_id, name, created_at) VALUES(?, ?, ?)`, accountID, clean, time.Now().Format(time.RFC3339))
	if err != nil {
		return 0, err
	}
	newID, _ := res.LastInsertId()
	return int(newID), nil
}

func ensureDebtCustomerTx(tx *sql.Tx, accountID int, name string, now string) (int, error) {
	clean := strings.TrimSpace(name)
	var id int
	err := tx.QueryRow(`SELECT id FROM debt_customers WHERE account_id = ? AND lower(name) = lower(?) ORDER BY id DESC LIMIT 1`, accountID, clean).Scan(&id)
	if err == nil {
		return id, nil
	}
	if err != sql.ErrNoRows {
		return 0, err
	}
	res, err := tx.Exec(`INSERT INTO debt_customers(account_id, name, created_at) VALUES(?, ?, ?)`, accountID, clean, now)
	if err != nil {
		return 0, err
	}
	newID, _ := res.LastInsertId()
	return int(newID), nil
}

func getDebtCustomers(c *gin.Context) {
	accountID := accountID(c)
	// Остаток = открытые долги − платежи (частичные погашения). Подзапросы, а не
	// LEFT JOIN обеих таблиц — иначе строки размножатся и суммы задвоятся.
	rows, err := db.Query(`SELECT dc.id, dc.account_id, dc.name, dc.created_at,
		IFNULL((SELECT SUM(d.amount) FROM debts d WHERE d.customer_id=dc.id AND d.account_id=dc.account_id AND d.status='open'),0)
		- IFNULL((SELECT SUM(p.amount) FROM debt_payments p WHERE p.customer_id=dc.id AND p.account_id=dc.account_id),0)
		FROM debt_customers dc WHERE dc.account_id = ? ORDER BY dc.name`, accountID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	list := []DebtCustomer{}
	for rows.Next() {
		var x DebtCustomer
		rows.Scan(&x.ID, &x.AccountID, &x.Name, &x.CreatedAt, &x.DebtTotal)
		if x.DebtTotal < 0 {
			x.DebtTotal = 0
		}
		list = append(list, x)
	}
	c.JSON(http.StatusOK, list)
}

// GET /debt-payments — журнал погашений долгов (для истории и отмены).
func getDebtPayments(c *gin.Context) {
	accID := accountID(c)
	rows, err := db.Query(`SELECT id, account_id, customer_id, amount, IFNULL(method,'cash'), IFNULL(note,''), IFNULL(created_by,''), IFNULL(created_at,'') FROM debt_payments WHERE account_id=? ORDER BY id DESC`, accID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	list := []DebtPayment{}
	for rows.Next() {
		var x DebtPayment
		rows.Scan(&x.ID, &x.AccountID, &x.CustomerID, &x.Amount, &x.Method, &x.Note, &x.CreatedBy, &x.CreatedAt)
		list = append(list, x)
	}
	c.JSON(http.StatusOK, list)
}

// POST /debt-payments — записать погашение долга клиента (частичное/полное),
// наличными или переводом, на выбранную дату. Наличные попадают в кассу.
func createDebtPayment(c *gin.Context) {
	accID := accountID(c)
	var req struct {
		CustomerID int     `json:"customerId"`
		Amount     float64 `json:"amount"`
		Method     string  `json:"method"`
		Note       string  `json:"note"`
		Date       string  `json:"date"`
		By         string  `json:"by"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.CustomerID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Не указан клиент"})
		return
	}
	if req.Amount <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Сумма должна быть больше нуля"})
		return
	}
	method := strings.ToLower(strings.TrimSpace(req.Method))
	if method != "transfer" {
		method = "cash"
	}
	outstanding := customerOutstanding(accID, req.CustomerID)
	if outstanding <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Долг уже погашен"})
		return
	}
	// Защита от переплаты (копеечный допуск на округления).
	if req.Amount > outstanding+0.5 {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Сумма больше остатка долга (%.0f)", outstanding)})
		return
	}
	// Явная прошедшая дата → полдень того дня (для финотчёта по датам). Без даты —
	// текущий момент, чтобы платёж попал в открытую смену «здесь и сейчас».
	createdAt := time.Now().Format(time.RFC3339)
	if d := strings.TrimSpace(req.Date); len(d) == 10 {
		createdAt = d + "T12:00:00Z"
	}
	res, err := db.Exec(`INSERT INTO debt_payments(account_id, customer_id, amount, method, note, created_by, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)`,
		accID, req.CustomerID, req.Amount, method, strings.TrimSpace(req.Note), strings.TrimSpace(req.By), createdAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	id, _ := res.LastInsertId()
	c.JSON(http.StatusOK, gin.H{"ok": true, "id": id})
}

// DELETE /debt-payments/:id — отменить погашение (безопасно: удаляем строку
// платежа, долг снова становится открытым на эту сумму, касса откатывается).
func deleteDebtPayment(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if _, err := db.Exec(`DELETE FROM debt_payments WHERE id=? AND account_id=?`, id, accountID(c)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func getDebts(c *gin.Context) {
	accountID := accountID(c)
	rows, err := db.Query(`SELECT d.id, d.account_id, d.customer_id, dc.name, d.sale_id, d.amount, d.status, d.created_at, IFNULL(d.paid_at,'') FROM debts d LEFT JOIN debt_customers dc ON dc.id = d.customer_id WHERE d.account_id = ? ORDER BY d.id DESC`, accountID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	list := []DebtRecord{}
	for rows.Next() {
		var x DebtRecord
		rows.Scan(&x.ID, &x.AccountID, &x.CustomerID, &x.CustomerName, &x.SaleID, &x.Amount, &x.Status, &x.CreatedAt, &x.PaidAt)
		list = append(list, x)
	}
	// Закрываем rows до getSaleItems (вложенные запросы) — иначе дедлок при SetMaxOpenConns(1).
	rows.Close()
	for i := range list {
		list[i].Items = getSaleItems(list[i].SaleID)
	}
	c.JSON(http.StatusOK, list)
}

// POST /debts/:id/close — быстрое «оплатил эту строку»: записывает наличное
// погашение на сумму строки (с обрезкой по остатку клиента). Не переводит строку
// в 'paid' — единый источник правды теперь журнал debt_payments.
func closeDebt(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	accID := accountID(c)
	var customerID int
	var amount float64
	if err := db.QueryRow(`SELECT customer_id, amount FROM debts WHERE id=? AND account_id=?`, id, accID).Scan(&customerID, &amount); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Долг не найден"})
		return
	}
	pay := amount
	if out := customerOutstanding(accID, customerID); pay > out {
		pay = out
	}
	if pay <= 0 {
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	}
	if _, err := db.Exec(`INSERT INTO debt_payments(account_id, customer_id, amount, method, note, created_by, created_at) VALUES(?, ?, ?, 'cash', '', '', ?)`,
		accID, customerID, pay, time.Now().Format(time.RFC3339)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// DELETE /debts/history — очистить погашенную историю: удаляем долги и платежи
// клиентов, чей долг полностью закрыт (остаток ≤ 0). Открытые долги остаются.
func clearDebtHistory(c *gin.Context) {
	accID := accountID(c)
	rows, err := db.Query(`SELECT dc.id FROM debt_customers dc WHERE dc.account_id=? AND
		IFNULL((SELECT SUM(d.amount) FROM debts d WHERE d.customer_id=dc.id AND d.account_id=dc.account_id AND d.status='open'),0)
		- IFNULL((SELECT SUM(p.amount) FROM debt_payments p WHERE p.customer_id=dc.id AND p.account_id=dc.account_id),0) <= 0`, accID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	ids := []int{}
	for rows.Next() {
		var id int
		rows.Scan(&id)
		ids = append(ids, id)
	}
	rows.Close() // закрываем до Exec: при SetMaxOpenConns(1) вложенная запись = дедлок
	for _, cid := range ids {
		db.Exec(`DELETE FROM debts WHERE account_id=? AND customer_id=?`, accID, cid)
		db.Exec(`DELETE FROM debt_payments WHERE account_id=? AND customer_id=?`, accID, cid)
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
