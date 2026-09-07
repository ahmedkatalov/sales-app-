package main

import (
	"database/sql"
	"encoding/json"
	"github.com/gin-gonic/gin"
	"io"
	"net/http"
	"strings"
	"time"
)

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func loadProductRecipe(productID int, accID int) []ProductRecipe {
	rows, err := db.Query(`
		SELECT r.id, r.product_id, r.warehouse_item_id, IFNULL(r.ingredient_name, ''),
		       IFNULL(w.name, ''), IFNULL(w.unit, ''),
		       IFNULL(NULLIF(r.input_quantity, 0), r.quantity), IFNULL(NULLIF(r.input_unit, ''), IFNULL(w.unit, 'г')),
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
		var ingredientName string
		_ = rows.Scan(&item.ID, &item.ProductID, &item.WarehouseItemID, &ingredientName,
			&item.ItemName, &item.Unit, &item.Quantity, &item.QuantityUnit,
			&item.StorageQuantity, &item.ConversionNote, &item.UnitCost)
		item.QuantityUnitSnake = item.QuantityUnit
		item.Cost = item.StorageQuantity * item.UnitCost
		// Если склад не привязан — показываем имя из рецепта
		if item.WarehouseItemID <= 0 {
			item.Unlinked = true
			item.IngredientName = ingredientName
			if item.ItemName == "" {
				item.ItemName = ingredientName
			}
		} else {
			item.IngredientName = item.ItemName
		}
		list = append(list, item)
	}

	return list
}

// linkUnlinkedRecipes — при добавлении товара на склад автоматически линкует рецепты по имени
func linkUnlinkedRecipes(accID int, warehouseItemID int, itemName string) {
	rows, err := db.Query(`
		SELECT id, ingredient_name FROM product_recipes
		WHERE account_id = ? AND warehouse_item_id = 0 AND ingredient_name != ''
	`, accID)
	if err != nil {
		return
	}
	defer rows.Close()

	type candidate struct {
		id   int
		name string
	}
	var candidates []candidate
	for rows.Next() {
		var c candidate
		_ = rows.Scan(&c.id, &c.name)
		candidates = append(candidates, c)
	}

	for _, c := range candidates {
		// Тихое авто-связывание при добавлении сырья: принимаем только строгое
		// совпадение (autoLinkMatch) — точное имя или опечатка с тем же числом
		// слов. Подстрока-надмножество (молоко ⊂ молоко кокосовое, similarityScore
		// 0.88) больше НЕ линкуется автоматически, чтобы не списывать чужое сырьё.
		if !autoLinkMatch(itemName, c.name) {
			continue
		}
		// Пересчитываем quantity в единицы хранения нового склада по сохранённым
		// input_quantity/input_unit. Иначе продажа спишет сырое число (напр. 0.2 л
		// как 0.2 мл вместо 200 мл) — остаток занижался в разы.
		var inputQty float64
		var inputUnit string
		_ = db.QueryRow(`SELECT IFNULL(input_quantity, 0), IFNULL(input_unit, '') FROM product_recipes WHERE id = ? AND account_id = ?`, c.id, accID).Scan(&inputQty, &inputUnit)
		storageQty, _, convErr := convertRecipeToStorage(db, accID, warehouseItemID, inputQty, inputUnit)
		if convErr == nil && storageQty > 0 {
			_, _ = db.Exec(`UPDATE product_recipes SET warehouse_item_id = ?, quantity = ?, conversion_note = 'auto_linked' WHERE id = ? AND account_id = ?`, warehouseItemID, storageQty, c.id, accID)
		} else {
			// нет сохранённого input_quantity (старые записи) — линкуем без порчи quantity
			_, _ = db.Exec(`UPDATE product_recipes SET warehouse_item_id = ? WHERE id = ? AND account_id = ?`, warehouseItemID, c.id, accID)
		}
	}
}

// fuzzyFindWarehouseItemTx — нечёткий поиск складской позиции по имени.
// Ловит опечатки/варианты (угурец/огурец), когда позиция УЖЕ есть на складе,
// чтобы не плодить дубли. Возвращает 0, если уверенного совпадения нет.
func fuzzyFindWarehouseItemTx(tx *sql.Tx, accID int, name string) int {
	rows, err := tx.Query(`
		SELECT id, name FROM warehouse_items
		WHERE account_id = ? AND IFNULL(hidden, 0) = 0 AND IFNULL(deleted, 0) = 0
	`, accID)
	if err != nil {
		return 0
	}
	defer rows.Close()

	bestID := 0
	bestScore := 0.0
	for rows.Next() {
		var id int
		var n string
		if rows.Scan(&id, &n) != nil {
			continue
		}
		if s := similarityScore(name, n); s > bestScore {
			bestScore = s
			bestID = id
		}
	}
	if bestScore >= 0.82 {
		return bestID
	}
	return 0
}

// autoLinkMatch — строгий предикат ТОЛЬКО для «тихого» авто-связывания рецепта
// со складом. Разрешает связь лишь при точном совпадении нормализованных имён
// ИЛИ при опечаточном совпадении (Левенштейн) с ОДИНАКОВЫМ числом слов. Это
// отсекает случай «подстрока-надмножество» (молоко ⊂ молоко кокосовое), из-за
// которого similarityScore=0.88 молча привязывал ингредиент к чужому сырью.
func autoLinkMatch(a, b string) bool {
	na, nb := normalizeWarehouseName(a), normalizeWarehouseName(b)
	if na == "" || nb == "" {
		return false
	}
	if na == nb {
		return true
	}
	if len(strings.Fields(na)) != len(strings.Fields(nb)) {
		return false // разное число слов → блокируем sub/superset
	}
	maxLen := maxInt(len([]rune(na)), len([]rune(nb)))
	if maxLen == 0 {
		return false
	}
	score := 1 - float64(levenshteinDistance(na, nb))/float64(maxLen)
	return score >= 0.9 // строже 0.82, без бонуса за подстроку
}

// autoLinkWarehouseItemTx — подбирает складскую позицию для ТИХОГО авто-связывания
// рецепта. Кандидатов ищем по LIKE и нечётким поиском, но ПРИНИМАЕМ только тех,
// кто проходит строгий autoLinkMatch. Иначе возвращаем 0 — владелец свяжет
// вручную (запись остаётся pending_link, склад молча не списывается).
func autoLinkWarehouseItemTx(tx *sql.Tx, accID int, name string) int {
	// LIKE-кандидат по подстроке — принимаем лишь при строгом совпадении.
	var candID int
	var candName string
	_ = tx.QueryRow(`
		SELECT id, name FROM warehouse_items
		WHERE account_id = ? AND LOWER(TRIM(name)) LIKE LOWER(TRIM(?)) AND (hidden IS NULL OR hidden = 0)
		LIMIT 1
	`, accID, "%"+strings.ToLower(strings.TrimSpace(name))+"%").Scan(&candID, &candName)
	if candID > 0 && autoLinkMatch(name, candName) {
		return candID
	}
	// Нечёткий кандидат (опечатки/варианты) — тоже под строгой проверкой.
	if fuzzyID := fuzzyFindWarehouseItemTx(tx, accID, name); fuzzyID > 0 {
		var fuzzyName string
		_ = tx.QueryRow(`SELECT name FROM warehouse_items WHERE id = ? AND account_id = ?`, fuzzyID, accID).Scan(&fuzzyName)
		if autoLinkMatch(name, fuzzyName) {
			return fuzzyID
		}
	}
	return 0
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
			IFNULL(p.cost, 0),
			IFNULL(p.is_extra, 0),
			IFNULL(p.hidden, 0)
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
		var isExtra, hidden int
		if err := rows.Scan(&p.ID, &p.AccountID, &p.CategoryID, &p.TypeID, &p.Name, &p.Category, &p.TypeName, &p.Type, &p.Price, &p.Cost, &isExtra, &hidden); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		p.IsExtra = isExtra == 1
		p.Hidden = hidden == 1
		if p.Type == "" {
			p.Type = p.TypeName
		}
		list = append(list, p)
	}
	// ВАЖНО: закрываем rows до вложенных запросов. При SetMaxOpenConns(1)
	// открытый rows держит единственное соединение, а loadProductRecipe /
	// calculateRecipeCost тоже идут в db — это вызвало бы вечную блокировку.
	rows.Close()

	// Батч вместо N+1: один запрос на все рецепты аккаунта + себестоимость считаем
	// в Go из уже загруженных строк (item.Cost = storageQty * unit_cost). Раньше на
	// КАЖДЫЙ товар шло по 2 запроса (loadProductRecipe + calculateRecipeCost), и при
	// SetMaxOpenConns(1) всё сериализовалось — эндпоинт дёргается на каждой загрузке.
	recipeMap := loadRecipesByProduct(accountID(c))
	for i := range list {
		rec := recipeMap[list[i].ID]
		list[i].Recipe = rec
		if len(rec) > 0 {
			var cost float64
			for _, it := range rec {
				cost += it.Cost
			}
			list[i].Cost = cost
		}
	}

	c.JSON(http.StatusOK, list)
}

// loadRecipesByProduct — все рецепты аккаунта одним запросом, сгруппированные по
// product_id. Колонки/скан идентичны loadProductRecipe, но без фильтра по product_id.
func loadRecipesByProduct(accID int) map[int][]ProductRecipe {
	out := map[int][]ProductRecipe{}
	rows, err := db.Query(`
		SELECT r.id, r.product_id, r.warehouse_item_id, IFNULL(r.ingredient_name, ''),
		       IFNULL(w.name, ''), IFNULL(w.unit, ''),
		       IFNULL(NULLIF(r.input_quantity, 0), r.quantity), IFNULL(NULLIF(r.input_unit, ''), IFNULL(w.unit, 'г')),
		       r.quantity, IFNULL(r.conversion_note, ''), IFNULL(w.unit_cost, 0)
		FROM product_recipes r
		LEFT JOIN warehouse_items w ON w.id = r.warehouse_item_id AND w.account_id = r.account_id
		WHERE r.account_id = ?
		ORDER BY r.product_id, r.id
	`, accID)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var item ProductRecipe
		var ingredientName string
		_ = rows.Scan(&item.ID, &item.ProductID, &item.WarehouseItemID, &ingredientName,
			&item.ItemName, &item.Unit, &item.Quantity, &item.QuantityUnit,
			&item.StorageQuantity, &item.ConversionNote, &item.UnitCost)
		item.QuantityUnitSnake = item.QuantityUnit
		item.Cost = item.StorageQuantity * item.UnitCost
		if item.WarehouseItemID <= 0 {
			item.Unlinked = true
			item.IngredientName = ingredientName
			if item.ItemName == "" {
				item.ItemName = ingredientName
			}
		} else {
			item.IngredientName = item.ItemName
		}
		out[item.ProductID] = append(out[item.ProductID], item)
	}
	return out
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
		INSERT INTO menu_products(account_id, category_id, name, category, type, price, cost, is_extra, hidden, created_at)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, p.AccountID, p.CategoryID, p.Name, p.Category, p.Type, p.Price, p.Cost, boolToInt(p.IsExtra), boolToInt(p.Hidden), time.Now().Format(time.RFC3339))

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

		// Получаем имя ингредиента
		ingredientName := strings.TrimSpace(recipeItem.IngredientName)
		if ingredientName == "" {
			ingredientName = strings.TrimSpace(recipeItem.ItemName)
		}

		// Пропускаем если нет ни id ни имени, или нет количества
		if (warehouseItemID <= 0 && ingredientName == "") || recipeItem.Quantity <= 0 {
			continue
		}

		inputUnit := strings.TrimSpace(recipeItem.QuantityUnit)
		if inputUnit == "" {
			inputUnit = strings.TrimSpace(recipeItem.QuantityUnitSnake)
		}
		if inputUnit == "" {
			inputUnit = "g"
		}

		var storageQty float64
		var conversionNote string

		if warehouseItemID > 0 {
			// Есть связь со складом — конвертируем нормально
			var convErr error
			storageQty, conversionNote, convErr = convertRecipeToStorage(tx, p.AccountID, warehouseItemID, recipeItem.Quantity, inputUnit)
			if convErr != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": conversionNote})
				return
			}
		} else {
			// Виртуальный ингредиент — сохраняем как есть, конвертация позже
			storageQty = recipeItem.Quantity
			conversionNote = "pending_link"
			// Пробуем найти на складе по имени. Связываем ТОЛЬКО при строгом
			// совпадении (autoLinkMatch) — иначе оставляем pending_link, чтобы не
			// привязать, напр., «молоко» к «молоко кокосовое» и не списывать молча
			// чужое сырьё с искажением COGS.
			foundID := autoLinkWarehouseItemTx(tx, p.AccountID, ingredientName)
			if foundID > 0 {
				warehouseItemID = foundID
				var convErr error
				storageQty, conversionNote, convErr = convertRecipeToStorage(tx, p.AccountID, warehouseItemID, recipeItem.Quantity, inputUnit)
				if convErr != nil {
					storageQty = recipeItem.Quantity
					conversionNote = "auto_linked"
				}
			}
		}

		if _, err := tx.Exec(`
			INSERT INTO product_recipes(account_id, product_id, warehouse_item_id, ingredient_name, quantity, input_quantity, input_unit, conversion_note)
			VALUES(?, ?, ?, ?, ?, ?, ?, ?)
		`, p.AccountID, p.ID, warehouseItemID, ingredientName, storageQty, recipeItem.Quantity, inputUnit, conversionNote); err != nil {
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

func updateMenuProduct(c *gin.Context) {
	accID := accountID(c)
	productID := c.Param("id")

	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Определяем, прислал ли клиент поле recipe ВООБЩЕ.
	// Нет ключа recipe  → частичное обновление (цена/название) — состав НЕ трогаем.
	// recipe: []        → клиент явно очистил состав.
	// Это защищает от потери ингредиентов, когда обновляют только цену/название
	// (старый фронт, быстрые правки, любой частичный PUT без состава).
	var rawFields map[string]json.RawMessage
	_ = json.Unmarshal(body, &rawFields)
	_, recipeProvided := rawFields["recipe"]

	// Скаляры защищаем так же, как recipe: частичный PUT без ключа НЕ должен
	// обнулять name/price/cost/category/is_extra. Иначе быстрая правка (или
	// старый фронт), приславшая только часть полей, запишет Go-нули: пустое имя
	// ломает витрину кассы и resolveSaleItemProduct по имени, price=0 — товар
	// продаётся бесплатно, cost=0 — заниженная себестоимость → завышенная прибыль.
	_, nameProvided := rawFields["name"]
	_, priceProvided := rawFields["price"]
	_, costProvided := rawFields["cost"]
	_, extraProvided := rawFields["isExtra"]
	_, hiddenProvided := rawFields["hidden"]
	_, catProvided := rawFields["categoryId"]
	if !catProvided {
		_, catProvided = rawFields["category_id"]
	}

	var p MenuProduct
	if err := json.Unmarshal(body, &p); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p.AccountID = accID

	// Resolve category
	catID := p.CategoryID
	if catID == 0 {
		catID = p.CategoryIDSnake
	}

	tx, err := db.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer tx.Rollback()

	// Читаем текущие значения строки (внутри tx — SetMaxOpenConns(1)), чтобы
	// отсутствующие в PUT поля сохраняли своё значение, а не обнулялись.
	var curName, curCategory, curType string
	var curPrice, curCost float64
	var curCategoryID, curIsExtra, curHidden int
	_ = tx.QueryRow(`
		SELECT name, price, IFNULL(cost, 0), IFNULL(category_id, 0),
		       IFNULL(is_extra, 0), IFNULL(category, ''), IFNULL(type, ''), IFNULL(hidden, 0)
		FROM menu_products WHERE id = ? AND account_id = ?
	`, productID, accID).Scan(&curName, &curPrice, &curCost, &curCategoryID, &curIsExtra, &curCategory, &curType, &curHidden)

	newName := curName
	if nameProvided {
		newName = p.Name
	}
	newPrice := curPrice
	if priceProvided {
		newPrice = p.Price
	}
	newCost := curCost
	if costProvided {
		newCost = p.Cost
	}
	newIsExtra := curIsExtra
	if extraProvided {
		newIsExtra = boolToInt(p.IsExtra)
	}
	newCategoryID := curCategoryID
	if catProvided {
		newCategoryID = catID
	}
	newHidden := curHidden
	if hiddenProvided {
		newHidden = boolToInt(p.Hidden)
	}

	// Update main product fields. category/type пересчитываются из category_id;
	// при отсутствии categoryId (COALESCE не нашёл категорию) берём ТЕКУЩИЕ
	// значения — иначе смена только цены обнулила бы отображаемую категорию/тип.
	if _, err := tx.Exec(`
		UPDATE menu_products SET
			name = ?, price = ?, cost = ?, category_id = ?, is_extra = ?, hidden = ?,
			category = COALESCE((SELECT name FROM product_categories WHERE id = ? AND account_id = ?), ?),
			type = COALESCE((SELECT pt.name FROM product_types pt JOIN product_categories pc ON pc.type_id = pt.id WHERE pc.id = ? AND pc.account_id = ?), ?)
		WHERE id = ? AND account_id = ?
	`, newName, newPrice, newCost, newCategoryID, newIsExtra, newHidden,
		newCategoryID, accID, curCategory,
		newCategoryID, accID, curType,
		productID, accID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Состав переписываем ТОЛЬКО если клиент реально прислал recipe.
	// Иначе (частичное обновление) — существующие ингредиенты сохраняются.
	if recipeProvided {
		// Delete old recipe and recreate
		if _, err := tx.Exec(`DELETE FROM product_recipes WHERE product_id = ? AND account_id = ?`, productID, accID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		for _, recipeItem := range p.Recipe {
			warehouseItemID := recipeItem.WarehouseItemID
			if warehouseItemID == 0 {
				warehouseItemID = recipeItem.WarehouseItemIDSnake
			}
			ingredientName := strings.TrimSpace(recipeItem.IngredientName)
			if ingredientName == "" {
				ingredientName = strings.TrimSpace(recipeItem.ItemName)
			}
			if (warehouseItemID <= 0 && ingredientName == "") || recipeItem.Quantity <= 0 {
				continue
			}
			inputUnit := strings.TrimSpace(recipeItem.QuantityUnit)
			if inputUnit == "" {
				inputUnit = strings.TrimSpace(recipeItem.QuantityUnitSnake)
			}
			if inputUnit == "" {
				inputUnit = "g"
			}

			var storageQty float64
			var conversionNote string

			if warehouseItemID > 0 {
				var convErr error
				storageQty, conversionNote, convErr = convertRecipeToStorage(tx, accID, warehouseItemID, recipeItem.Quantity, inputUnit)
				if convErr != nil {
					storageQty = recipeItem.Quantity
					conversionNote = "conversion_error"
				}
			} else {
				storageQty = recipeItem.Quantity
				conversionNote = "pending_link"
				// Связываем ТОЛЬКО при строгом совпадении (autoLinkMatch) — иначе
				// оставляем pending_link для ручной привязки владельцем.
				foundID := autoLinkWarehouseItemTx(tx, accID, ingredientName)
				if foundID > 0 {
					warehouseItemID = foundID
					var convErr error
					storageQty, conversionNote, convErr = convertRecipeToStorage(tx, accID, warehouseItemID, recipeItem.Quantity, inputUnit)
					if convErr != nil {
						storageQty = recipeItem.Quantity
						conversionNote = "auto_linked"
					}
				}
			}

			pid := 0
			_ = tx.QueryRow(`SELECT id FROM menu_products WHERE id = ? AND account_id = ?`, productID, accID).Scan(&pid)
			if _, err := tx.Exec(`
			INSERT INTO product_recipes(account_id, product_id, warehouse_item_id, ingredient_name, quantity, input_quantity, input_unit, conversion_note)
			VALUES(?, ?, ?, ?, ?, ?, ?, ?)
		`, accID, productID, warehouseItemID, ingredientName, storageQty, recipeItem.Quantity, inputUnit, conversionNote); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
				return
			}
		}

		// Recalc auto cost from recipe
		if len(p.Recipe) > 0 && p.CostMode != "manual" {
			var autoCost float64
			_ = tx.QueryRow(`
			SELECT IFNULL(SUM(r.quantity * w.unit_cost), 0)
			FROM product_recipes r
			JOIN warehouse_items w ON w.id = r.warehouse_item_id AND w.account_id = r.account_id
			WHERE r.product_id = ? AND r.account_id = ?
		`, productID, accID).Scan(&autoCost)
			if autoCost > 0 {
				_, _ = tx.Exec(`UPDATE menu_products SET cost = ? WHERE id = ? AND account_id = ?`, autoCost, productID, accID)
			}
		}
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var result MenuProduct
	var hiddenInt int
	_ = db.QueryRow(`SELECT id, account_id, name, IFNULL(category,''), IFNULL(type,''), price, cost, IFNULL(category_id,0), IFNULL(hidden,0) FROM menu_products WHERE id = ? AND account_id = ?`, productID, accID).
		Scan(&result.ID, &result.AccountID, &result.Name, &result.Category, &result.Type, &result.Price, &result.Cost, &result.CategoryID, &hiddenInt)
	result.Hidden = hiddenInt == 1
	result.Recipe = loadProductRecipe(result.ID, result.AccountID)

	c.JSON(http.StatusOK, result)
}
