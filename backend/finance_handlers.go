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

	var fromExpenses, contributions, reimbursements, withdrawals float64
	_ = db.QueryRow(`SELECT IFNULL(SUM(amount),0) FROM global_expenses WHERE account_id=? AND IFNULL(payment_source,'cash')='owner'`, accID).Scan(&fromExpenses)
	_ = db.QueryRow(`SELECT IFNULL(SUM(amount),0) FROM owner_ledger WHERE account_id=? AND kind='contribution'`, accID).Scan(&contributions)
	_ = db.QueryRow(`SELECT IFNULL(SUM(amount),0) FROM owner_ledger WHERE account_id=? AND kind='reimbursement'`, accID).Scan(&reimbursements)
	_ = db.QueryRow(`SELECT IFNULL(SUM(amount),0) FROM owner_ledger WHERE account_id=? AND kind='withdrawal'`, accID).Scan(&withdrawals)

	owed := fromExpenses + contributions - reimbursements

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
		"fromExpenses":   fromExpenses,
		"contributions":  contributions,
		"reimbursements": reimbursements,
		"withdrawals":    withdrawals,
		"entries":        entries,
	})
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
