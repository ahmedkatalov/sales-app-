package main

import (
	"database/sql"
	"github.com/gin-gonic/gin"
	"net/http"
	"strings"
	"time"
)

func getSaleItems(saleID int) []SaleItem {
	rows, err := db.Query(`
		SELECT product_id, name, type, qty, price, IFNULL(cost, 0), total
		FROM sale_items
		WHERE sale_id = ?
		ORDER BY id
	`, saleID)

	if err != nil {
		return []SaleItem{}
	}
	defer rows.Close()

	items := []SaleItem{}

	for rows.Next() {
		var item SaleItem
		if err := rows.Scan(&item.ProductID, &item.Name, &item.Type, &item.Qty, &item.Price, &item.Cost, &item.Total); err == nil {
			items = append(items, item)
		}
	}

	return items
}

func increaseMonthItem(accountID int, item SaleItem) {
	folderName := "Еда"
	if normalizeType(item.Type) == "drink" {
		folderName = "Напитки"
	}

	folderID := ensureFolder(accountID, folderName)
	month := time.Now().Format("2006-01")
	monthID := ensureMonth(folderID, month)

	var itemID int
	var oldQty float64

	err := db.QueryRow(`
		SELECT id, qty
		FROM items
		WHERE folder_id = ? AND month_id = ? AND lower(name) = lower(?)
	`, folderID, monthID, item.Name).Scan(&itemID, &oldQty)

	if err == sql.ErrNoRows {
		db.Exec(`
			INSERT INTO items(folder_id, month_id, name, cost, price, qty)
			VALUES(?, ?, ?, ?, ?, ?)
		`, folderID, monthID, item.Name, item.Cost, item.Price, item.Qty)
		return
	}

	if err == nil {
		db.Exec(`
			UPDATE items
			SET qty = ?, price = ?, cost = ?
			WHERE id = ?
		`, oldQty+item.Qty, item.Price, item.Cost, itemID)
	}
}

func increaseMonthItemTx(tx *sql.Tx, accountID int, item SaleItem, now string) error {
	folderName := "Еда"
	if normalizeType(item.Type) == "drink" {
		folderName = "Напитки"
	}

	folderID, err := ensureFolderTx(tx, accountID, folderName, now)
	if err != nil {
		return err
	}
	month := time.Now().Format("2006-01")
	monthID, err := ensureMonthTx(tx, folderID, month, now)
	if err != nil {
		return err
	}

	var itemID int
	var oldQty float64
	err = tx.QueryRow(`
		SELECT id, qty
		FROM items
		WHERE folder_id = ? AND month_id = ? AND lower(name) = lower(?)
	`, folderID, monthID, item.Name).Scan(&itemID, &oldQty)

	if err == sql.ErrNoRows {
		_, err = tx.Exec(`
			INSERT INTO items(folder_id, month_id, name, cost, price, qty)
			VALUES(?, ?, ?, ?, ?, ?)
		`, folderID, monthID, item.Name, item.Cost, item.Price, item.Qty)
		return err
	}

	if err != nil {
		return err
	}

	_, err = tx.Exec(`
		UPDATE items
		SET qty = ?, price = ?, cost = ?
		WHERE id = ?
	`, oldQty+item.Qty, item.Price, item.Cost, itemID)
	return err
}

func ensureFolderTx(tx *sql.Tx, accountID int, name string, now string) (int, error) {
	var id int

	err := tx.QueryRow(`
		SELECT id
		FROM folders
		WHERE account_id = ? AND lower(name) = lower(?)
	`, accountID, name).Scan(&id)

	if err == nil {
		return id, nil
	}
	if err != sql.ErrNoRows {
		return 0, err
	}

	res, err := tx.Exec(`
		INSERT INTO folders(account_id, name, created_at)
		VALUES(?, ?, ?)
	`, accountID, name, now)
	if err != nil {
		return 0, err
	}
	newID, _ := res.LastInsertId()
	return int(newID), nil
}

func ensureMonthTx(tx *sql.Tx, folderID int, month string, now string) (int, error) {
	var id int

	err := tx.QueryRow(`
		SELECT id
		FROM months
		WHERE folder_id = ? AND month = ?
	`, folderID, month).Scan(&id)

	if err == nil {
		return id, nil
	}
	if err != sql.ErrNoRows {
		return 0, err
	}

	res, err := tx.Exec(`
		INSERT INTO months(folder_id, month, created_at)
		VALUES(?, ?, ?)
	`, folderID, month, now)
	if err != nil {
		return 0, err
	}
	newID, _ := res.LastInsertId()
	return int(newID), nil
}

func ensureFolder(accountID int, name string) int {
	var id int

	err := db.QueryRow(`
		SELECT id
		FROM folders
		WHERE account_id = ? AND lower(name) = lower(?)
	`, accountID, name).Scan(&id)

	if err == nil {
		return id
	}

	res, _ := db.Exec(`
		INSERT INTO folders(account_id, name, created_at)
		VALUES(?, ?, ?)
	`, accountID, name, time.Now().Format(time.RFC3339))

	newID, _ := res.LastInsertId()
	return int(newID)
}

func ensureMonth(folderID int, month string) int {
	var id int

	err := db.QueryRow(`
		SELECT id
		FROM months
		WHERE folder_id = ? AND month = ?
	`, folderID, month).Scan(&id)

	if err == nil {
		return id
	}

	res, _ := db.Exec(`
		INSERT INTO months(folder_id, month, created_at)
		VALUES(?, ?, ?)
	`, folderID, month, time.Now().Format(time.RFC3339))

	newID, _ := res.LastInsertId()
	return int(newID)
}

func getGlobalExpenses(c *gin.Context) {
	rows, err := db.Query(`
		SELECT 
			g.id,
			g.account_id,
			IFNULL(g.employee_id, 0),
			IFNULL(e.name, ''),
			g.category,
			g.type,
			g.name,
			g.amount,
			g.comment,
			g.created_at
		FROM global_expenses g
		LEFT JOIN employees e ON e.id = g.employee_id AND e.account_id = g.account_id
		WHERE g.account_id = ?
		ORDER BY g.id DESC
	`, accountID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	list := []GlobalExpense{}

	for rows.Next() {
		var e GlobalExpense
		if err := rows.Scan(&e.ID, &e.AccountID, &e.EmployeeID, &e.EmployeeName, &e.Category, &e.Type, &e.Name, &e.Amount, &e.Comment, &e.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		list = append(list, e)
	}

	c.JSON(http.StatusOK, list)
}

func createGlobalExpense(c *gin.Context) {
	var e GlobalExpense

	if err := c.ShouldBindJSON(&e); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if e.AccountID == 0 {
		e.AccountID = accountID(c)
	}

	if e.Amount <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "amount required"})
		return
	}

	res, err := db.Exec(`
		INSERT INTO global_expenses(account_id, employee_id, category, type, name, amount, comment, created_at)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?)
	`, e.AccountID, e.EmployeeID, e.Category, e.Type, e.Name, e.Amount, e.Comment, time.Now().Format(time.RFC3339))

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	id, _ := res.LastInsertId()
	e.ID = int(id)

	c.JSON(http.StatusOK, e)
}

func deleteGlobalExpense(c *gin.Context) {
	_, err := db.Exec(`DELETE FROM global_expenses WHERE id = ? AND account_id = ?`, c.Param("id"), accountID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Status(http.StatusOK)
}

func getExpenses(c *gin.Context) {
	rows, err := db.Query(`
		SELECT e.id, e.folder_id, e.month_id, e.category, e.type, e.sub_type, e.name, e.qty, e.price, e.amount, e.comment
		FROM expenses e
		JOIN folders f ON f.id = e.folder_id
		WHERE e.folder_id = ? AND e.month_id = ? AND f.account_id = ? AND IFNULL(e.account_id, f.account_id) = f.account_id
		ORDER BY e.id DESC
	`, c.Param("folderId"), c.Param("monthId"), accountID(c))

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	list := []Expense{}

	for rows.Next() {
		var e Expense
		if err := rows.Scan(&e.ID, &e.FolderID, &e.MonthID, &e.Category, &e.Type, &e.SubType, &e.Name, &e.Qty, &e.Price, &e.Amount, &e.Comment); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		list = append(list, e)
	}

	c.JSON(http.StatusOK, list)
}

func addExpense(c *gin.Context) {
	var e Expense

	if err := c.ShouldBindJSON(&e); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if e.FolderID == 0 || e.MonthID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "folderId and monthId required"})
		return
	}

	accID := accountID(c)
	var ok int
	if err := db.QueryRow(`
		SELECT COUNT(*)
		FROM folders f
		JOIN months m ON m.folder_id = f.id
		WHERE f.id = ? AND m.id = ? AND f.account_id = ?
	`, e.FolderID, e.MonthID, accID).Scan(&ok); err != nil || ok == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Папка или месяц не найдены для этого аккаунта"})
		return
	}

	if e.Amount == 0 {
		e.Amount = e.Qty * e.Price
	}

	res, err := db.Exec(`
		INSERT INTO expenses(account_id, folder_id, month_id, category, type, sub_type, name, qty, price, amount, comment)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, accID, e.FolderID, e.MonthID, e.Category, e.Type, e.SubType, e.Name, e.Qty, e.Price, e.Amount, e.Comment)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	id, _ := res.LastInsertId()
	e.ID = int(id)

	c.JSON(http.StatusOK, e)
}

func deleteExpense(c *gin.Context) {
	_, err := db.Exec(`
		DELETE FROM expenses
		WHERE id = ?
		  AND account_id = ?
	`, c.Param("id"), accountID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Status(http.StatusOK)
}

func getFolders(c *gin.Context) {
	rows, err := db.Query(`
		SELECT id, account_id, name
		FROM folders
		WHERE account_id = ?
		ORDER BY id DESC
	`, accountID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	list := []Folder{}

	for rows.Next() {
		var f Folder
		if err := rows.Scan(&f.ID, &f.AccountID, &f.Name); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		list = append(list, f)
	}

	c.JSON(http.StatusOK, list)
}

func createFolder(c *gin.Context) {
	var f Folder

	if err := c.ShouldBindJSON(&f); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if f.AccountID == 0 {
		f.AccountID = accountID(c)
	}

	f.Name = strings.TrimSpace(f.Name)
	if f.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "folder name required"})
		return
	}

	res, err := db.Exec(`
		INSERT INTO folders(account_id, name, created_at)
		VALUES(?, ?, ?)
	`, f.AccountID, f.Name, time.Now().Format(time.RFC3339))

	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "folder already exists"})
		return
	}

	id, _ := res.LastInsertId()
	f.ID = int(id)

	c.JSON(http.StatusOK, f)
}

func getMonths(c *gin.Context) {
	rows, err := db.Query(`
		SELECT m.id, m.folder_id, m.month
		FROM months m
		JOIN folders f ON f.id = m.folder_id
		WHERE m.folder_id = ? AND f.account_id = ?
		ORDER BY m.month DESC
	`, c.Param("folderId"), accountID(c))

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	list := []Month{}

	for rows.Next() {
		var m Month
		if err := rows.Scan(&m.ID, &m.FolderID, &m.Month); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		list = append(list, m)
	}

	c.JSON(http.StatusOK, list)
}

func createMonth(c *gin.Context) {
	var req struct {
		FolderID    int    `json:"folderId"`
		Month       string `json:"month"`
		FromMonthID int    `json:"fromMonthId"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.FolderID == 0 || req.Month == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "folderId and month required"})
		return
	}

	res, err := db.Exec(`
		INSERT INTO months(folder_id, month, created_at)
		VALUES(?, ?, ?)
	`, req.FolderID, req.Month, time.Now().Format(time.RFC3339))

	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "month already exists"})
		return
	}

	newMonthID, _ := res.LastInsertId()

	if req.FromMonthID != 0 {
		copyItems(req.FolderID, req.FromMonthID, int(newMonthID))
	}

	c.JSON(http.StatusOK, Month{
		ID:       int(newMonthID),
		FolderID: req.FolderID,
		Month:    req.Month,
	})
}

func copyItemsToMonth(c *gin.Context) {
	var req struct {
		FolderID     int  `json:"folderId"`
		FromMonthID  int  `json:"fromMonthId"`
		ToMonthID    int  `json:"toMonthId"`
		DeleteBefore bool `json:"deleteBefore"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.FolderID == 0 || req.FromMonthID == 0 || req.ToMonthID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "folderId, fromMonthId and toMonthId required"})
		return
	}

	if req.DeleteBefore {
		_, err := db.Exec(`DELETE FROM items WHERE folder_id = ? AND month_id = ?`, req.FolderID, req.ToMonthID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	if err := copyItems(req.FolderID, req.FromMonthID, req.ToMonthID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Status(http.StatusOK)
}

func copyItems(folderID int, fromMonthID int, toMonthID int) error {
	rows, err := db.Query(`
		SELECT name, cost, price
		FROM items
		WHERE folder_id = ? AND month_id = ?
		ORDER BY id
	`, folderID, fromMonthID)

	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var name string
		var cost float64
		var price float64

		if err := rows.Scan(&name, &cost, &price); err != nil {
			return err
		}

		_, err = db.Exec(`
			INSERT INTO items(folder_id, month_id, name, cost, price, qty)
			VALUES(?, ?, ?, ?, ?, 0)
		`, folderID, toMonthID, name, cost, price)

		if err != nil {
			return err
		}
	}

	return nil
}

func getItems(c *gin.Context) {
	rows, err := db.Query(`
		SELECT i.id, i.folder_id, i.month_id, i.name, i.cost, i.price, i.qty
		FROM items i
		JOIN folders f ON f.id = i.folder_id
		WHERE i.month_id = ? AND f.account_id = ?
		ORDER BY i.id
	`, c.Param("monthId"), accountID(c))

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	list := []Item{}

	for rows.Next() {
		var i Item
		if err := rows.Scan(&i.ID, &i.FolderID, &i.MonthID, &i.Name, &i.Cost, &i.Price, &i.Qty); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		list = append(list, i)
	}

	c.JSON(http.StatusOK, list)
}

func addItem(c *gin.Context) {
	var i Item

	if err := c.ShouldBindJSON(&i); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if i.FolderID == 0 || i.MonthID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "folderId and monthId required"})
		return
	}

	res, err := db.Exec(`
		INSERT INTO items(folder_id, month_id, name, cost, price, qty)
		VALUES(?, ?, ?, ?, ?, ?)
	`, i.FolderID, i.MonthID, i.Name, i.Cost, i.Price, i.Qty)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	id, _ := res.LastInsertId()
	i.ID = int(id)

	c.JSON(http.StatusOK, i)
}

func updateItem(c *gin.Context) {
	var i Item

	if err := c.ShouldBindJSON(&i); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	_, err := db.Exec(`
		UPDATE items
		SET name = ?, cost = ?, price = ?, qty = ?
		WHERE id = ?
	`, i.Name, i.Cost, i.Price, i.Qty, c.Param("id"))

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Status(http.StatusOK)
}

func deleteItem(c *gin.Context) {
	_, err := db.Exec(`DELETE FROM items WHERE id = ?`, c.Param("id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Status(http.StatusOK)
}
