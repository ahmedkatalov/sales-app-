package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// Онлайн-заказы с сайта меню. Поток:
//   1. Сайт (со своего сервера) шлёт заказ POST /public/orders с ключом приёма.
//   2. Заказ падает в online_orders со статусом 'new' в нужную точку (по ключу).
//   3. В кассе во вкладке «Заказы» работник видит новые заказы, грузит в корзину,
//      правит количество/состав и пробивает как обычную продажу.
// Ключ приёма (order_intake_key) уникален на точку — по нему публичный эндпоинт
// понимает, куда класть заказ. Владелец берёт ключ и вставляет его на сайте.

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// ensureOrderIntakeKey — вернуть ключ приёма точки, создав его при первом обращении.
func ensureOrderIntakeKey(accID int) (string, error) {
	var key string
	_ = db.QueryRow(`SELECT IFNULL(order_intake_key,'') FROM account_settings WHERE account_id=?`, accID).Scan(&key)
	if strings.TrimSpace(key) != "" {
		return key, nil
	}
	key = "ok_" + randHex(16)
	if _, err := db.Exec(`
		INSERT INTO account_settings(account_id, order_intake_key) VALUES(?, ?)
		ON CONFLICT(account_id) DO UPDATE SET order_intake_key=excluded.order_intake_key
		WHERE IFNULL(account_settings.order_intake_key,'')=''
	`, accID, key); err != nil {
		return "", err
	}
	// Перечитываем — на случай гонки (кто-то создал ключ параллельно).
	_ = db.QueryRow(`SELECT IFNULL(order_intake_key,'') FROM account_settings WHERE account_id=?`, accID).Scan(&key)
	return key, nil
}

type onlineOrderItemIn struct {
	Name      string  `json:"name"`
	Price     float64 `json:"price"`
	Qty       float64 `json:"qty"`
	ProductID int     `json:"productId"`
}

type onlineOrderIn struct {
	Key           string              `json:"key"`
	ExternalID    string              `json:"externalId"`
	CustomerName  string              `json:"customerName"`
	CustomerPhone string              `json:"customerPhone"`
	Address       string              `json:"address"`
	Comment       string              `json:"comment"`
	Source        string              `json:"source"`
	Total         float64             `json:"total"`
	Items         []onlineOrderItemIn `json:"items"`
}

// POST /public/orders — публичный приём заказа с сайта (без авторизации, по ключу).
func receiveOnlineOrder(c *gin.Context) {
	var in onlineOrderIn
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные заказа"})
		return
	}
	key := strings.TrimSpace(in.Key)
	if key == "" {
		key = strings.TrimSpace(c.GetHeader("X-Order-Key"))
	}
	if key == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Не указан ключ приёма заказов"})
		return
	}

	var accID int
	if err := db.QueryRow(`SELECT account_id FROM account_settings WHERE order_intake_key=?`, key).Scan(&accID); err != nil || accID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Неверный ключ приёма заказов"})
		return
	}

	items := make([]onlineOrderItemIn, 0, len(in.Items))
	var total float64
	for _, it := range in.Items {
		name := strings.TrimSpace(it.Name)
		if name == "" || it.Qty <= 0 {
			continue
		}
		if it.Price < 0 {
			it.Price = 0
		}
		it.Name = name
		items = append(items, it)
		total += it.Price * it.Qty
	}
	if len(items) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Пустой заказ"})
		return
	}
	if in.Total > 0 {
		total = in.Total // если сайт прислал итог — доверяем ему
	}

	b, _ := json.Marshal(items)
	now := time.Now().Format(time.RFC3339)
	source := strings.TrimSpace(in.Source)
	if source == "" {
		source = "site"
	}

	res, err := db.Exec(`
		INSERT INTO online_orders(account_id, status, customer_name, customer_phone, address, comment, source, total, items_json, external_id, created_at, updated_at)
		VALUES(?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, accID, strings.TrimSpace(in.CustomerName), strings.TrimSpace(in.CustomerPhone), strings.TrimSpace(in.Address),
		strings.TrimSpace(in.Comment), source, total, string(b), strings.TrimSpace(in.ExternalID), now, now)
	if err != nil {
		// Повтор с тем же externalId (сайт ретраил) — не создаём дубль, отвечаем ок.
		c.JSON(http.StatusOK, gin.H{"status": "duplicate"})
		return
	}
	id, _ := res.LastInsertId()
	c.JSON(http.StatusOK, gin.H{"status": "received", "id": id})
}

// GET /online-orders — активные заказы точки для кассы (по умолчанию new+accepted).
func getOnlineOrders(c *gin.Context) {
	accID := accountID(c)
	status := strings.TrimSpace(c.Query("status"))

	where := "account_id=?"
	args := []any{accID}
	if status != "" {
		where += " AND status=?"
		args = append(args, status)
	} else {
		where += " AND status IN ('new','accepted')"
	}

	rows, err := db.Query(`
		SELECT id, status, customer_name, customer_phone, address, comment, source, total, items_json, created_at
		FROM online_orders WHERE `+where+` ORDER BY id DESC`, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	list := []gin.H{}
	for rows.Next() {
		var id int
		var st, name, phone, address, comment, source, itemsJSON, createdAt string
		var total float64
		if err := rows.Scan(&id, &st, &name, &phone, &address, &comment, &source, &total, &itemsJSON, &createdAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		var items []any
		_ = json.Unmarshal([]byte(itemsJSON), &items)
		if items == nil {
			items = []any{}
		}
		list = append(list, gin.H{
			"id": id, "status": st, "customerName": name, "customerPhone": phone,
			"address": address, "comment": comment, "source": source, "total": total,
			"items": items, "createdAt": createdAt,
		})
	}
	c.JSON(http.StatusOK, list)
}

// POST /online-orders/:id/status — сменить статус (accepted/done/rejected/new).
func setOnlineOrderStatus(c *gin.Context) {
	accID := accountID(c)
	id := c.Param("id")
	var body struct {
		Status string `json:"status"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные"})
		return
	}
	st := strings.TrimSpace(body.Status)
	allowed := map[string]bool{"new": true, "accepted": true, "done": true, "rejected": true}
	if !allowed[st] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный статус"})
		return
	}
	res, err := db.Exec(`UPDATE online_orders SET status=?, updated_at=? WHERE id=? AND account_id=?`,
		st, time.Now().Format(time.RFC3339), id, accID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Заказ не найден"})
		return
	}
	c.Status(http.StatusOK)
}

// GET /online-orders/key — ключ приёма заказов (для настройки сайта). Только владелец/админ.
func getOnlineOrderKey(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	key, err := ensureOrderIntakeKey(accountID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"key": key})
}

// POST /online-orders/key/rotate — перевыпустить ключ (старый перестанет работать).
func rotateOnlineOrderKey(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	accID := accountID(c)
	key := "ok_" + randHex(16)
	if _, err := db.Exec(`
		INSERT INTO account_settings(account_id, order_intake_key) VALUES(?, ?)
		ON CONFLICT(account_id) DO UPDATE SET order_intake_key=excluded.order_intake_key
	`, accID, key); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"key": key})
}
