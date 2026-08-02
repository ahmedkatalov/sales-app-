package main

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// Оформление (appearance) — ОБЩЕЕ на весь аккаунт. Профиль (акцент, скругление,
// стекло, шрифт и т.д.) выбирает владелец, и он применяется у всех сотрудников.
// Светлая/тёмная тема при этом остаётся индивидуальной (хранится на устройстве).

// GET /settings/appearance — читают все (чтобы применить оформление у себя).
// ownerAccountID определён в helpers.go — общий владелец для всех сотрудников.
func getAppearanceSettings(c *gin.Context) {
	raw := ""
	if oid := ownerAccountID(c); oid > 0 {
		_ = db.QueryRow(`SELECT IFNULL(appearance, '') FROM account_settings WHERE account_id = ?`, oid).Scan(&raw)
	}
	var appearance any = nil
	if strings.TrimSpace(raw) != "" {
		_ = json.Unmarshal([]byte(raw), &appearance)
	}
	c.JSON(http.StatusOK, gin.H{"appearance": appearance})
}

// PUT /settings/appearance — сохранять оформление на весь аккаунт может
// только владелец.
func setAppearanceSettings(c *gin.Context) {
	u, ok := currentUser(c)
	if !ok || strings.ToLower(strings.TrimSpace(u.Role)) != "owner" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Оформление для всех может задать только владелец"})
		return
	}

	var body struct {
		Appearance json.RawMessage `json:"appearance"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные"})
		return
	}

	raw := strings.TrimSpace(string(body.Appearance))
	if raw == "null" {
		raw = ""
	}
	if len(raw) > 8000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Слишком большой профиль оформления"})
		return
	}
	// Валидируем, что это корректный JSON-объект (или пусто = сброс).
	if raw != "" {
		var probe map[string]any
		if err := json.Unmarshal([]byte(raw), &probe); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректный профиль оформления"})
			return
		}
	}

	oid := u.OwnerAccountID
	if oid == 0 {
		oid = u.AccountID
	}
	if _, err := db.Exec(`
		INSERT INTO account_settings(account_id, appearance) VALUES(?, ?)
		ON CONFLICT(account_id) DO UPDATE SET appearance = excluded.appearance
	`, oid, raw); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
