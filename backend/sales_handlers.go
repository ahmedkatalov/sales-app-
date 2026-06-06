package main

import (
	"database/sql"
	"encoding/json"
	"github.com/gin-gonic/gin"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func resolveSaleItemProduct(item SaleItem, accID int) SaleItem {
	if item.ProductID <= 0 && item.ProductIDSnake > 0 {
		item.ProductID = item.ProductIDSnake
	}

	if item.ProductID <= 0 && strings.TrimSpace(item.Name) != "" {
		_ = db.QueryRow(`
			SELECT id, IFNULL(cost, 0), IFNULL(type, '')
			FROM menu_products
			WHERE account_id = ? AND lower(name) = lower(?)
			ORDER BY id DESC
			LIMIT 1
		`, accID, item.Name).Scan(&item.ProductID, &item.Cost, &item.Type)
	}

	if item.ProductID > 0 {
		var cost float64
		var productType string
		err := db.QueryRow(`
			SELECT IFNULL(cost, 0), IFNULL(type, '')
			FROM menu_products
			WHERE id = ? AND account_id = ?
		`, item.ProductID, accID).Scan(&cost, &productType)
		if err == nil {
			item.Cost = cost
			if strings.TrimSpace(item.Type) == "" {
				item.Type = productType
			}
		}

		recipeCost := calculateRecipeCost(item.ProductID, accID)
		if recipeCost > 0 {
			item.Cost = recipeCost
		}
	}

	return item
}

func prepareSale(req *Sale) (map[int]float64, error) {
	if req.AccountID == 0 {
		return nil, sql.ErrNoRows
	}
	if len(req.Items) == 0 {
		return nil, sql.ErrNoRows
	}

	subtotal := 0.0
	for i := range req.Items {
		if req.Items[i].Qty <= 0 {
			req.Items[i].Qty = 1
		}
		req.Items[i] = resolveSaleItemProduct(req.Items[i], req.AccountID)
		req.Items[i].Total = req.Items[i].Qty * req.Items[i].Price
		subtotal += req.Items[i].Total
	}

	stockNeeds := map[int]float64{}
	for _, item := range req.Items {
		if item.ProductID <= 0 {
			continue
		}
		rows, err := db.Query(`SELECT warehouse_item_id, quantity FROM product_recipes WHERE product_id = ? AND account_id = ?`, item.ProductID, req.AccountID)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var warehouseItemID int
			var recipeQty float64
			if err := rows.Scan(&warehouseItemID, &recipeQty); err != nil {
				rows.Close()
				return nil, err
			}
			stockNeeds[warehouseItemID] += recipeQty * item.Qty
		}
		rows.Close()
	}

	for warehouseItemID, needQty := range stockNeeds {
		var name, unit string
		var available float64
		err := db.QueryRow(`SELECT name, unit, quantity FROM warehouse_items WHERE id = ? AND account_id = ?`, warehouseItemID, req.AccountID).Scan(&name, &unit, &available)
		if err != nil {
			return nil, err
		}
		if available+0.000001 < needQty {
			return nil, &stockError{name: name, unit: unit, need: needQty, available: available}
		}
	}

	req.Subtotal = subtotal
	req.DiscountAmount = subtotal * req.DiscountPercent / 100
	req.Total = subtotal - req.DiscountAmount
	if req.PaymentType == "cash" {
		req.ChangeAmount = req.CashGiven - req.Total
	} else {
		req.ChangeAmount = 0
	}
	return stockNeeds, nil
}

type stockError struct {
	name, unit      string
	need, available float64
}

func (e *stockError) Error() string {
	return "Недостаточно на складе: " + e.name + ". Нужно " + strconv.FormatFloat(e.need, 'f', 2, 64) + " " + e.unit + ", есть " + strconv.FormatFloat(e.available, 'f', 2, 64) + " " + e.unit
}

func saveSale(req *Sale) error {
	if _, err := prepareSale(req); err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := saveSaleInTx(tx, req, time.Now().Format(time.RFC3339), nil); err != nil {
		return err
	}
	return tx.Commit()
}

func saveSaleInTx(tx *sql.Tx, req *Sale, now string, reservedProductCosts map[int]float64) error {
	res, err := tx.Exec(`INSERT INTO sales(account_id, employee_id, payment_type, card_id, subtotal, discount_percent, discount_amount, total, cash_given, change_amount, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, req.AccountID, req.EmployeeID, req.PaymentType, req.CardID, req.Subtotal, req.DiscountPercent, req.DiscountAmount, req.Total, req.CashGiven, req.ChangeAmount, now)
	if err != nil {
		return err
	}
	saleID, _ := res.LastInsertId()

	reservedProductQty := map[int]float64{}
	if reservedProductCosts != nil {
		for _, item := range req.Items {
			if item.ProductID > 0 && item.Qty > 0 {
				reservedProductQty[item.ProductID] += item.Qty
			}
		}
	}

	for i := range req.Items {
		item := req.Items[i]
		actualUnitCost := item.Cost
		if item.ProductID > 0 && item.Qty > 0 {
			if reservedProductCosts != nil {
				if reservedCost, ok := reservedProductCosts[item.ProductID]; ok && reservedCost > 0 && reservedProductQty[item.ProductID] > 0 {
					actualUnitCost = reservedCost / reservedProductQty[item.ProductID]
				}
			} else {
				fifoCost, err := consumeRecipeFIFOForSaleItemTx(tx, req.AccountID, item.ProductID, item.Qty, "Продажа", "Продажа #"+strconv.FormatInt(saleID, 10)+" · "+item.Name, "sale", now)
				if err != nil {
					return err
				}
				if fifoCost > 0 {
					actualUnitCost = fifoCost / item.Qty
				}
			}
		}
		item.Cost = actualUnitCost
		req.Items[i] = item

		_, err := tx.Exec(`INSERT INTO sale_items(sale_id, product_id, name, type, qty, price, cost, total) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`, saleID, item.ProductID, item.Name, item.Type, item.Qty, item.Price, item.Cost, item.Total)
		if err != nil {
			return err
		}
		if err := increaseMonthItemTx(tx, req.AccountID, item, now); err != nil {
			return err
		}
	}

	req.ID = int(saleID)
	req.CreatedAt = now
	return nil
}

func consumeRecipeFIFOForSaleItemTx(tx *sql.Tx, accID int, productID int, saleQty float64, reason string, note string, movementType string, createdAt string) (float64, error) {
	type recipeNeed struct {
		WarehouseItemID int
		Quantity        float64
	}
	rows, err := tx.Query(`SELECT warehouse_item_id, quantity FROM product_recipes WHERE product_id = ? AND account_id = ? ORDER BY id`, productID, accID)
	if err != nil {
		return 0, err
	}

	needs := []recipeNeed{}
	for rows.Next() {
		var warehouseItemID int
		var recipeQty float64
		if err := rows.Scan(&warehouseItemID, &recipeQty); err != nil {
			rows.Close()
			return 0, err
		}
		needQty := recipeQty * saleQty
		if needQty > 0 {
			needs = append(needs, recipeNeed{WarehouseItemID: warehouseItemID, Quantity: needQty})
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	if err := rows.Close(); err != nil {
		return 0, err
	}

	totalCost := 0.0
	for _, need := range needs {
		cost, err := consumeWarehouseFIFOTx(tx, accID, need.WarehouseItemID, need.Quantity, reason, note, movementType, createdAt)
		if err != nil {
			return 0, err
		}
		totalCost += cost
	}
	return totalCost, nil
}

func createSale(c *gin.Context) {
	var req Sale
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.AccountID = accountID(c)
	if req.PaymentType == "debt" && strings.TrimSpace(req.CustomerName) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Введите имя клиента для долга"})
		return
	}
	if _, err := prepareSale(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	tx, err := db.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	now := time.Now().Format(time.RFC3339)
	if err := saveSaleInTx(tx, &req, now, nil); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.PaymentType == "debt" {
		customerID, err := ensureDebtCustomerTx(tx, req.AccountID, req.CustomerName, now)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		_, err = tx.Exec(`INSERT INTO debts(account_id, customer_id, sale_id, amount, status, created_at, paid_at) VALUES(?, ?, ?, ?, 'open', ?, '')`, req.AccountID, customerID, req.ID, req.Total, req.CreatedAt)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}
	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, req)
}

func reservePendingSaleItemsTx(tx *sql.Tx, pendingSaleID int64, req Sale, now string) error {
	for _, item := range req.Items {
		if item.ProductID <= 0 || item.Qty <= 0 {
			continue
		}
		rows, err := tx.Query(`
			SELECT warehouse_item_id, quantity
			FROM product_recipes
			WHERE product_id = ? AND account_id = ?
			ORDER BY id
		`, item.ProductID, req.AccountID)
		if err != nil {
			return err
		}

		type recipeNeed struct {
			WarehouseItemID int
			Quantity        float64
		}
		needs := []recipeNeed{}
		for rows.Next() {
			var warehouseItemID int
			var recipeQty float64
			if err := rows.Scan(&warehouseItemID, &recipeQty); err != nil {
				rows.Close()
				return err
			}
			needQty := recipeQty * item.Qty
			if needQty > 0 {
				needs = append(needs, recipeNeed{WarehouseItemID: warehouseItemID, Quantity: needQty})
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		if err := rows.Close(); err != nil {
			return err
		}

		for _, need := range needs {
			if _, err := reserveWarehouseFIFOTx(tx, pendingSaleID, req.AccountID, item.ProductID, need.WarehouseItemID, need.Quantity, now); err != nil {
				return err
			}
		}
	}
	return nil
}

func reservedProductCostsTx(tx *sql.Tx, pendingSaleID int, accID int) (map[int]float64, error) {
	rows, err := tx.Query(`
		SELECT product_id, IFNULL(SUM(total_cost), 0)
		FROM pending_sale_reservations
		WHERE pending_sale_id = ? AND account_id = ?
		GROUP BY product_id
	`, pendingSaleID, accID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	costs := map[int]float64{}
	for rows.Next() {
		var productID int
		var totalCost float64
		if err := rows.Scan(&productID, &totalCost); err != nil {
			return nil, err
		}
		costs[productID] = totalCost
	}
	return costs, rows.Err()
}

func createPendingSale(c *gin.Context) {
	var req Sale
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.AccountID = accountID(c)
	if _, err := prepareSale(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	tx, err := db.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer tx.Rollback()

	b, _ := json.Marshal(req.Items)
	now := time.Now().Format(time.RFC3339)
	res, err := tx.Exec(`INSERT INTO pending_sales(account_id, employee_id, seller_name, subtotal, discount_percent, discount_amount, total, items_json, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`, req.AccountID, req.EmployeeID, req.EmployeeName, req.Subtotal, req.DiscountPercent, req.DiscountAmount, req.Total, string(b), now)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	id, _ := res.LastInsertId()
	if err := reservePendingSaleItemsTx(tx, id, req, now); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	req.ID = int(id)
	req.CreatedAt = now
	c.JSON(http.StatusOK, req)
}

func getPendingSales(c *gin.Context) {
	accountID := accountID(c)
	rows, err := db.Query(`SELECT id, account_id, employee_id, seller_name, subtotal, discount_percent, discount_amount, total, items_json, created_at FROM pending_sales WHERE account_id = ? ORDER BY id DESC`, accountID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	list := []Sale{}
	for rows.Next() {
		var s Sale
		var itemsJSON string
		rows.Scan(&s.ID, &s.AccountID, &s.EmployeeID, &s.EmployeeName, &s.Subtotal, &s.DiscountPercent, &s.DiscountAmount, &s.Total, &itemsJSON, &s.CreatedAt)
		_ = json.Unmarshal([]byte(itemsJSON), &s.Items)
		list = append(list, s)
	}
	c.JSON(http.StatusOK, list)
}

func confirmPendingSale(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var req Sale
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	accountID := accountID(c)
	paymentType := req.PaymentType
	cardID := req.CardID
	cashGiven := req.CashGiven
	changeAmount := req.ChangeAmount
	customerName := req.CustomerName

	var itemsJSON string
	err := db.QueryRow(`SELECT account_id, employee_id, seller_name, subtotal, discount_percent, discount_amount, total, items_json FROM pending_sales WHERE id = ? AND account_id = ?`, id, accountID).Scan(&req.AccountID, &req.EmployeeID, &req.EmployeeName, &req.Subtotal, &req.DiscountPercent, &req.DiscountAmount, &req.Total, &itemsJSON)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Ожидание оплаты не найдено"})
		return
	}
	_ = json.Unmarshal([]byte(itemsJSON), &req.Items)
	req.PaymentType = paymentType
	req.CardID = cardID
	req.CashGiven = cashGiven
	req.ChangeAmount = changeAmount
	req.CustomerName = customerName
	if req.PaymentType == "" {
		req.PaymentType = "cash"
	}
	if req.PaymentType == "transfer" && req.CardID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Выбери карту"})
		return
	}
	if req.PaymentType == "debt" && strings.TrimSpace(req.CustomerName) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Введите имя клиента для долга"})
		return
	}
	if _, err := prepareSale(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	tx, err := db.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer tx.Rollback()

	reservedCosts, err := reservedProductCostsTx(tx, id, accountID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	now := time.Now().Format(time.RFC3339)
	if err := saveSaleInTx(tx, &req, now, reservedCosts); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.PaymentType == "debt" {
		customerID, err := ensureDebtCustomerTx(tx, req.AccountID, req.CustomerName, now)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if _, err := tx.Exec(`INSERT INTO debts(account_id, customer_id, sale_id, amount, status, created_at, paid_at) VALUES(?, ?, ?, ?, 'open', ?, '')`, req.AccountID, customerID, req.ID, req.Total, req.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}
	if _, err := tx.Exec(`DELETE FROM pending_sale_reservations WHERE pending_sale_id = ? AND account_id = ?`, id, accountID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if _, err := tx.Exec(`DELETE FROM pending_sales WHERE id = ? AND account_id = ?`, id, accountID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, req)
}

func deletePendingSale(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	accID := accountID(c)
	tx, err := db.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer tx.Rollback()

	if err := releasePendingSaleReservationsTx(tx, id, accID, time.Now().Format(time.RFC3339)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if _, err := tx.Exec(`DELETE FROM pending_sales WHERE id = ? AND account_id = ?`, id, accID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
func getSales(c *gin.Context) {
	accountID := accountID(c)
	from := c.Query("from")
	to := c.Query("to")

	where := []string{"s.account_id = ?"}
	args := []any{accountID}

	if from != "" {
		where = append(where, "date(s.created_at) >= date(?)")
		args = append(args, from)
	}

	if to != "" {
		where = append(where, "date(s.created_at) <= date(?)")
		args = append(args, to)
	}

	rows, err := db.Query(`
		SELECT 
			s.id,
			s.account_id,
			IFNULL(s.employee_id, 0),
			IFNULL(e.name, ''),
			s.payment_type,
			IFNULL(s.card_id, 0),
			IFNULL(c.name, ''),
			s.subtotal,
			s.discount_percent,
			s.discount_amount,
			s.total,
			s.cash_given,
			s.change_amount,
			s.created_at
		FROM sales s
		LEFT JOIN employees e ON e.id = s.employee_id AND e.account_id = s.account_id
		LEFT JOIN cards c ON c.id = s.card_id AND c.account_id = s.account_id
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY s.id DESC
	`, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	list := []Sale{}

	for rows.Next() {
		var s Sale
		if err := rows.Scan(
			&s.ID,
			&s.AccountID,
			&s.EmployeeID,
			&s.EmployeeName,
			&s.PaymentType,
			&s.CardID,
			&s.CardName,
			&s.Subtotal,
			&s.DiscountPercent,
			&s.DiscountAmount,
			&s.Total,
			&s.CashGiven,
			&s.ChangeAmount,
			&s.CreatedAt,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		s.Items = getSaleItems(s.ID)
		list = append(list, s)
	}

	c.JSON(http.StatusOK, list)
}

func getSalesStats(c *gin.Context) {
	accountID := accountID(c)
	from := c.Query("from")
	to := c.Query("to")

	where := []string{"account_id = ?"}
	args := []any{accountID}

	if from != "" {
		where = append(where, "date(created_at) >= date(?)")
		args = append(args, from)
	}

	if to != "" {
		where = append(where, "date(created_at) <= date(?)")
		args = append(args, to)
	}

	stats := gin.H{
		"totalRevenue":  0,
		"totalDiscount": 0,
		"salesCount":    0,
		"cashTotal":     0,
		"transferTotal": 0,
		"totalCost":     0,
		"cleanProfit":   0,
		"topProducts":   []gin.H{},
	}

	query := `
		SELECT
			IFNULL(SUM(total), 0),
			IFNULL(SUM(discount_amount), 0),
			COUNT(*),
			IFNULL(SUM(CASE WHEN payment_type = 'cash' THEN total ELSE 0 END), 0),
			IFNULL(SUM(CASE WHEN payment_type = 'transfer' THEN total ELSE 0 END), 0)
		FROM sales
		WHERE ` + strings.Join(where, " AND ")

	var totalRevenue, totalDiscount, cashTotal, transferTotal float64
	var salesCount int

	if err := db.QueryRow(query, args...).Scan(&totalRevenue, &totalDiscount, &salesCount, &cashTotal, &transferTotal); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	stats["totalRevenue"] = totalRevenue
	stats["totalDiscount"] = totalDiscount
	stats["salesCount"] = salesCount
	stats["cashTotal"] = cashTotal
	stats["transferTotal"] = transferTotal

	costWhere := []string{"s.account_id = ?"}
	costArgs := []any{accountID}
	if from != "" {
		costWhere = append(costWhere, "date(s.created_at) >= date(?)")
		costArgs = append(costArgs, from)
	}
	if to != "" {
		costWhere = append(costWhere, "date(s.created_at) <= date(?)")
		costArgs = append(costArgs, to)
	}

	var totalCost float64
	_ = db.QueryRow(`
		SELECT IFNULL(SUM(IFNULL(si.cost, IFNULL(mp.cost, 0)) * si.qty), 0)
		FROM sale_items si
		JOIN sales s ON s.id = si.sale_id
		LEFT JOIN menu_products mp ON mp.id = si.product_id AND mp.account_id = s.account_id
		WHERE `+strings.Join(costWhere, " AND "), costArgs...).Scan(&totalCost)

	stats["totalCost"] = totalCost
	stats["cleanProfit"] = totalRevenue - totalCost

	itemWhere := []string{"s.account_id = ?"}
	itemArgs := []any{accountID}

	if from != "" {
		itemWhere = append(itemWhere, "date(s.created_at) >= date(?)")
		itemArgs = append(itemArgs, from)
	}

	if to != "" {
		itemWhere = append(itemWhere, "date(s.created_at) <= date(?)")
		itemArgs = append(itemArgs, to)
	}

	rows, err := db.Query(`
		SELECT si.name, IFNULL(SUM(si.qty), 0), IFNULL(SUM(si.total), 0)
		FROM sale_items si
		JOIN sales s ON s.id = si.sale_id
		WHERE `+strings.Join(itemWhere, " AND ")+`
		GROUP BY si.name
		ORDER BY SUM(si.qty) DESC, SUM(si.total) DESC
		LIMIT 10
	`, itemArgs...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	topProducts := []gin.H{}
	for rows.Next() {
		var name string
		var qty float64
		var revenue float64
		if err := rows.Scan(&name, &qty, &revenue); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		topProducts = append(topProducts, gin.H{"name": name, "qty": qty, "revenue": revenue})
	}

	stats["topProducts"] = topProducts
	c.JSON(http.StatusOK, stats)
}
