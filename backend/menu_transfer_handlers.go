package main

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// Перенос (копирование) меню между точками владельца.
// «Точка» = workspace; данные меню/склада привязаны к data_account_id точки.
// Обе точки должны принадлежать одному владельцу — проверяем workspaceExistsForOwner.

func intInClause(ids []int) (string, []any) {
	if len(ids) == 0 {
		return "(-1)", nil
	}
	ph := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		ph[i] = "?"
		args[i] = id
	}
	return "(" + strings.Join(ph, ",") + ")", args
}

// GET /menu/overview?dataAccountId=X
// Дерево меню конкретной точки: типы → категории (папки) → кол-во товаров.
// Нужно, чтобы владелец выбрал, что именно копировать из точки-источника.
func getMenuOverview(c *gin.Context) {
	if !requireOwner(c) {
		return
	}
	owner := ownerAccountID(c)
	dataID := parsePositiveInt(c.Query("dataAccountId"))
	if dataID == 0 {
		dataID = requestedDataAccountID(c)
	}
	if dataID == 0 || !workspaceExistsForOwner(owner, dataID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Точка не найдена"})
		return
	}

	type catOut struct {
		ID           int    `json:"id"`
		Name         string `json:"name"`
		ProductCount int    `json:"productCount"`
	}
	type typeOut struct {
		ID         int      `json:"id"`
		Name       string   `json:"name"`
		Categories []catOut `json:"categories"`
	}

	// Названия типов
	typeName := map[int]string{}
	typeOrder := []int{}
	if trows, err := db.Query(`SELECT id, name FROM product_types WHERE account_id = ? ORDER BY name`, dataID); err == nil {
		for trows.Next() {
			var id int
			var name string
			_ = trows.Scan(&id, &name)
			typeName[id] = name
			typeOrder = append(typeOrder, id)
		}
		trows.Close()
	}

	// Группируем по ИМЕНИ типа: категории хранят тип надёжно в поле `type` (name),
	// а type_id бывает нулевым — поэтому имя надёжнее для группировки.
	typeIDByName := map[string]int{}
	for _, id := range typeOrder {
		lname := strings.ToLower(strings.TrimSpace(typeName[id]))
		if lname != "" {
			if _, ok := typeIDByName[lname]; !ok {
				typeIDByName[lname] = id
			}
		}
	}

	groups := map[string]*typeOut{}
	order := []string{}
	getGroup := func(name string) *typeOut {
		key := strings.ToLower(name)
		if g, ok := groups[key]; ok {
			return g
		}
		g := &typeOut{ID: typeIDByName[key], Name: name, Categories: []catOut{}}
		groups[key] = g
		order = append(order, key)
		return g
	}

	rows, err := db.Query(`
		SELECT pc.id, pc.name, IFNULL(pc.type_id, 0), IFNULL(pc.type, ''),
		       (SELECT COUNT(*) FROM menu_products mp WHERE mp.account_id = pc.account_id AND mp.category_id = pc.id)
		FROM product_categories pc
		WHERE pc.account_id = ?
		ORDER BY pc.type, pc.name
	`, dataID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	for rows.Next() {
		var cat catOut
		var typeID int
		var typeStr string
		_ = rows.Scan(&cat.ID, &cat.Name, &typeID, &typeStr, &cat.ProductCount)
		gname := strings.TrimSpace(typeStr)
		if gname == "" && typeID > 0 {
			gname = strings.TrimSpace(typeName[typeID])
		}
		if gname == "" {
			gname = "Без раздела"
		}
		g := getGroup(gname)
		g.Categories = append(g.Categories, cat)
	}
	rows.Close()

	result := []typeOut{}
	for _, key := range order {
		result = append(result, *groups[key])
	}

	c.JSON(http.StatusOK, gin.H{"types": result})
}

// POST /menu/copy
// Body: { sourceDataAccountId, targetDataAccountId, typeIds[], categoryIds[], withRecipes }
// Копирует выбранные категории (и все категории выбранных типов) со всеми товарами
// из точки-источника в точку-получатель. Существующие типы/категории/товары/сырьё
// переиспользуются по имени (без дублей). Источник не изменяется.
func copyMenuBetweenWorkspaces(c *gin.Context) {
	if !requireOwner(c) {
		return
	}
	owner := ownerAccountID(c)

	var req struct {
		SourceDataAccountID int   `json:"sourceDataAccountId"`
		TargetDataAccountID int   `json:"targetDataAccountId"`
		TypeIDs             []int `json:"typeIds"`
		CategoryIDs         []int `json:"categoryIds"`
		WithRecipes         bool  `json:"withRecipes"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	src, dst := req.SourceDataAccountID, req.TargetDataAccountID
	if src <= 0 || dst <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Укажите точку-источник и точку-получатель"})
		return
	}
	if src == dst {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Выберите две разные точки"})
		return
	}
	if !workspaceExistsForOwner(owner, src) || !workspaceExistsForOwner(owner, dst) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Нет доступа к одной из точек"})
		return
	}
	if len(req.TypeIDs) == 0 && len(req.CategoryIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Выберите, что скопировать"})
		return
	}

	// ── Фаза 1: читаем источник (db, ДО транзакции — иначе deadlock при MaxOpenConns=1) ──

	// Множество категорий источника: выбранные напрямую + все категории выбранных типов.
	catIDSet := map[int]bool{}
	for _, id := range req.CategoryIDs {
		if id > 0 {
			catIDSet[id] = true
		}
	}
	if len(req.TypeIDs) > 0 {
		inC, inArgs := intInClause(req.TypeIDs)
		args := append([]any{src}, inArgs...)
		if rows, err := db.Query(`SELECT id FROM product_categories WHERE account_id = ? AND IFNULL(type_id,0) IN `+inC, args...); err == nil {
			for rows.Next() {
				var id int
				_ = rows.Scan(&id)
				catIDSet[id] = true
			}
			rows.Close()
		}
	}
	if len(catIDSet) == 0 {
		c.JSON(http.StatusOK, gin.H{"copiedCategories": 0, "copiedProducts": 0, "skippedProducts": 0, "createdWarehouseItems": 0, "message": "Нечего копировать"})
		return
	}
	catIDs := make([]int, 0, len(catIDSet))
	for id := range catIDSet {
		catIDs = append(catIDs, id)
	}

	// Названия типов источника (для восстановления связи тип→категория в получателе).
	srcTypeName := map[int]string{}
	if rows, err := db.Query(`SELECT id, name FROM product_types WHERE account_id = ?`, src); err == nil {
		for rows.Next() {
			var id int
			var name string
			_ = rows.Scan(&id, &name)
			srcTypeName[id] = name
		}
		rows.Close()
	}

	type srcCat struct {
		id       int
		name     string
		typeName string
	}
	srcCats := []srcCat{}
	{
		inC, inArgs := intInClause(catIDs)
		args := append([]any{src}, inArgs...)
		rows, err := db.Query(`SELECT id, name, IFNULL(type_id,0), IFNULL(type,'') FROM product_categories WHERE account_id = ? AND id IN `+inC, args...)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		for rows.Next() {
			var cat srcCat
			var typeID int
			var typeStr string
			_ = rows.Scan(&cat.id, &cat.name, &typeID, &typeStr)
			cat.typeName = strings.TrimSpace(typeStr)
			if cat.typeName == "" && typeID > 0 {
				cat.typeName = strings.TrimSpace(srcTypeName[typeID])
			}
			srcCats = append(srcCats, cat)
		}
		rows.Close()
	}

	type srcProd struct {
		id    int
		catID int
		name  string
		price float64
		cost  float64
	}
	srcProds := []srcProd{}
	prodIDs := []int{}
	{
		inC, inArgs := intInClause(catIDs)
		args := append([]any{src}, inArgs...)
		rows, err := db.Query(`SELECT id, IFNULL(category_id,0), name, IFNULL(price,0), IFNULL(cost,0) FROM menu_products WHERE account_id = ? AND category_id IN `+inC, args...)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		for rows.Next() {
			var p srcProd
			_ = rows.Scan(&p.id, &p.catID, &p.name, &p.price, &p.cost)
			srcProds = append(srcProds, p)
			prodIDs = append(prodIDs, p.id)
		}
		rows.Close()
	}

	type srcRec struct {
		productID      int
		ingredientName string
		unit           string
		quantity       float64
		inputQuantity  float64
		inputUnit      string
		note           string
	}
	srcRecs := []srcRec{}
	if req.WithRecipes && len(prodIDs) > 0 {
		inC, inArgs := intInClause(prodIDs)
		args := append([]any{src}, inArgs...)
		rows, err := db.Query(`
			SELECT r.product_id, IFNULL(r.warehouse_item_id,0), IFNULL(r.ingredient_name,''),
			       IFNULL(w.name,''), IFNULL(w.unit,''),
			       IFNULL(r.quantity,0), IFNULL(r.input_quantity,0), IFNULL(r.input_unit,''), IFNULL(r.conversion_note,'')
			FROM product_recipes r
			LEFT JOIN warehouse_items w ON w.id = r.warehouse_item_id AND w.account_id = r.account_id
			WHERE r.account_id = ? AND r.product_id IN `+inC, args...)
		if err == nil {
			for rows.Next() {
				var r srcRec
				var whID int
				var whName, whUnit string
				_ = rows.Scan(&r.productID, &whID, &r.ingredientName, &whName, &whUnit,
					&r.quantity, &r.inputQuantity, &r.inputUnit, &r.note)
				if whID > 0 && whName != "" {
					r.ingredientName = whName
				}
				r.unit = whUnit
				if r.unit == "" {
					r.unit = r.inputUnit
				}
				if r.unit == "" {
					r.unit = "g"
				}
				r.ingredientName = strings.TrimSpace(r.ingredientName)
				if r.ingredientName != "" {
					srcRecs = append(srcRecs, r)
				}
			}
			rows.Close()
		}
	}

	// ── Фаза 2: пишем в получателя (транзакция; только tx.* внутри) ──
	tx, err := db.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	now := time.Now().Format(time.RFC3339)

	summary := struct {
		copiedCategories int
		copiedProducts   int
		skippedProducts  int
		createdTypes     int
		createdCats      int
		createdItems     int
		copiedRecipes    int
	}{}

	typeCache := map[string]int{}
	findOrCreateType := func(name string) (int, error) {
		name = strings.TrimSpace(name)
		if name == "" {
			return 0, nil
		}
		if id, ok := typeCache[strings.ToLower(name)]; ok {
			return id, nil
		}
		var id int
		e := tx.QueryRow(`SELECT id FROM product_types WHERE account_id = ? AND LOWER(name) = LOWER(?) LIMIT 1`, dst, name).Scan(&id)
		if e != nil {
			res, ie := tx.Exec(`INSERT INTO product_types(account_id, name, created_at) VALUES(?, ?, ?)`, dst, name, now)
			if ie != nil {
				return 0, ie
			}
			id64, _ := res.LastInsertId()
			id = int(id64)
			summary.createdTypes++
		}
		typeCache[strings.ToLower(name)] = id
		return id, nil
	}

	catCache := map[string]int{}
	findOrCreateCat := func(name, typeName string) (int, error) {
		key := strings.ToLower(typeName) + "\x00" + strings.ToLower(name)
		if id, ok := catCache[key]; ok {
			return id, nil
		}
		typeID, e := findOrCreateType(typeName)
		if e != nil {
			return 0, e
		}
		var id int
		qe := tx.QueryRow(`SELECT id FROM product_categories WHERE account_id = ? AND LOWER(name) = LOWER(?) AND IFNULL(type,'') = ? LIMIT 1`, dst, name, typeName).Scan(&id)
		if qe != nil {
			res, ie := tx.Exec(`INSERT INTO product_categories(account_id, name, type_id, type, created_at) VALUES(?, ?, ?, ?, ?)`, dst, name, typeID, typeName, now)
			if ie != nil {
				return 0, ie
			}
			id64, _ := res.LastInsertId()
			id = int(id64)
			summary.createdCats++
		}
		catCache[key] = id
		return id, nil
	}

	itemCache := map[string]int{}
	findOrCreateItem := func(name, unit string) (int, error) {
		key := strings.ToLower(strings.TrimSpace(name))
		if key == "" {
			return 0, nil
		}
		if id, ok := itemCache[key]; ok {
			return id, nil
		}
		var id int
		e := tx.QueryRow(`SELECT id FROM warehouse_items WHERE account_id = ? AND LOWER(name) = LOWER(?) AND IFNULL(deleted,0) = 0 LIMIT 1`, dst, name).Scan(&id)
		if e != nil {
			if unit == "" {
				unit = "g"
			}
			res, ie := tx.Exec(`INSERT INTO warehouse_items(account_id, name, unit, quantity, created_at) VALUES(?, ?, ?, 0, ?)`, dst, name, unit, now)
			if ie != nil {
				return 0, ie
			}
			id64, _ := res.LastInsertId()
			id = int(id64)
			summary.createdItems++
		}
		itemCache[key] = id
		return id, nil
	}

	fail := func(e error) {
		_ = tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": e.Error()})
	}

	// Категория источника → категория получателя.
	catMap := map[int]int{}
	for _, cat := range srcCats {
		dstCatID, e := findOrCreateCat(cat.name, cat.typeName)
		if e != nil {
			fail(e)
			return
		}
		catMap[cat.id] = dstCatID
		summary.copiedCategories++
	}

	// Товары источника → получатель (пропускаем дубли по имени внутри категории).
	prodMap := map[int]int{}
	for _, p := range srcProds {
		dstCatID, ok := catMap[p.catID]
		if !ok || dstCatID == 0 {
			continue
		}
		var typeName string
		for _, cat := range srcCats {
			if cat.id == p.catID {
				typeName = cat.typeName
				break
			}
		}
		var exists int
		_ = tx.QueryRow(`SELECT COUNT(*) FROM menu_products WHERE account_id = ? AND category_id = ? AND LOWER(name) = LOWER(?)`, dst, dstCatID, p.name).Scan(&exists)
		if exists > 0 {
			summary.skippedProducts++
			continue
		}
		var catName string
		for _, cat := range srcCats {
			if cat.id == p.catID {
				catName = cat.name
				break
			}
		}
		res, ie := tx.Exec(`INSERT INTO menu_products(account_id, category_id, name, category, type, price, cost, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
			dst, dstCatID, p.name, catName, typeName, p.price, p.cost, now)
		if ie != nil {
			fail(ie)
			return
		}
		id64, _ := res.LastInsertId()
		prodMap[p.id] = int(id64)
		summary.copiedProducts++
	}

	// Рецепты источника → получатель (создаём недостающее сырьё в складе получателя).
	if req.WithRecipes {
		for _, r := range srcRecs {
			dstProdID, ok := prodMap[r.productID]
			if !ok || dstProdID == 0 {
				continue // товар был пропущен как дубль — рецепт не дублируем
			}
			itemID, ie := findOrCreateItem(r.ingredientName, r.unit)
			if ie != nil {
				fail(ie)
				return
			}
			_, ie = tx.Exec(`INSERT INTO product_recipes(account_id, product_id, warehouse_item_id, ingredient_name, quantity, input_quantity, input_unit, conversion_note) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
				dst, dstProdID, itemID, r.ingredientName, r.quantity, r.inputQuantity, r.inputUnit, r.note)
			if ie != nil {
				fail(ie)
				return
			}
			summary.copiedRecipes++
		}
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"copiedCategories":      summary.copiedCategories,
		"copiedProducts":        summary.copiedProducts,
		"skippedProducts":       summary.skippedProducts,
		"createdTypes":          summary.createdTypes,
		"createdCategories":     summary.createdCats,
		"createdWarehouseItems": summary.createdItems,
		"copiedRecipes":         summary.copiedRecipes,
	})
}
