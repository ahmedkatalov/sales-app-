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
		// Новый долг возвращает клиента в список, даже если его раньше «убрали».
		db.Exec(`UPDATE debt_customers SET archived=0 WHERE id=? AND account_id=?`, id, accountID)
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
		// Новый долг возвращает клиента в список, даже если его раньше «убрали».
		tx.Exec(`UPDATE debt_customers SET archived=0 WHERE id=? AND account_id=?`, id, accountID)
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
		- IFNULL((SELECT SUM(p.amount) FROM debt_payments p WHERE p.customer_id=dc.id AND p.account_id=dc.account_id),0),
		IFNULL(dc.archived,0)
		FROM debt_customers dc WHERE dc.account_id = ? ORDER BY dc.name`, accountID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	list := []DebtCustomer{}
	for rows.Next() {
		var x DebtCustomer
		var archived int
		rows.Scan(&x.ID, &x.AccountID, &x.Name, &x.CreatedAt, &x.DebtTotal, &archived)
		// «Убранного» клиента показываем только если у него снова есть долг.
		if archived == 1 && x.DebtTotal <= 0 {
			continue
		}
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
	rows, err := db.Query(`SELECT id, account_id, customer_id, amount, IFNULL(method,'cash'), IFNULL(note,''), IFNULL(created_by,''), IFNULL(created_at,'') FROM debt_payments WHERE account_id=? AND customer_id NOT IN (SELECT id FROM debt_customers WHERE account_id=? AND IFNULL(archived,0)=1) ORDER BY id DESC`, accID, accID)
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
	// Дата: строго YYYY-MM-DD. Явная дата → полдень того дня (для финотчёта по
	// датам). Без даты или при неверном формате — текущий момент, чтобы платёж
	// попал в открытую смену «здесь и сейчас» (а не потерялся в отчётах).
	createdAt := time.Now().Format(time.RFC3339)
	if d := strings.TrimSpace(req.Date); d != "" {
		if _, e := time.Parse("2006-01-02", d); e == nil {
			createdAt = d + "T12:00:00Z"
		}
	}
	// Чтение остатка и вставка платежа — в одной транзакции, иначе два
	// одновременных погашения оба пройдут проверку и переплатят долг (TOCTOU).
	tx, err := db.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	var open, paid float64
	_ = tx.QueryRow(`SELECT IFNULL(SUM(amount),0) FROM debts WHERE account_id=? AND customer_id=? AND status='open'`, accID, req.CustomerID).Scan(&open)
	_ = tx.QueryRow(`SELECT IFNULL(SUM(amount),0) FROM debt_payments WHERE account_id=? AND customer_id=?`, accID, req.CustomerID).Scan(&paid)
	outstanding := open - paid
	if outstanding <= 0 {
		tx.Rollback()
		c.JSON(http.StatusBadRequest, gin.H{"error": "Долг уже погашен"})
		return
	}
	if req.Amount > outstanding+0.5 { // копеечный допуск на округления
		tx.Rollback()
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Сумма больше остатка долга (%.0f)", outstanding)})
		return
	}
	res, err := tx.Exec(`INSERT INTO debt_payments(account_id, customer_id, amount, method, note, created_by, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)`,
		accID, req.CustomerID, req.Amount, method, strings.TrimSpace(req.Note), strings.TrimSpace(req.By), createdAt)
	if err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := tx.Commit(); err != nil {
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
	res, err := db.Exec(`DELETE FROM debt_payments WHERE id=? AND account_id=?`, id, accountID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Погашение не найдено"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func getDebts(c *gin.Context) {
	accountID := accountID(c)
	rows, err := db.Query(`SELECT d.id, d.account_id, d.customer_id, dc.name, d.sale_id, d.amount, d.status, d.created_at, IFNULL(d.paid_at,'') FROM debts d LEFT JOIN debt_customers dc ON dc.id = d.customer_id WHERE d.account_id = ? AND IFNULL(dc.archived,0)=0 ORDER BY d.id DESC`, accountID)
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

// DELETE /debts/history — «убрать погашенных»: прячем полностью закрытых клиентов
// (остаток ≤ 0) из списка долгов. НЕ удаляем платежи/долги — иначе из кассы и
// финотчёта пропали бы реальные приходы наличных. Новый долг вернёт клиента (см.
// ensureDebtCustomer, снимает archived). Одним UPDATE — без вложенных Exec.
func clearDebtHistory(c *gin.Context) {
	accID := accountID(c)
	if _, err := db.Exec(`UPDATE debt_customers SET archived=1 WHERE account_id=? AND
		IFNULL((SELECT SUM(d.amount) FROM debts d WHERE d.customer_id=debt_customers.id AND d.account_id=debt_customers.account_id AND d.status='open'),0)
		- IFNULL((SELECT SUM(p.amount) FROM debt_payments p WHERE p.customer_id=debt_customers.id AND p.account_id=debt_customers.account_id),0) <= 0`, accID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
