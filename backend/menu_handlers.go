package main

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"strings"
	"time"
)

func loadProductRecipe(productID int, accID int) []ProductRecipe {
	rows, err := db.Query(`
		SELECT r.id, r.product_id, r.warehouse_item_id, IFNULL(w.name, ''), IFNULL(w.unit, ''),
		       IFNULL(NULLIF(r.input_quantity, 0), r.quantity), IFNULL(NULLIF(r.input_unit, ''), w.unit),
		       r.quantity, IFNULL(r.conversion_note, ''), IFNULL(w.unit_cost, 0)
		FROM product_recipes r
		LEFT JOIN warehouse_items w ON w.id = r.warehouse_item_id AND w.account_id = r.account_id
		WHERE r.product_id = ? AND r.account_id = ?
		ORDER BY r.id
	`, productID, accID)

	if err != nil {
		return []ProductRecipe{}
	}
	defer rows.Close()

	list := []ProductRecipe{}
	for rows.Next() {
		var item ProductRecipe
		_ = rows.Scan(&item.ID, &item.ProductID, &item.WarehouseItemID, &item.ItemName, &item.Unit, &item.Quantity, &item.QuantityUnit, &item.StorageQuantity, &item.ConversionNote, &item.UnitCost)
		item.QuantityUnitSnake = item.QuantityUnit
		item.Cost = item.StorageQuantity * item.UnitCost
		list = append(list, item)
	}

	return list
}

func calculateRecipeCost(productID int, accID int) float64 {
	var total float64
	_ = db.QueryRow(`
		SELECT IFNULL(SUM(r.quantity * w.unit_cost), 0)
		FROM product_recipes r
		JOIN warehouse_items w ON w.id = r.warehouse_item_id AND w.account_id = r.account_id
		WHERE r.product_id = ? AND r.account_id = ?
	`, productID, accID).Scan(&total)
	return total
}

func getMenuProducts(c *gin.Context) {
	rows, err := db.Query(`
		SELECT 
			p.id,
			p.account_id,
			p.category_id,
			IFNULL(c.type_id, 0),
			p.name,
			IFNULL(c.name, p.category),
			IFNULL(t.name, p.type),
			p.type,
			p.price,
			IFNULL(p.cost, 0)
		FROM menu_products p
		LEFT JOIN product_categories c ON c.id = p.category_id AND c.account_id = p.account_id
		LEFT JOIN product_types t ON t.id = c.type_id AND t.account_id = p.account_id
		WHERE p.account_id = ?
		ORDER BY t.name, c.name, p.name
	`, accountID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	list := []MenuProduct{}

	for rows.Next() {
		var p MenuProduct
		if err := rows.Scan(&p.ID, &p.AccountID, &p.CategoryID, &p.TypeID, &p.Name, &p.Category, &p.TypeName, &p.Type, &p.Price, &p.Cost); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if p.Type == "" {
			p.Type = p.TypeName
		}
		p.Recipe = loadProductRecipe(p.ID, p.AccountID)
		if len(p.Recipe) > 0 {
			p.Cost = calculateRecipeCost(p.ID, p.AccountID)
		}
		list = append(list, p)
	}

	c.JSON(http.StatusOK, list)
}

func createMenuProduct(c *gin.Context) {
	var p MenuProduct

	if err := c.ShouldBindJSON(&p); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	p.Name = strings.TrimSpace(p.Name)
	if p.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "product name required"})
		return
	}

	p.AccountID = accountID(c)

	if p.CategoryID != 0 {
		_ = db.QueryRow(`
			SELECT c.name, IFNULL(c.type_id, 0), IFNULL(t.name, c.type)
			FROM product_categories c
			LEFT JOIN product_types t ON t.id = c.type_id AND t.account_id = c.account_id
			WHERE c.id = ? AND c.account_id = ?
		`, p.CategoryID, p.AccountID).Scan(&p.Category, &p.TypeID, &p.TypeName)
		p.Type = p.TypeName
	}

	if strings.TrimSpace(p.Type) == "" {
		p.Type = "Без типа"
	}

	tx, err := db.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer tx.Rollback()

	res, err := tx.Exec(`
		INSERT INTO menu_products(account_id, category_id, name, category, type, price, cost, created_at)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?)
	`, p.AccountID, p.CategoryID, p.Name, p.Category, p.Type, p.Price, p.Cost, time.Now().Format(time.RFC3339))

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	id, _ := res.LastInsertId()
	p.ID = int(id)

	for _, recipeItem := range p.Recipe {
		warehouseItemID := recipeItem.WarehouseItemID
		if warehouseItemID == 0 {
			warehouseItemID = recipeItem.WarehouseItemIDSnake
		}

		if warehouseItemID <= 0 || recipeItem.Quantity <= 0 {
			continue
		}

		inputUnit := strings.TrimSpace(recipeItem.QuantityUnit)
		if inputUnit == "" {
			inputUnit = strings.TrimSpace(recipeItem.QuantityUnitSnake)
		}
		storageQty, conversionNote, convErr := convertRecipeToStorage(p.AccountID, warehouseItemID, recipeItem.Quantity, inputUnit)
		if convErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": conversionNote})
			return
		}

		if _, err := tx.Exec(`
			INSERT INTO product_recipes(account_id, product_id, warehouse_item_id, quantity, input_quantity, input_unit, conversion_note)
			VALUES(?, ?, ?, ?, ?, ?, ?)
		`, p.AccountID, p.ID, warehouseItemID, storageQty, recipeItem.Quantity, inputUnit, conversionNote); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	if len(p.Recipe) > 0 {
		if err := tx.QueryRow(`
			SELECT IFNULL(SUM(r.quantity * w.unit_cost), 0)
			FROM product_recipes r
			JOIN warehouse_items w ON w.id = r.warehouse_item_id AND w.account_id = r.account_id
			WHERE r.product_id = ? AND r.account_id = ?
		`, p.ID, p.AccountID).Scan(&p.Cost); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if _, err := tx.Exec(`UPDATE menu_products SET cost = ? WHERE id = ? AND account_id = ?`, p.Cost, p.ID, p.AccountID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	p.Recipe = loadProductRecipe(p.ID, p.AccountID)

	c.JSON(http.StatusOK, p)
}

func deleteMenuProduct(c *gin.Context) {
	_, _ = db.Exec(`DELETE FROM product_recipes WHERE product_id = ? AND account_id = ?`, c.Param("id"), accountID(c))
	_, err := db.Exec(`DELETE FROM menu_products WHERE id = ? AND account_id = ?`, c.Param("id"), accountID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Status(http.StatusOK)
}
