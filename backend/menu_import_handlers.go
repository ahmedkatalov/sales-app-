package main

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// Импорт меню кухни из PDF (парсинг делает фронт, сюда приходит уже структура).
// Создаёт недостающие категории под одним типом (по умолчанию «Кухня»), кладёт
// блюда в нужные категории (дубли по имени пропускает), заводит состав как рецепт.
// Ингредиенты по умолчанию НЕ засоряют склад: связываются с уже существующим
// сырьём по имени (autoLinkWarehouseItemTx), иначе остаются pending_link. При
// createWarehouseItems=true недостающее сырьё заводится на склад (кол-во 0).

type importIngredient struct {
	Name     string  `json:"name"`
	Quantity float64 `json:"quantity"`
	Unit     string  `json:"unit"`
}

type importDish struct {
	Name   string             `json:"name"`
	Recipe []importIngredient `json:"recipe"`
}

type importCategory struct {
	Name   string       `json:"name"`
	Dishes []importDish `json:"dishes"`
}

type importMenuRequest struct {
	DefaultType          string           `json:"defaultType"`
	CreateWarehouseItems bool             `json:"createWarehouseItems"`
	Categories           []importCategory `json:"categories"`
}

func normalizeImportUnit(u string) string {
	switch strings.ToLower(strings.TrimSpace(u)) {
	case "г", "гр", "g", "gr":
		return "g"
	case "мл", "ml":
		return "ml"
	case "кг", "kg":
		return "kg"
	case "л", "l":
		return "l"
	case "шт", "шт.", "штук", "pcs", "pc":
		return "pcs"
	case "":
		return "g"
	default:
		return strings.ToLower(strings.TrimSpace(u))
	}
}

func importMenu(c *gin.Context) {
	accID := accountID(c)

	var req importMenuRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(req.Categories) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Не распознано ни одной категории — проверьте PDF"})
		return
	}
	defaultType := strings.TrimSpace(req.DefaultType)
	if defaultType == "" {
		defaultType = "Кухня"
	}

	tx, err := db.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	now := time.Now().Format(time.RFC3339)
	fail := func(e error) {
		_ = tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": e.Error()})
	}

	// Единый тип для всей импортируемой кухни (find-or-create).
	var typeID int
	if e := tx.QueryRow(`SELECT id FROM product_types WHERE account_id = ? AND LOWER(name)=LOWER(?) LIMIT 1`, accID, defaultType).Scan(&typeID); e != nil {
		res, ie := tx.Exec(`INSERT INTO product_types(account_id, name, created_at) VALUES(?, ?, ?)`, accID, defaultType, now)
		if ie != nil {
			fail(ie)
			return
		}
		id64, _ := res.LastInsertId()
		typeID = int(id64)
	}

	var createdCats, existingCats, createdDishes, skippedDishes, recipeRows, createdItems int

	for _, cat := range req.Categories {
		catName := strings.TrimSpace(cat.Name)
		if catName == "" {
			continue
		}

		// Категория: если есть с таким именем — используем её, иначе создаём.
		var catID int
		if e := tx.QueryRow(`SELECT id FROM product_categories WHERE account_id = ? AND LOWER(name)=LOWER(?) LIMIT 1`, accID, catName).Scan(&catID); e != nil {
			res, ie := tx.Exec(`INSERT INTO product_categories(account_id, name, type_id, type, created_at) VALUES(?, ?, ?, ?, ?)`, accID, catName, typeID, defaultType, now)
			if ie != nil {
				fail(ie)
				return
			}
			id64, _ := res.LastInsertId()
			catID = int(id64)
			createdCats++
		} else {
			existingCats++
		}

		for _, dish := range cat.Dishes {
			dishName := strings.TrimSpace(dish.Name)
			if dishName == "" {
				continue
			}

			// Дубли по имени не создаём (идемпотентность повторного импорта).
			var exists int
			_ = tx.QueryRow(`SELECT COUNT(*) FROM menu_products WHERE account_id = ? AND LOWER(name)=LOWER(?)`, accID, dishName).Scan(&exists)
			if exists > 0 {
				skippedDishes++
				continue
			}

			res, ie := tx.Exec(`INSERT INTO menu_products(account_id, category_id, name, category, type, price, cost, hidden, created_at) VALUES(?, ?, ?, ?, ?, 0, 0, 0, ?)`,
				accID, catID, dishName, catName, defaultType, now)
			if ie != nil {
				fail(ie)
				return
			}
			pid64, _ := res.LastInsertId()
			pid := int(pid64)
			createdDishes++

			for _, ing := range dish.Recipe {
				ingName := strings.TrimSpace(ing.Name)
				if ingName == "" || ing.Quantity <= 0 {
					continue
				}
				unit := normalizeImportUnit(ing.Unit)

				whID := 0
				if req.CreateWarehouseItems {
					if e := tx.QueryRow(`SELECT id FROM warehouse_items WHERE account_id = ? AND LOWER(name)=LOWER(?) AND IFNULL(deleted,0)=0 LIMIT 1`, accID, ingName).Scan(&whID); e != nil {
						r2, ie2 := tx.Exec(`INSERT INTO warehouse_items(account_id, name, unit, quantity, created_at) VALUES(?, ?, ?, 0, ?)`, accID, ingName, unit, now)
						if ie2 != nil {
							fail(ie2)
							return
						}
						wid64, _ := r2.LastInsertId()
						whID = int(wid64)
						createdItems++
					}
				} else {
					whID = autoLinkWarehouseItemTx(tx, accID, ingName)
				}

				storageQty := ing.Quantity
				note := "pending_link"
				if whID > 0 {
					if sq, n, ce := convertRecipeToStorage(tx, accID, whID, ing.Quantity, unit); ce == nil {
						storageQty, note = sq, n
					} else {
						note = "auto_linked"
					}
				}

				if _, ie := tx.Exec(`INSERT INTO product_recipes(account_id, product_id, warehouse_item_id, ingredient_name, quantity, input_quantity, input_unit, conversion_note) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
					accID, pid, whID, ingName, storageQty, ing.Quantity, unit, note); ie != nil {
					fail(ie)
					return
				}
				recipeRows++
			}
		}
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"createdCategories":     createdCats,
		"existingCategories":    existingCats,
		"createdDishes":         createdDishes,
		"skippedDishes":         skippedDishes,
		"recipeRows":            recipeRows,
		"createdWarehouseItems": createdItems,
	})
}
