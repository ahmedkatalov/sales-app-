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

// GET /finance/report?from=&to= — месячный финансовый отчёт (P&L + движение налом + позиция).
func getFinanceReport(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	accID := accountID(c)
	from := c.Query("from")
	to := c.Query("to")

	// ── Стартовые балансы (точка отсчёта миграции; читаем первыми — нужны для нижней границы) ──
	var op struct {
		asOf                                                            string
		cash, bank, owedOwner, inventory, custDebts, supDebts, rev, exp float64
	}
	_ = db.QueryRow(`SELECT IFNULL(as_of_date,''), IFNULL(cash,0), IFNULL(bank,0), IFNULL(owed_to_owner,0),
		IFNULL(inventory_value,0), IFNULL(customer_debts,0), IFNULL(supplier_debts,0), IFNULL(revenue,0), IFNULL(expenses,0)
		FROM opening_balances WHERE account_id=?`, accID).Scan(
		&op.asOf, &op.cash, &op.bank, &op.owedOwner, &op.inventory, &op.custDebts, &op.supDebts, &op.rev, &op.exp)

	// Сумма за период [from..to] по колонке даты (date(...,'localtime')).
	periodSum := func(base, dateCol string) float64 {
		q := base
		args := []any{accID}
		if from != "" {
			q += " AND date(" + dateCol + ",'localtime') >= date(?)"
			args = append(args, from)
		}
		if to != "" {
			q += " AND date(" + dateCol + ",'localtime') <= date(?)"
			args = append(args, to)
		}
		var v float64
		_ = db.QueryRow(q, args...).Scan(&v)
		return v
	}
	// Нарастающим итогом до конца периода. Нижняя граница — дата стартовых балансов (если
	// задана): операции ДО неё уже включены в сами стартовые балансы, иначе задвоятся.
	uptoSum := func(base, dateCol string) float64 {
		q := base
		args := []any{accID}
		if op.asOf != "" {
			// >= : стартовые балансы — состояние на НАЧАЛО даты старта, операции этой даты и позже уже новые.
			q += " AND date(" + dateCol + ",'localtime') >= date(?)"
			args = append(args, op.asOf)
		}
		if to != "" {
			q += " AND date(" + dateCol + ",'localtime') <= date(?)"
			args = append(args, to)
		}
		var v float64
		_ = db.QueryRow(q, args...).Scan(&v)
		return v
	}

	// ── Прибыль (P&L) за период ──
	revenueCash := periodSum(`SELECT IFNULL(SUM(total),0) FROM sales WHERE account_id=? AND payment_type='cash'`, "created_at")
	revenueCard := periodSum(`SELECT IFNULL(SUM(total),0) FROM sales WHERE account_id=? AND payment_type='transfer'`, "created_at")
	revenueDebt := periodSum(`SELECT IFNULL(SUM(total),0) FROM sales WHERE account_id=? AND payment_type='debt'`, "created_at")
	revenue := revenueCash + revenueCard + revenueDebt
	cogs := periodSum(`SELECT IFNULL(SUM(si.cost*si.qty),0) FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE s.account_id=?`, "s.created_at")
	grossProfit := revenue - cogs

	expenseCash := periodSum(`SELECT IFNULL(SUM(amount),0) FROM global_expenses WHERE account_id=? AND IFNULL(payment_source,'cash')='cash'`, "created_at")
	expenseCard := periodSum(`SELECT IFNULL(SUM(amount),0) FROM global_expenses WHERE account_id=? AND payment_source='card'`, "created_at")
	expenseOwner := periodSum(`SELECT IFNULL(SUM(amount),0) FROM global_expenses WHERE account_id=? AND payment_source='owner'`, "created_at")
	expenses := expenseCash + expenseCard + expenseOwner
	netProfit := grossProfit - expenses

	// ── Движение наличных за период ──
	contribP := periodSum(`SELECT IFNULL(SUM(amount),0) FROM owner_ledger WHERE account_id=? AND kind='contribution'`, "created_at")
	reimbP := periodSum(`SELECT IFNULL(SUM(amount),0) FROM owner_ledger WHERE account_id=? AND kind='reimbursement'`, "created_at")
	withdrawP := periodSum(`SELECT IFNULL(SUM(amount),0) FROM owner_ledger WHERE account_id=? AND kind='withdrawal'`, "created_at")
	cashIn := revenueCash + contribP
	cashOut := expenseCash + reimbP + withdrawP
	netCash := cashIn - cashOut

	// ── Позиция нарастающим итогом до конца периода ──
	ownerExpUpto := uptoSum(`SELECT IFNULL(SUM(amount),0) FROM global_expenses WHERE account_id=? AND payment_source='owner'`, "created_at")
	contribUpto := uptoSum(`SELECT IFNULL(SUM(amount),0) FROM owner_ledger WHERE account_id=? AND kind='contribution'`, "created_at")
	reimbUpto := uptoSum(`SELECT IFNULL(SUM(amount),0) FROM owner_ledger WHERE account_id=? AND kind='reimbursement'`, "created_at")
	withdrawUpto := uptoSum(`SELECT IFNULL(SUM(amount),0) FROM owner_ledger WHERE account_id=? AND kind='withdrawal'`, "created_at")
	cashSalesUpto := uptoSum(`SELECT IFNULL(SUM(total),0) FROM sales WHERE account_id=? AND payment_type='cash'`, "created_at")
	cashExpUpto := uptoSum(`SELECT IFNULL(SUM(amount),0) FROM global_expenses WHERE account_id=? AND IFNULL(payment_source,'cash')='cash'`, "created_at")

	owedToOwner := op.owedOwner + ownerExpUpto + contribUpto - reimbUpto
	cashNow := op.cash + cashSalesUpto + contribUpto - cashExpUpto - reimbUpto - withdrawUpto

	// Текущие живые значения: остаток долгов клиентов и стоимость склада.
	var receivables, inventoryLive float64
	var invCount int
	_ = db.QueryRow(`SELECT IFNULL(SUM(amount),0) FROM debts WHERE account_id=? AND status='open'`, accID).Scan(&receivables)
	_ = db.QueryRow(`SELECT COUNT(*), IFNULL(SUM(quantity*unit_cost),0) FROM warehouse_items WHERE account_id=? AND IFNULL(hidden,0)=0`, accID).Scan(&invCount, &inventoryLive)
	// Склад вообще не заведён в приложении → берём стартовую оценку. Если товары есть, но
	// остаток честно равен 0 — оставляем 0 (не подменяем стартовым значением).
	if invCount == 0 {
		inventoryLive = op.inventory
	}
	payables := op.supDebts
	bank := op.bank
	netPosition := cashNow + bank + inventoryLive + receivables - payables - owedToOwner

	c.JSON(http.StatusOK, gin.H{
		"period": gin.H{"from": from, "to": to},
		"pnl": gin.H{
			"revenueCash": revenueCash, "revenueCard": revenueCard, "revenueDebt": revenueDebt, "revenue": revenue,
			"cogs": cogs, "grossProfit": grossProfit,
			"expenseCash": expenseCash, "expenseCard": expenseCard, "expenseOwner": expenseOwner, "expenses": expenses,
			"netProfit": netProfit,
		},
		"cash": gin.H{
			"inSales": revenueCash, "inOwner": contribP, "outExpenses": expenseCash,
			"outReimburse": reimbP, "outWithdraw": withdrawP, "net": netCash,
		},
		"position": gin.H{
			"owedToOwner": owedToOwner, "cashNow": cashNow, "bank": bank,
			"inventory": inventoryLive, "receivables": receivables, "payables": payables,
			"netPosition": netPosition,
		},
		"opening": gin.H{
			"asOfDate": op.asOf, "cash": op.cash, "bank": op.bank, "owedToOwner": op.owedOwner,
			"inventoryValue": op.inventory, "customerDebts": op.custDebts, "supplierDebts": op.supDebts,
			"isSet": op.asOf != "" || op.cash != 0 || op.bank != 0 || op.owedOwner != 0 || op.inventory != 0 || op.custDebts != 0 || op.supDebts != 0,
		},
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
