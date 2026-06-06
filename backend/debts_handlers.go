package main

import (
	"database/sql"
	"github.com/gin-gonic/gin"
	"net/http"
	"strconv"
	"strings"
	"time"
)

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
	rows, err := db.Query(`SELECT dc.id, dc.account_id, dc.name, dc.created_at, IFNULL(SUM(CASE WHEN d.status = 'open' THEN d.amount ELSE 0 END), 0) FROM debt_customers dc LEFT JOIN debts d ON d.customer_id = dc.id AND d.account_id = dc.account_id WHERE dc.account_id = ? GROUP BY dc.id ORDER BY dc.name`, accountID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	list := []DebtCustomer{}
	for rows.Next() {
		var x DebtCustomer
		rows.Scan(&x.ID, &x.AccountID, &x.Name, &x.CreatedAt, &x.DebtTotal)
		list = append(list, x)
	}
	c.JSON(http.StatusOK, list)
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
		x.Items = getSaleItems(x.SaleID)
		list = append(list, x)
	}
	c.JSON(http.StatusOK, list)
}

func closeDebt(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	_, err := db.Exec(`UPDATE debts SET status='paid', paid_at=? WHERE id=? AND account_id=?`, time.Now().Format(time.RFC3339), id, accountID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func clearDebtHistory(c *gin.Context) {
	_, err := db.Exec(`DELETE FROM debts WHERE account_id=? AND status='paid'`, accountID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
