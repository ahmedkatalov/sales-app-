package main

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// Расчёты с владельцем (леджер).
//   contribution — владелец внёс личные деньги в кассу: +касса, +долг перед владельцем
//   reimbursement — бизнес вернул владельцу из кассы:   −касса, −долг перед владельцем
//   withdrawal   — владелец изъял прибыль из кассы:      −касса, долг не меняется
//
// «Долг перед владельцем» = расходы из личных денег владельца (global_expenses.payment_source='owner')
//                           + вклады − возвраты.

func ownerKindValid(k string) bool {
	return k == "contribution" || k == "reimbursement" || k == "withdrawal"
}

// GET /finance/owner — баланс расчётов с владельцем + история.
func getOwnerFinance(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	accID := accountID(c)

	var fromExpenses, contributions, reimbursements, withdrawals, openingOwed float64
	_ = db.QueryRow(`SELECT IFNULL(SUM(amount),0) FROM global_expenses WHERE account_id=? AND IFNULL(payment_source,'cash')='owner'`, accID).Scan(&fromExpenses)
	_ = db.QueryRow(`SELECT IFNULL(SUM(amount),0) FROM owner_ledger WHERE account_id=? AND kind='contribution'`, accID).Scan(&contributions)
	_ = db.QueryRow(`SELECT IFNULL(SUM(amount),0) FROM owner_ledger WHERE account_id=? AND kind='reimbursement'`, accID).Scan(&reimbursements)
	_ = db.QueryRow(`SELECT IFNULL(SUM(amount),0) FROM owner_ledger WHERE account_id=? AND kind='withdrawal'`, accID).Scan(&withdrawals)
	// Долг перед владельцем на старте (из стартовых балансов) — тоже часть текущего долга.
	_ = db.QueryRow(`SELECT IFNULL(owed_to_owner,0) FROM opening_balances WHERE account_id=?`, accID).Scan(&openingOwed)

	owed := openingOwed + fromExpenses + contributions - reimbursements

	entries := []gin.H{}
	if rows, err := db.Query(`
		SELECT o.id, o.kind, o.amount, IFNULL(o.note,''), IFNULL(e.name,''), o.created_at
		FROM owner_ledger o
		LEFT JOIN employees e ON e.id = o.employee_id AND e.account_id = o.account_id
		WHERE o.account_id = ?
		ORDER BY o.id DESC LIMIT 100`, accID); err == nil {
		for rows.Next() {
			var id int
			var kind, note, empName, createdAt string
			var amount float64
			if rows.Scan(&id, &kind, &amount, &note, &empName, &createdAt) == nil {
				entries = append(entries, gin.H{
					"id": id, "kind": kind, "amount": amount,
					"note": note, "employeeName": empName, "createdAt": createdAt,
				})
			}
		}
		rows.Close()
	}

	c.JSON(http.StatusOK, gin.H{
		"owed":           owed,
		"openingOwed":    openingOwed,
		"fromExpenses":   fromExpenses,
		"contributions":  contributions,
		"reimbursements": reimbursements,
		"withdrawals":    withdrawals,
		"entries":        entries,
	})
}

// GET /finance/opening — стартовые балансы точки (или нули, если не заданы).
func getOpeningBalances(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	accID := accountID(c)
	var b struct {
		AsOfDate       string  `json:"asOfDate"`
		Cash           float64 `json:"cash"`
		Bank           float64 `json:"bank"`
		OwedToOwner    float64 `json:"owedToOwner"`
		InventoryValue float64 `json:"inventoryValue"`
		CustomerDebts  float64 `json:"customerDebts"`
		SupplierDebts  float64 `json:"supplierDebts"`
		Revenue        float64 `json:"revenue"`
		Expenses       float64 `json:"expenses"`
		Note           string  `json:"note"`
		UpdatedAt      string  `json:"updatedAt"`
		IsSet          bool    `json:"isSet"`
	}
	err := db.QueryRow(`
		SELECT IFNULL(as_of_date,''), IFNULL(cash,0), IFNULL(bank,0), IFNULL(owed_to_owner,0),
		       IFNULL(inventory_value,0), IFNULL(customer_debts,0), IFNULL(supplier_debts,0),
		       IFNULL(revenue,0), IFNULL(expenses,0), IFNULL(note,''), IFNULL(updated_at,'')
		FROM opening_balances WHERE account_id=?`, accID).Scan(
		&b.AsOfDate, &b.Cash, &b.Bank, &b.OwedToOwner, &b.InventoryValue,
		&b.CustomerDebts, &b.SupplierDebts, &b.Revenue, &b.Expenses, &b.Note, &b.UpdatedAt)
	b.IsSet = err == nil
	c.JSON(http.StatusOK, b)
}

// PUT /finance/opening — задать/обновить стартовые балансы (одна строка на точку).
func setOpeningBalances(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	accID := accountID(c)
	var req struct {
		AsOfDate       string  `json:"asOfDate"`
		Cash           float64 `json:"cash"`
		Bank           float64 `json:"bank"`
		OwedToOwner    float64 `json:"owedToOwner"`
		InventoryValue float64 `json:"inventoryValue"`
		CustomerDebts  float64 `json:"customerDebts"`
		SupplierDebts  float64 `json:"supplierDebts"`
		Revenue        float64 `json:"revenue"`
		Expenses       float64 `json:"expenses"`
		Note           string  `json:"note"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if _, err := db.Exec(`
		INSERT OR REPLACE INTO opening_balances
			(account_id, as_of_date, cash, bank, owed_to_owner, inventory_value, customer_debts, supplier_debts, revenue, expenses, note, updated_at)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, accID, strings.TrimSpace(req.AsOfDate), req.Cash, req.Bank, req.OwedToOwner, req.InventoryValue,
		req.CustomerDebts, req.SupplierDebts, req.Revenue, req.Expenses, strings.TrimSpace(req.Note),
		time.Now().Format(time.RFC3339)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	getOpeningBalances(c)
}

// POST /finance/owner — записать движение по расчётам с владельцем.
func createOwnerEntry(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	accID := accountID(c)
	var req struct {
		Kind       string  `json:"kind"`
		Amount     float64 `json:"amount"`
		Note       string  `json:"note"`
		EmployeeID int     `json:"employeeId"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if !ownerKindValid(req.Kind) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный тип операции"})
		return
	}
	if req.Amount <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Сумма должна быть больше нуля"})
		return
	}
	if _, err := db.Exec(`
		INSERT INTO owner_ledger(account_id, kind, amount, note, employee_id, created_at)
		VALUES(?, ?, ?, ?, ?, ?)
	`, accID, req.Kind, req.Amount, strings.TrimSpace(req.Note), req.EmployeeID, time.Now().Format(time.RFC3339)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	getOwnerFinance(c)
}

// DELETE /finance/owner/:id — удалить запись леджера (владелец/админ).
func deleteOwnerEntry(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	if _, err := db.Exec(`DELETE FROM owner_ledger WHERE id=? AND account_id=?`, c.Param("id"), accountID(c)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	getOwnerFinance(c)
}
