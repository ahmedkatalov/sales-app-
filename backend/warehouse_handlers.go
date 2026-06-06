package main

import (
	"database/sql"
	"github.com/gin-gonic/gin"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func normalizeWarehouseUnit(unit string, quantity float64, minQuantity float64) (string, float64, float64) {
	unit = strings.TrimSpace(strings.ToLower(unit))

	switch unit {
	case "kg", "кг":
		return "g", quantity * 1000, minQuantity * 1000
	case "g", "гр", "г":
		return "g", quantity, minQuantity
	case "l", "л", "liter", "литр":
		return "ml", quantity * 1000, minQuantity * 1000
	case "ml", "мл":
		return "ml", quantity, minQuantity
	case "pcs", "piece", "шт", "штука", "штук":
		return "pcs", quantity, minQuantity
	case "bottle", "бут", "бутылка", "бутылки":
		return "bottle", quantity, minQuantity
	case "pack", "упак", "упаковка", "упаковки":
		return "pack", quantity, minQuantity
	case "box", "кор", "коробка", "коробки":
		return "box", quantity, minQuantity
	default:
		return "pcs", quantity, minQuantity
	}
}

func isPieceUnit(unit string) bool {
	unit = strings.TrimSpace(strings.ToLower(unit))
	return unit == "pcs" || unit == "bottle" || unit == "pack" || unit == "box"
}

func isBaseWeightOrVolumeUnit(unit string) bool {
	unit = strings.TrimSpace(strings.ToLower(unit))
	return unit == "g" || unit == "ml"
}

func purchaseUnitFromItem(item WarehouseItem) string {
	unit := strings.TrimSpace(item.PurchaseUnit)
	if unit == "" {
		unit = strings.TrimSpace(item.PurchaseUnitSnake)
	}
	if unit == "" {
		unit = strings.TrimSpace(item.Unit)
	}
	return unit
}

func normalizePurchaseQuantity(item WarehouseItem, existingStorageUnit string) (string, float64, float64, string, error) {
	storageUnit, _, minQuantity := normalizeWarehouseUnit(item.Unit, 0, item.MinQuantity)
	if strings.TrimSpace(existingStorageUnit) != "" {
		storageUnit = strings.TrimSpace(strings.ToLower(existingStorageUnit))
	}

	purchaseUnitRaw := purchaseUnitFromItem(item)
	purchaseUnit, normalizedPurchaseQty, _ := normalizeWarehouseUnit(purchaseUnitRaw, item.Quantity, 0)

	baseQuantity := normalizedPurchaseQty
	note := ""

	if purchaseUnit == storageUnit {
		baseQuantity = normalizedPurchaseQty
		note = "Закупка в базовой единице"
	} else if isPieceUnit(purchaseUnit) && isBaseWeightOrVolumeUnit(storageUnit) {
		perOne := item.PackagingQuantity
		if perOne <= 0 {
			return storageUnit, 0, minQuantity, "", sql.ErrNoRows
		}
		baseQuantity = item.Quantity * perOne
		note = "Закупка упаковками: " + strconv.FormatFloat(item.Quantity, 'f', 2, 64) + " " + purchaseUnit + " × " + strconv.FormatFloat(perOne, 'f', 2, 64) + " " + storageUnit
	} else if isBaseWeightOrVolumeUnit(purchaseUnit) && isPieceUnit(storageUnit) {
		perOne := item.PackagingQuantity
		if perOne <= 0 {
			return storageUnit, 0, minQuantity, "", sql.ErrNoRows
		}
		baseQuantity = normalizedPurchaseQty / perOne
		note = "Закупка весом/объёмом в штучный товар"
	} else {
		return storageUnit, 0, minQuantity, "", sql.ErrNoRows
	}

	if baseQuantity <= 0 {
		return storageUnit, 0, minQuantity, "", sql.ErrNoRows
	}

	return storageUnit, baseQuantity, minQuantity, note, nil
}

func guessOnePieceToBase(name string, storageUnit string) float64 {
	n := normalizeWarehouseName(name)
	storageUnit = strings.TrimSpace(strings.ToLower(storageUnit))

	if storageUnit == "g" {
		switch {
		case strings.Contains(n, "апельсин"):
			return 180
		case strings.Contains(n, "лимон"):
			return 100
		case strings.Contains(n, "яблок"):
			return 180
		case strings.Contains(n, "банан"):
			return 120
		case strings.Contains(n, "лайм"):
			return 70
		case strings.Contains(n, "яйц"):
			return 60
		default:
			return 100
		}
	}

	if storageUnit == "ml" {
		switch {
		case strings.Contains(n, "сироп"):
			return 700
		case strings.Contains(n, "молок"):
			return 1000
		case strings.Contains(n, "вода"):
			return 1000
		default:
			return 1000
		}
	}

	return 1
}

func convertRecipeToStorage(accID int, warehouseItemID int, inputQty float64, inputUnit string) (float64, string, error) {
	if inputQty <= 0 {
		return 0, "", nil
	}

	var name string
	var storageUnit string
	var lossPercent float64
	var packagingQuantity float64
	if err := db.QueryRow(`
		SELECT name, unit, IFNULL(loss_percent, 0), IFNULL(packaging_quantity, 0)
		FROM warehouse_items
		WHERE id = ? AND account_id = ?
	`, warehouseItemID, accID).Scan(&name, &storageUnit, &lossPercent, &packagingQuantity); err != nil {
		return 0, "", err
	}

	inputUnit = strings.TrimSpace(strings.ToLower(inputUnit))
	if inputUnit == "" {
		inputUnit = storageUnit
	}

	from, normalizedQty, _ := normalizeWarehouseUnit(inputUnit, inputQty, 0)
	storageUnit = strings.TrimSpace(strings.ToLower(storageUnit))

	converted := normalizedQty
	note := "Без конвертации"

	if from == storageUnit {
		converted = normalizedQty
		note = "Единицы совпадают"
	} else if (from == "pcs" || from == "bottle" || from == "pack" || from == "box") && (storageUnit == "g" || storageUnit == "ml") {
		perOne := packagingQuantity
		if perOne <= 0 || perOne == 1 {
			perOne = guessOnePieceToBase(name, storageUnit)
		}
		converted = inputQty * perOne
		note = "Умная конвертация: 1 " + inputUnit + " = " + strconv.FormatFloat(perOne, 'f', 2, 64) + " " + storageUnit
	} else if (storageUnit == "pcs" || storageUnit == "bottle" || storageUnit == "pack" || storageUnit == "box") && (from == "g" || from == "ml") {
		perOne := packagingQuantity
		if perOne <= 0 || perOne == 1 {
			perOne = guessOnePieceToBase(name, from)
		}
		converted = normalizedQty / perOne
		note = "Умная конвертация: " + strconv.FormatFloat(perOne, 'f', 2, 64) + " " + from + " = 1 " + storageUnit
	} else {
		return 0, "Нужна конвертация для " + name, sql.ErrNoRows
	}

	if lossPercent > 0 {
		converted = converted * (1 + lossPercent/100)
		note += "; потери +" + strconv.FormatFloat(lossPercent, 'f', 2, 64) + "%"
	}

	return converted, note, nil
}

func getWarehouseItems(c *gin.Context) {
	cleanupWarehouseItemNames(accountID(c))

	rows, err := db.Query(`
		SELECT id, account_id, name, unit, quantity, price, unit_cost,
		       IFNULL(supplier, ''), IFNULL(expiry_date, ''), IFNULL(min_quantity, 0), IFNULL(note, ''), IFNULL(hidden, 0), IFNULL(created_at, ''), IFNULL(control_mode, 'exact'), IFNULL(loss_percent, 0), IFNULL(inventory_method, 'fifo'), IFNULL(packaging_quantity, 1)
		FROM warehouse_items
		WHERE account_id = ? AND IFNULL(deleted, 0) = 0
		ORDER BY IFNULL(hidden, 0), name
	`, accountID(c))

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	items := []WarehouseItem{}

	for rows.Next() {
		var item WarehouseItem
		var hiddenInt int

		if err := rows.Scan(
			&item.ID,
			&item.AccountID,
			&item.Name,
			&item.Unit,
			&item.Quantity,
			&item.Price,
			&item.UnitCost,
			&item.Supplier,
			&item.ExpiryDate,
			&item.MinQuantity,
			&item.Note,
			&hiddenInt,
			&item.CreatedAt,
			&item.ControlMode,
			&item.LossPercent,
			&item.InventoryMethod,
			&item.PackagingQuantity,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		item.Hidden = hiddenInt == 1
		cleanName := cleanAIProductName(item.Name)
		if cleanName != "" && cleanName != item.Name {
			_, _ = db.Exec(`UPDATE warehouse_items SET name = ? WHERE id = ? AND account_id = ?`, cleanName, item.ID, item.AccountID)
			item.Name = cleanName
		}
		items = append(items, item)
	}

	c.JSON(http.StatusOK, items)
}

func createWarehouseItem(c *gin.Context) {
	var item WarehouseItem

	if err := c.ShouldBindJSON(&item); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	item.Name = cleanAIProductName(item.Name)
	if item.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "warehouse item name required"})
		return
	}

	if item.Quantity <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "quantity must be greater than zero"})
		return
	}

	item.AccountID = accountID(c)
	cleanupWarehouseItemNames(item.AccountID)
	storageUnit, baseQuantity, minQuantity, purchaseNote, normErr := normalizePurchaseQuantity(item, "")
	if normErr != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Проверь единицы закупки: для г/мл можно закупать в г/кг/мл/л или в штуках с заполненным весом/объёмом 1 штуки"})
		return
	}
	item.Unit = storageUnit
	item.Quantity = baseQuantity
	item.MinQuantity = minQuantity
	if purchaseNote != "" {
		if strings.TrimSpace(item.Note) != "" {
			item.Note += "; " + purchaseNote
		} else {
			item.Note = purchaseNote
		}
	}

	if item.Price < 0 {
		item.Price = 0
	}

	if item.Quantity > 0 {
		item.UnitCost = item.Price / item.Quantity
	}

	now := time.Now().Format(time.RFC3339)

	var itemID int
	findErr := db.QueryRow(`
		SELECT id
		FROM warehouse_items
		WHERE account_id = ? AND lower(name) = lower(?) AND unit = ? AND IFNULL(hidden, 0) = 0 AND IFNULL(deleted, 0) = 0
		ORDER BY id DESC
		LIMIT 1
	`, item.AccountID, item.Name, item.Unit).Scan(&itemID)

	if findErr != nil || itemID == 0 {
		if item.ControlMode == "" {
			item.ControlMode = "exact"
		}
		if item.InventoryMethod == "" {
			item.InventoryMethod = "fifo"
		}
		if item.PackagingQuantity <= 0 {
			item.PackagingQuantity = 1
		}
		res, err := db.Exec(`
			INSERT INTO warehouse_items(account_id, name, unit, quantity, price, unit_cost, supplier, expiry_date, min_quantity, note, created_at, control_mode, loss_percent, inventory_method, packaging_quantity)
			VALUES(?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, item.AccountID, item.Name, item.Unit, item.Supplier, item.ExpiryDate, item.MinQuantity, item.Note, now, item.ControlMode, item.LossPercent, item.InventoryMethod, item.PackagingQuantity)

		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		id, _ := res.LastInsertId()
		itemID = int(id)
	} else {
		// Если это повторная закупка уже существующего сырья, обновляем настройки учёта.
		// Это важно для сценариев вроде: сырьё хранится в граммах, а новая закупка введена как
		// "5 упаковок × 100 г" — коэффициент упаковки должен остаться у товара для рецептов.
		if item.PackagingQuantity > 0 {
			_, _ = db.Exec(`
				UPDATE warehouse_items
				SET packaging_quantity = ?, control_mode = ?, loss_percent = ?, inventory_method = ?
				WHERE id = ? AND account_id = ?
			`, item.PackagingQuantity, item.ControlMode, item.LossPercent, item.InventoryMethod, itemID, item.AccountID)
		}
	}

	_, err := db.Exec(`
		INSERT INTO stock_batches(account_id, warehouse_item_id, quantity, remaining_quantity, purchase_price, unit_cost, supplier, expiry_date, note, created_at)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, item.AccountID, itemID, item.Quantity, item.Quantity, item.Price, item.UnitCost, item.Supplier, item.ExpiryDate, item.Note, now)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	_, _ = db.Exec(`
		INSERT INTO warehouse_movements(account_id, warehouse_item_id, movement_type, quantity, reason, note, created_at)
		VALUES(?, ?, 'in', ?, 'Приход', ?, ?)
	`, item.AccountID, itemID, item.Quantity, item.Note, now)

	recalcWarehouseItem(itemID, item.AccountID)
	var hiddenInt int
	_ = db.QueryRow(`
		SELECT id, account_id, name, unit, quantity, price, unit_cost, IFNULL(supplier, ''), IFNULL(expiry_date, ''), IFNULL(min_quantity, 0), IFNULL(note, ''), IFNULL(hidden, 0), IFNULL(created_at, ''), IFNULL(control_mode, 'exact'), IFNULL(loss_percent, 0), IFNULL(inventory_method, 'fifo'), IFNULL(packaging_quantity, 1)
		FROM warehouse_items
		WHERE id = ? AND account_id = ?
	`, itemID, item.AccountID).Scan(&item.ID, &item.AccountID, &item.Name, &item.Unit, &item.Quantity, &item.Price, &item.UnitCost, &item.Supplier, &item.ExpiryDate, &item.MinQuantity, &item.Note, &hiddenInt, &item.CreatedAt, &item.ControlMode, &item.LossPercent, &item.InventoryMethod, &item.PackagingQuantity)
	item.Hidden = hiddenInt == 1

	c.JSON(http.StatusOK, item)
}

func getWarehouseMovements(c *gin.Context) {
	rows, err := db.Query(`
		SELECT
			m.id,
			m.account_id,
			m.warehouse_item_id,
			IFNULL(w.name, ''),
			IFNULL(w.unit, ''),
			m.movement_type,
			m.quantity,
			IFNULL(m.reason, ''),
			IFNULL(m.note, ''),
			IFNULL(m.created_at, '')
		FROM warehouse_movements m
		LEFT JOIN warehouse_items w ON w.id = m.warehouse_item_id
		WHERE m.account_id = ?
		ORDER BY m.id DESC
		LIMIT 300
	`, accountID(c))

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	list := []WarehouseMovement{}

	for rows.Next() {
		var m WarehouseMovement

		if err := rows.Scan(
			&m.ID,
			&m.AccountID,
			&m.WarehouseItemID,
			&m.ItemName,
			&m.Unit,
			&m.MovementType,
			&m.Quantity,
			&m.Reason,
			&m.Note,
			&m.CreatedAt,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		list = append(list, m)
	}

	c.JSON(http.StatusOK, list)
}

func writeOffWarehouseItem(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	accID := accountID(c)

	var req struct {
		Quantity float64 `json:"quantity"`
		Reason   string  `json:"reason"`
		Note     string  `json:"note"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Quantity <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "quantity must be greater than zero"})
		return
	}

	var available float64
	if err := db.QueryRow(`SELECT quantity FROM warehouse_items WHERE id = ? AND account_id = ?`, id, accID).Scan(&available); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Сырьё не найдено"})
		return
	}

	if available < req.Quantity {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недостаточно остатка на складе"})
		return
	}

	if strings.TrimSpace(req.Reason) == "" {
		req.Reason = "Утиль"
	}

	if err := consumeWarehouseFIFO(accID, id, req.Quantity, req.Reason, req.Note, "writeoff", time.Now().Format(time.RFC3339)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Недостаточно остатка на складе"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

func recalcWarehouseItem(itemID int, accID int) {
	var qty float64
	var value float64
	_ = db.QueryRow(`
		SELECT IFNULL(SUM(remaining_quantity), 0), IFNULL(SUM(remaining_quantity * unit_cost), 0)
		FROM stock_batches
		WHERE warehouse_item_id = ? AND account_id = ?
	`, itemID, accID).Scan(&qty, &value)

	unitCost := 0.0
	if qty > 0 {
		unitCost = value / qty
	}

	_, _ = db.Exec(`
		UPDATE warehouse_items
		SET quantity = ?, price = ?, unit_cost = ?
		WHERE id = ? AND account_id = ?
	`, qty, value, unitCost, itemID, accID)
}

func consumeWarehouseFIFO(accID int, itemID int, qty float64, reason string, note string, movementType string, createdAt string) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := consumeWarehouseFIFOTx(tx, accID, itemID, qty, reason, note, movementType, createdAt); err != nil {
		return err
	}
	return tx.Commit()
}

func consumeWarehouseFIFOTx(tx *sql.Tx, accID int, itemID int, qty float64, reason string, note string, movementType string, createdAt string) (float64, error) {
	remaining := qty
	rows, err := tx.Query(`
		SELECT id, remaining_quantity, IFNULL(unit_cost, 0)
		FROM stock_batches
		WHERE account_id = ? AND warehouse_item_id = ? AND remaining_quantity > 0
		ORDER BY datetime(created_at), id
	`, accID, itemID)
	if err != nil {
		return 0, err
	}

	type batchNeed struct {
		ID       int
		Take     float64
		UnitCost float64
	}
	needs := []batchNeed{}
	totalCost := 0.0

	for rows.Next() && remaining > 0.000001 {
		var batchID int
		var available float64
		var unitCost float64
		if err := rows.Scan(&batchID, &available, &unitCost); err != nil {
			return 0, err
		}

		take := available
		if take > remaining {
			take = remaining
		}

		needs = append(needs, batchNeed{ID: batchID, Take: take, UnitCost: unitCost})
		totalCost += take * unitCost
		remaining -= take
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	if err := rows.Close(); err != nil {
		return 0, err
	}

	if remaining > 0.000001 {
		return 0, sql.ErrNoRows
	}

	for _, need := range needs {
		res, err := tx.Exec(`
			UPDATE stock_batches
			SET remaining_quantity = remaining_quantity - ?
			WHERE id = ? AND account_id = ? AND remaining_quantity + 0.000001 >= ?
		`, need.Take, need.ID, accID, need.Take)
		if err != nil {
			return 0, err
		}
		affected, _ := res.RowsAffected()
		if affected == 0 {
			return 0, sql.ErrNoRows
		}
	}

	if _, err := tx.Exec(`
		INSERT INTO warehouse_movements(account_id, warehouse_item_id, movement_type, quantity, reason, note, created_at)
		VALUES(?, ?, ?, ?, ?, ?, ?)
	`, accID, itemID, movementType, qty, reason, note, createdAt); err != nil {
		return 0, err
	}

	if err := recalcWarehouseItemTx(tx, itemID, accID); err != nil {
		return 0, err
	}
	return totalCost, nil
}

func reserveWarehouseFIFOTx(tx *sql.Tx, pendingSaleID int64, accID int, productID int, itemID int, qty float64, createdAt string) (float64, error) {
	remaining := qty
	rows, err := tx.Query(`
		SELECT id, remaining_quantity, IFNULL(unit_cost, 0)
		FROM stock_batches
		WHERE account_id = ? AND warehouse_item_id = ? AND remaining_quantity > 0
		ORDER BY datetime(created_at), id
	`, accID, itemID)
	if err != nil {
		return 0, err
	}

	type batchNeed struct {
		ID       int
		Take     float64
		UnitCost float64
	}
	needs := []batchNeed{}
	totalCost := 0.0

	for rows.Next() && remaining > 0.000001 {
		var batchID int
		var available float64
		var unitCost float64
		if err := rows.Scan(&batchID, &available, &unitCost); err != nil {
			rows.Close()
			return 0, err
		}
		take := available
		if take > remaining {
			take = remaining
		}
		needs = append(needs, batchNeed{ID: batchID, Take: take, UnitCost: unitCost})
		totalCost += take * unitCost
		remaining -= take
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	if err := rows.Close(); err != nil {
		return 0, err
	}
	if remaining > 0.000001 {
		return 0, sql.ErrNoRows
	}

	for _, need := range needs {
		res, err := tx.Exec(`
			UPDATE stock_batches
			SET remaining_quantity = remaining_quantity - ?
			WHERE id = ? AND account_id = ? AND remaining_quantity + 0.000001 >= ?
		`, need.Take, need.ID, accID, need.Take)
		if err != nil {
			return 0, err
		}
		affected, _ := res.RowsAffected()
		if affected == 0 {
			return 0, sql.ErrNoRows
		}
		if _, err := tx.Exec(`
			INSERT INTO pending_sale_reservations(pending_sale_id, account_id, product_id, warehouse_item_id, batch_id, quantity, unit_cost, total_cost, created_at)
			VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, pendingSaleID, accID, productID, itemID, need.ID, need.Take, need.UnitCost, need.Take*need.UnitCost, createdAt); err != nil {
			return 0, err
		}
	}

	if _, err := tx.Exec(`
		INSERT INTO warehouse_movements(account_id, warehouse_item_id, movement_type, quantity, reason, note, created_at)
		VALUES(?, ?, 'reserve', ?, 'Резерв ожидания оплаты', ?, ?)
	`, accID, itemID, qty, "Ожидание оплаты #"+strconv.FormatInt(pendingSaleID, 10), createdAt); err != nil {
		return 0, err
	}

	if err := recalcWarehouseItemTx(tx, itemID, accID); err != nil {
		return 0, err
	}
	return totalCost, nil
}

func releasePendingSaleReservationsTx(tx *sql.Tx, pendingSaleID int, accID int, createdAt string) error {
	rows, err := tx.Query(`
		SELECT warehouse_item_id, batch_id, quantity
		FROM pending_sale_reservations
		WHERE pending_sale_id = ? AND account_id = ?
		ORDER BY id
	`, pendingSaleID, accID)
	if err != nil {
		return err
	}
	defer rows.Close()

	type reservation struct {
		WarehouseItemID int
		BatchID         int
		Quantity        float64
	}
	reservations := []reservation{}
	for rows.Next() {
		var r reservation
		if err := rows.Scan(&r.WarehouseItemID, &r.BatchID, &r.Quantity); err != nil {
			return err
		}
		reservations = append(reservations, r)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, r := range reservations {
		if _, err := tx.Exec(`
			UPDATE stock_batches
			SET remaining_quantity = remaining_quantity + ?
			WHERE id = ? AND account_id = ?
		`, r.Quantity, r.BatchID, accID); err != nil {
			return err
		}
		if _, err := tx.Exec(`
			INSERT INTO warehouse_movements(account_id, warehouse_item_id, movement_type, quantity, reason, note, created_at)
			VALUES(?, ?, 'release', ?, 'Отмена резерва ожидания оплаты', ?, ?)
		`, accID, r.WarehouseItemID, r.Quantity, "Ожидание оплаты #"+strconv.Itoa(pendingSaleID), createdAt); err != nil {
			return err
		}
		if err := recalcWarehouseItemTx(tx, r.WarehouseItemID, accID); err != nil {
			return err
		}
	}

	_, err = tx.Exec(`DELETE FROM pending_sale_reservations WHERE pending_sale_id = ? AND account_id = ?`, pendingSaleID, accID)
	return err
}

func recalcWarehouseItemTx(tx *sql.Tx, itemID int, accID int) error {
	var qty float64
	var value float64
	if err := tx.QueryRow(`
		SELECT IFNULL(SUM(remaining_quantity), 0), IFNULL(SUM(remaining_quantity * unit_cost), 0)
		FROM stock_batches
		WHERE warehouse_item_id = ? AND account_id = ?
	`, itemID, accID).Scan(&qty, &value); err != nil {
		return err
	}

	unitCost := 0.0
	if qty > 0 {
		unitCost = value / qty
	}

	_, err := tx.Exec(`
		UPDATE warehouse_items
		SET quantity = ?, price = ?, unit_cost = ?
		WHERE id = ? AND account_id = ?
	`, qty, value, unitCost, itemID, accID)
	return err
}

func getWarehouseBatches(c *gin.Context) {
	itemID, _ := strconv.Atoi(c.Param("id"))
	accID := accountID(c)

	rows, err := db.Query(`
		SELECT id, warehouse_item_id, quantity, remaining_quantity, purchase_price, unit_cost,
		       IFNULL(supplier, ''), IFNULL(expiry_date, ''), IFNULL(note, ''), IFNULL(created_at, '')
		FROM stock_batches
		WHERE account_id = ? AND warehouse_item_id = ?
		ORDER BY datetime(created_at) DESC, id DESC
	`, accID, itemID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	list := []gin.H{}
	for rows.Next() {
		var id int
		var warehouseItemID int
		var quantity float64
		var remainingQuantity float64
		var purchasePrice float64
		var unitCost float64
		var supplier string
		var expiryDate string
		var note string
		var createdAt string

		if err := rows.Scan(&id, &warehouseItemID, &quantity, &remainingQuantity, &purchasePrice, &unitCost, &supplier, &expiryDate, &note, &createdAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		list = append(list, gin.H{
			"id":                id,
			"warehouseItemId":   warehouseItemID,
			"quantity":          quantity,
			"remainingQuantity": remainingQuantity,
			"purchasePrice":     purchasePrice,
			"unitCost":          unitCost,
			"supplier":          supplier,
			"expiryDate":        expiryDate,
			"note":              note,
			"createdAt":         createdAt,
		})
	}

	c.JSON(http.StatusOK, list)
}

func updateWarehouseItem(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	accID := accountID(c)

	var req WarehouseItem
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var existing WarehouseItem
	if err := db.QueryRow(`
		SELECT id, account_id, name, unit, quantity, price, unit_cost, IFNULL(min_quantity, 0), IFNULL(note, ''), IFNULL(control_mode, 'exact'), IFNULL(loss_percent, 0), IFNULL(inventory_method, 'fifo'), IFNULL(packaging_quantity, 1)
		FROM warehouse_items
		WHERE id = ? AND account_id = ?
	`, id, accID).Scan(&existing.ID, &existing.AccountID, &existing.Name, &existing.Unit, &existing.Quantity, &existing.Price, &existing.UnitCost, &existing.MinQuantity, &existing.Note, &existing.ControlMode, &existing.LossPercent, &existing.InventoryMethod, &existing.PackagingQuantity); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Товар склада не найден"})
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = existing.Name
	}
	note := req.Note
	if strings.TrimSpace(note) == "" {
		note = existing.Note
	}
	minQuantity := req.MinQuantity
	if minQuantity <= 0 {
		minQuantity = existing.MinQuantity
	}
	controlMode := req.ControlMode
	if strings.TrimSpace(controlMode) == "" {
		controlMode = existing.ControlMode
	}
	inventoryMethod := req.InventoryMethod
	if strings.TrimSpace(inventoryMethod) == "" {
		inventoryMethod = existing.InventoryMethod
	}
	packagingQuantity := req.PackagingQuantity
	if packagingQuantity <= 0 {
		packagingQuantity = existing.PackagingQuantity
	}
	lossPercent := req.LossPercent
	if lossPercent == 0 {
		lossPercent = existing.LossPercent
	}

	_, err := db.Exec(`
		UPDATE warehouse_items
		SET name = ?, min_quantity = ?, note = ?, control_mode = ?, loss_percent = ?, inventory_method = ?, packaging_quantity = ?
		WHERE id = ? AND account_id = ?
	`, name, minQuantity, note, controlMode, lossPercent, inventoryMethod, packagingQuantity, id, accID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if req.Price > 0 {
		var batchID int
		var qty float64
		if err := db.QueryRow(`
			SELECT id, quantity
			FROM stock_batches
			WHERE warehouse_item_id = ? AND account_id = ?
			ORDER BY datetime(created_at) DESC, id DESC
			LIMIT 1
		`, id, accID).Scan(&batchID, &qty); err == nil && batchID > 0 && qty > 0 {
			unitCost := req.Price / qty
			_, _ = db.Exec(`
				UPDATE stock_batches
				SET purchase_price = ?, unit_cost = ?
				WHERE id = ? AND account_id = ?
			`, req.Price, unitCost, batchID, accID)
		}
	}

	recalcWarehouseItem(id, accID)

	var item WarehouseItem
	var hiddenInt int
	_ = db.QueryRow(`
		SELECT id, account_id, name, unit, quantity, price, unit_cost, IFNULL(supplier, ''), IFNULL(expiry_date, ''), IFNULL(min_quantity, 0), IFNULL(note, ''), IFNULL(hidden, 0), IFNULL(created_at, ''), IFNULL(control_mode, 'exact'), IFNULL(loss_percent, 0), IFNULL(inventory_method, 'fifo'), IFNULL(packaging_quantity, 1)
		FROM warehouse_items
		WHERE id = ? AND account_id = ?
	`, id, accID).Scan(&item.ID, &item.AccountID, &item.Name, &item.Unit, &item.Quantity, &item.Price, &item.UnitCost, &item.Supplier, &item.ExpiryDate, &item.MinQuantity, &item.Note, &hiddenInt, &item.CreatedAt, &item.ControlMode, &item.LossPercent, &item.InventoryMethod, &item.PackagingQuantity)
	item.Hidden = hiddenInt == 1
	c.JSON(http.StatusOK, item)
}

func deleteLastWarehousePurchase(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	accID := accountID(c)

	var batchID int
	var qty float64
	var remaining float64
	var createdAt string
	if err := db.QueryRow(`
		SELECT id, quantity, remaining_quantity, IFNULL(created_at, '')
		FROM stock_batches
		WHERE warehouse_item_id = ? AND account_id = ?
		ORDER BY datetime(created_at) DESC, id DESC
		LIMIT 1
	`, id, accID).Scan(&batchID, &qty, &remaining, &createdAt); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Закупка по этому товару не найдена"})
		return
	}

	if remaining < qty-0.000001 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Последнюю закупку уже частично списали. Сначала проверьте списания/продажи по этому товару."})
		return
	}

	_, err := db.Exec(`DELETE FROM stock_batches WHERE id = ? AND account_id = ?`, batchID, accID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	_, _ = db.Exec(`
		DELETE FROM warehouse_movements
		WHERE id IN (
			SELECT id FROM warehouse_movements
			WHERE warehouse_item_id = ? AND account_id = ? AND movement_type = 'in'
			ORDER BY datetime(created_at) DESC, id DESC
			LIMIT 1
		)
	`, id, accID)

	recalcWarehouseItem(id, accID)
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func getDeletedWarehouseItems(c *gin.Context) {
	rows, err := db.Query(`
		SELECT id, account_id, name, unit, quantity, price, unit_cost,
		       IFNULL(supplier, ''), IFNULL(expiry_date, ''), IFNULL(min_quantity, 0), IFNULL(note, ''), IFNULL(hidden, 0), IFNULL(created_at, ''), IFNULL(control_mode, 'exact'), IFNULL(loss_percent, 0), IFNULL(inventory_method, 'fifo'), IFNULL(packaging_quantity, 1), IFNULL(deleted_at, ''), IFNULL(delete_reason, ''), IFNULL(delete_note, '')
		FROM warehouse_items
		WHERE account_id = ? AND IFNULL(deleted, 0) = 1
		ORDER BY datetime(IFNULL(deleted_at, created_at)) DESC, id DESC
		LIMIT 300
	`, accountID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	list := []gin.H{}
	for rows.Next() {
		var item WarehouseItem
		var hiddenInt int
		var deletedAt, deleteReason, deleteNote string
		if err := rows.Scan(&item.ID, &item.AccountID, &item.Name, &item.Unit, &item.Quantity, &item.Price, &item.UnitCost, &item.Supplier, &item.ExpiryDate, &item.MinQuantity, &item.Note, &hiddenInt, &item.CreatedAt, &item.ControlMode, &item.LossPercent, &item.InventoryMethod, &item.PackagingQuantity, &deletedAt, &deleteReason, &deleteNote); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		item.Hidden = hiddenInt == 1
		list = append(list, gin.H{
			"id":           item.ID,
			"accountId":    item.AccountID,
			"name":         item.Name,
			"unit":         item.Unit,
			"quantity":     item.Quantity,
			"price":        item.Price,
			"unitCost":     item.UnitCost,
			"supplier":     item.Supplier,
			"expiryDate":   item.ExpiryDate,
			"minQuantity":  item.MinQuantity,
			"note":         item.Note,
			"createdAt":    item.CreatedAt,
			"deletedAt":    deletedAt,
			"deleteReason": deleteReason,
			"deleteNote":   deleteNote,
			"totalValue":   item.Quantity * item.UnitCost,
		})
	}

	c.JSON(http.StatusOK, list)
}

func deleteWarehouseItem(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	accID := accountID(c)

	var req struct {
		Reason string `json:"reason"`
		Note   string `json:"note"`
	}
	_ = c.ShouldBindJSON(&req)

	reason := strings.TrimSpace(req.Reason)
	if reason == "" {
		reason = "Удалено вручную"
	}
	note := strings.TrimSpace(req.Note)
	now := time.Now().Format(time.RFC3339)

	var name string
	var qty float64
	var unit string
	if err := db.QueryRow(`
		SELECT name, quantity, unit
		FROM warehouse_items
		WHERE id = ? AND account_id = ? AND IFNULL(deleted, 0) = 0
	`, id, accID).Scan(&name, &qty, &unit); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Товар склада не найден или уже удалён"})
		return
	}

	_, err := db.Exec(`
		UPDATE warehouse_items
		SET deleted = 1, hidden = 1, deleted_at = ?, delete_reason = ?, delete_note = ?
		WHERE id = ? AND account_id = ?
	`, now, reason, note, id, accID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	_, _ = db.Exec(`
		INSERT INTO warehouse_movements(account_id, warehouse_item_id, movement_type, quantity, reason, note, created_at)
		VALUES(?, ?, 'delete', ?, ?, ?, ?)
	`, accID, id, qty, reason, note, now)

	c.JSON(http.StatusOK, gin.H{"success": true, "deletedAt": now, "name": name, "quantity": qty, "unit": unit, "reason": reason, "note": note})
}

func hideWarehouseItem(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	accID := accountID(c)

	var req struct {
		Hidden bool `json:"hidden"`
	}

	_ = c.ShouldBindJSON(&req)

	hidden := 0
	if req.Hidden {
		hidden = 1
	}

	_, err := db.Exec(`
		UPDATE warehouse_items
		SET hidden = ?
		WHERE id = ? AND account_id = ?
	`, hidden, id, accID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "hidden": req.Hidden})
}

func normalizeWarehouseName(name string) string {
	name = strings.ToLower(strings.TrimSpace(name))

	replacer := strings.NewReplacer(
		"ё", "е",
		"  ", " ",
		"-", " ",
		"_", " ",
		".", "",
		",", "",
		"'", "",
		"\"", "",
		"(", "",
		")", "",
	)

	name = replacer.Replace(name)

	words := strings.Fields(name)
	for i, w := range words {
		runes := []rune(w)
		if len(runes) > 4 {
			last := runes[len(runes)-1]
			if last == 'а' || last == 'ы' || last == 'и' || last == 'о' || last == 'е' || last == 'у' {
				w = string(runes[:len(runes)-1])
			}
		}
		words[i] = w
	}

	return strings.Join(words, " ")
}

func minInt(a int, b int) int {
	if a < b {
		return a
	}
	return b
}

func maxInt(a int, b int) int {
	if a > b {
		return a
	}
	return b
}

func levenshteinDistance(a string, b string) int {
	ar := []rune(a)
	br := []rune(b)

	if len(ar) == 0 {
		return len(br)
	}
	if len(br) == 0 {
		return len(ar)
	}

	dp := make([][]int, len(ar)+1)
	for i := range dp {
		dp[i] = make([]int, len(br)+1)
	}

	for i := 0; i <= len(ar); i++ {
		dp[i][0] = i
	}
	for j := 0; j <= len(br); j++ {
		dp[0][j] = j
	}

	for i := 1; i <= len(ar); i++ {
		for j := 1; j <= len(br); j++ {
			cost := 0
			if ar[i-1] != br[j-1] {
				cost = 1
			}

			dp[i][j] = minInt(
				minInt(dp[i-1][j]+1, dp[i][j-1]+1),
				dp[i-1][j-1]+cost,
			)
		}
	}

	return dp[len(ar)][len(br)]
}

func similarityScore(a string, b string) float64 {
	a = normalizeWarehouseName(a)
	b = normalizeWarehouseName(b)

	if a == "" || b == "" {
		return 0
	}

	if a == b {
		return 1
	}

	if strings.Contains(a, b) || strings.Contains(b, a) {
		return 0.88
	}

	maxLen := maxInt(len([]rune(a)), len([]rune(b)))
	if maxLen == 0 {
		return 0
	}

	dist := levenshteinDistance(a, b)
	score := 1 - (float64(dist) / float64(maxLen))

	if score < 0 {
		return 0
	}

	return score
}

func getSimilarWarehouseItems(c *gin.Context) {
	accID := accountID(c)
	name := strings.TrimSpace(c.Query("name"))
	unit := strings.TrimSpace(c.Query("unit"))

	if name == "" {
		c.JSON(http.StatusOK, []gin.H{})
		return
	}

	normalizedUnit, _, _ := normalizeWarehouseUnit(unit, 0, 0)

	rows, err := db.Query(`
		SELECT id, account_id, name, unit, quantity, price, unit_cost,
		       IFNULL(supplier, ''), IFNULL(expiry_date, ''), IFNULL(min_quantity, 0), IFNULL(note, ''), IFNULL(hidden, 0), IFNULL(created_at, ''), IFNULL(control_mode, 'exact'), IFNULL(loss_percent, 0), IFNULL(inventory_method, 'fifo'), IFNULL(packaging_quantity, 1)
		FROM warehouse_items
		WHERE account_id = ? AND IFNULL(deleted, 0) = 0
		ORDER BY IFNULL(hidden, 0), name
	`, accID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	list := []gin.H{}

	for rows.Next() {
		var item WarehouseItem
		var hiddenInt int

		if err := rows.Scan(
			&item.ID,
			&item.AccountID,
			&item.Name,
			&item.Unit,
			&item.Quantity,
			&item.Price,
			&item.UnitCost,
			&item.Supplier,
			&item.ExpiryDate,
			&item.MinQuantity,
			&item.Note,
			&hiddenInt,
			&item.CreatedAt,
			&item.ControlMode,
			&item.LossPercent,
			&item.InventoryMethod,
			&item.PackagingQuantity,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		item.Hidden = hiddenInt == 1

		if unit != "" && item.Unit != normalizedUnit {
			continue
		}

		score := similarityScore(name, item.Name)

		if score >= 0.68 {
			list = append(list, gin.H{
				"id":          item.ID,
				"accountId":   item.AccountID,
				"name":        item.Name,
				"unit":        item.Unit,
				"quantity":    item.Quantity,
				"price":       item.Price,
				"unitCost":    item.UnitCost,
				"supplier":    item.Supplier,
				"expiryDate":  item.ExpiryDate,
				"minQuantity": item.MinQuantity,
				"note":        item.Note,
				"hidden":      item.Hidden,
				"createdAt":   item.CreatedAt,
				"score":       score,
			})
		}
	}

	c.JSON(http.StatusOK, list)
}

func purchaseWarehouseItem(c *gin.Context) {
	itemID, _ := strconv.Atoi(c.Param("id"))
	accID := accountID(c)

	var req WarehouseItem

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Quantity <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "quantity must be greater than zero"})
		return
	}

	var existing WarehouseItem
	if err := db.QueryRow(`
		SELECT id, account_id, name, unit, IFNULL(min_quantity, 0)
		FROM warehouse_items
		WHERE id = ? AND account_id = ?
	`, itemID, accID).Scan(
		&existing.ID,
		&existing.AccountID,
		&existing.Name,
		&existing.Unit,
		&existing.MinQuantity,
	); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Товар склада не найден"})
		return
	}

	storageUnit, baseQuantity, minQuantity, purchaseNote, normErr := normalizePurchaseQuantity(req, existing.Unit)
	if normErr != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Проверь единицы закупки: для г/мл можно закупать в г/кг/мл/л или в штуках с заполненным весом/объёмом 1 штуки"})
		return
	}
	req.Unit = storageUnit
	req.Quantity = baseQuantity
	req.MinQuantity = minQuantity
	if purchaseNote != "" {
		if strings.TrimSpace(req.Note) != "" {
			req.Note += "; " + purchaseNote
		} else {
			req.Note = purchaseNote
		}
	}

	if req.Unit != existing.Unit {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Единица измерения не совпадает с товаром"})
		return
	}

	if req.Price < 0 {
		req.Price = 0
	}

	unitCost := 0.0
	if req.Quantity > 0 {
		unitCost = req.Price / req.Quantity
	}

	now := time.Now().Format(time.RFC3339)

	_, err := db.Exec(`
		INSERT INTO stock_batches(account_id, warehouse_item_id, quantity, remaining_quantity, purchase_price, unit_cost, supplier, expiry_date, note, created_at)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, accID, itemID, req.Quantity, req.Quantity, req.Price, unitCost, req.Supplier, req.ExpiryDate, req.Note, now)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if req.MinQuantity > 0 || req.PackagingQuantity > 0 {
		_, _ = db.Exec(`
			UPDATE warehouse_items
			SET min_quantity = CASE WHEN ? > 0 THEN ? ELSE min_quantity END,
			    packaging_quantity = CASE WHEN ? > 0 THEN ? ELSE packaging_quantity END,
			    control_mode = CASE WHEN ? != '' THEN ? ELSE control_mode END,
			    loss_percent = ?,
			    inventory_method = CASE WHEN ? != '' THEN ? ELSE inventory_method END
			WHERE id = ? AND account_id = ?
		`, req.MinQuantity, req.MinQuantity, req.PackagingQuantity, req.PackagingQuantity, req.ControlMode, req.ControlMode, req.LossPercent, req.InventoryMethod, req.InventoryMethod, itemID, accID)
	}

	_, _ = db.Exec(`
		INSERT INTO warehouse_movements(account_id, warehouse_item_id, movement_type, quantity, reason, note, created_at)
		VALUES(?, ?, 'in', ?, 'Новая закупка', ?, ?)
	`, accID, itemID, req.Quantity, req.Note, now)

	recalcWarehouseItem(itemID, accID)

	var item WarehouseItem
	var hiddenInt int
	_ = db.QueryRow(`
		SELECT id, account_id, name, unit, quantity, price, unit_cost, IFNULL(supplier, ''), IFNULL(expiry_date, ''), IFNULL(min_quantity, 0), IFNULL(note, ''), IFNULL(hidden, 0), IFNULL(created_at, ''), IFNULL(control_mode, 'exact'), IFNULL(loss_percent, 0), IFNULL(inventory_method, 'fifo'), IFNULL(packaging_quantity, 1)
		FROM warehouse_items
		WHERE id = ? AND account_id = ?
	`, itemID, accID).Scan(
		&item.ID,
		&item.AccountID,
		&item.Name,
		&item.Unit,
		&item.Quantity,
		&item.Price,
		&item.UnitCost,
		&item.Supplier,
		&item.ExpiryDate,
		&item.MinQuantity,
		&item.Note,
		&hiddenInt,
		&item.CreatedAt,
		&item.ControlMode,
		&item.LossPercent,
		&item.InventoryMethod,
		&item.PackagingQuantity,
	)
	item.Hidden = hiddenInt == 1

	c.JSON(http.StatusOK, item)
}

func cleanupWarehouseItemNames(accID int) {
	rows, err := db.Query(`SELECT id, name FROM warehouse_items WHERE account_id = ?`, accID)
	if err != nil {
		return
	}
	defer rows.Close()

	for rows.Next() {
		var id int
		var name string
		if err := rows.Scan(&id, &name); err != nil {
			continue
		}
		cleanName := cleanAIProductName(name)
		if cleanName != "" && cleanName != name {
			_, _ = db.Exec(`UPDATE warehouse_items SET name = ? WHERE id = ? AND account_id = ?`, cleanName, id, accID)
		}
	}
}
