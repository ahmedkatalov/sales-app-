package main

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"strings"
	"time"
)

func getProductTypes(c *gin.Context) {
	rows, err := db.Query(`
		SELECT id, account_id, name
		FROM product_types
		WHERE account_id = ?
		ORDER BY id DESC
	`, accountID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	list := []ProductType{}
	for rows.Next() {
		var t ProductType
		if err := rows.Scan(&t.ID, &t.AccountID, &t.Name); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		list = append(list, t)
	}

	c.JSON(http.StatusOK, list)
}

func createProductType(c *gin.Context) {
	var t ProductType
	if err := c.ShouldBindJSON(&t); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	t.Name = strings.TrimSpace(t.Name)
	if t.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "type name required"})
		return
	}
	if t.AccountID == 0 {
		t.AccountID = accountID(c)
	}
	res, err := db.Exec(`INSERT INTO product_types(account_id, name, created_at) VALUES(?, ?, ?)`, t.AccountID, t.Name, time.Now().Format(time.RFC3339))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	id, _ := res.LastInsertId()
	t.ID = int(id)
	c.JSON(http.StatusOK, t)
}

// deleteProductType — обнуляет ссылки в категориях и удаляет тип в одной транзакции.
func deleteProductType(c *gin.Context) {
	id := c.Param("id")
	accID := accountID(c)

	tx, err := db.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`UPDATE product_categories SET type_id = 0 WHERE type_id = ? AND account_id = ?`, id, accID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if _, err := tx.Exec(`DELETE FROM product_types WHERE id = ? AND account_id = ?`, id, accID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Status(http.StatusOK)
}

func getProductCategories(c *gin.Context) {
	rows, err := db.Query(`
		SELECT c.id, c.account_id, c.name, IFNULL(c.type_id, 0), IFNULL(t.name, c.type), c.type
		FROM product_categories c
		LEFT JOIN product_types t ON t.id = c.type_id AND t.account_id = c.account_id
		WHERE c.account_id = ?
		ORDER BY t.name, c.name
	`, accountID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	list := []ProductCategory{}

	for rows.Next() {
		var cat ProductCategory
		if err := rows.Scan(&cat.ID, &cat.AccountID, &cat.Name, &cat.TypeID, &cat.TypeName, &cat.Type); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		list = append(list, cat)
	}

	c.JSON(http.StatusOK, list)
}

func createProductCategory(c *gin.Context) {
	var cat ProductCategory

	if err := c.ShouldBindJSON(&cat); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	cat.Name = strings.TrimSpace(cat.Name)
	if cat.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "folder name required"})
		return
	}

	if cat.AccountID == 0 {
		cat.AccountID = accountID(c)
	}

	if cat.TypeID != 0 {
		_ = db.QueryRow(`SELECT name FROM product_types WHERE id = ? AND account_id = ?`, cat.TypeID, cat.AccountID).Scan(&cat.TypeName)
		cat.Type = cat.TypeName
	} else {
		cat.Type = strings.TrimSpace(cat.Type)
		if cat.Type == "" {
			cat.Type = "Без типа"
		}
		cat.TypeName = cat.Type
	}

	res, err := db.Exec(`
		INSERT INTO product_categories(account_id, name, type_id, type, created_at)
		VALUES(?, ?, ?, ?, ?)
	`, cat.AccountID, cat.Name, cat.TypeID, cat.Type, time.Now().Format(time.RFC3339))

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	id, _ := res.LastInsertId()
	cat.ID = int(id)

	c.JSON(http.StatusOK, cat)
}

// deleteProductCategory — обнуляет ссылки в меню и удаляет категорию в одной транзакции.
func deleteProductCategory(c *gin.Context) {
	id := c.Param("id")
	accID := accountID(c)

	tx, err := db.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`UPDATE menu_products SET category_id = 0, category = '' WHERE category_id = ? AND account_id = ?`, id, accID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if _, err := tx.Exec(`DELETE FROM product_categories WHERE id = ? AND account_id = ?`, id, accID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Status(http.StatusOK)
}
