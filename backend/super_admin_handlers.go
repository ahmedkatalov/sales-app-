package main

import (
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// superAdminRequired — middleware для защиты super-admin роутов.
// Проверяет заголовок X-Super-Token против переменной окружения SUPER_ADMIN_TOKEN.
func superAdminRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		secret := strings.TrimSpace(os.Getenv("SUPER_ADMIN_TOKEN"))
		if secret == "" {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
				"error": "Super-admin не настроен (SUPER_ADMIN_TOKEN не задан)",
			})
			return
		}

		token := c.GetHeader("X-Super-Token")
		if token == "" {
			token = c.Query("superToken")
		}

		if token != secret {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "Неверный super-admin токен",
			})
			return
		}

		c.Next()
	}
}

// GET /super/accounts — список всех аккаунтов (компаний)
func superListAccounts(c *gin.Context) {
	rows, err := db.Query(`
		SELECT a.id, a.name, a.created_at,
		       COUNT(DISTINCT u.id) as user_count
		FROM accounts a
		LEFT JOIN users u ON u.account_id = a.id AND u.role = 'owner'
		GROUP BY a.id
		ORDER BY a.id DESC
	`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	type AccountRow struct {
		ID        int    `json:"id"`
		Name      string `json:"name"`
		CreatedAt string `json:"createdAt"`
		UserCount int    `json:"userCount"`
	}

	list := []AccountRow{}
	for rows.Next() {
		var a AccountRow
		if err := rows.Scan(&a.ID, &a.Name, &a.CreatedAt, &a.UserCount); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		list = append(list, a)
	}

	c.JSON(http.StatusOK, list)
}

// POST /super/accounts — создать компанию + owner аккаунт
func superCreateAccount(c *gin.Context) {
	var req struct {
		CompanyName string `json:"companyName"`
		Username    string `json:"username"`
		Password    string `json:"password"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный формат данных"})
		return
	}

	req.CompanyName = strings.TrimSpace(req.CompanyName)
	req.Username = strings.TrimSpace(req.Username)
	req.Password = strings.TrimSpace(req.Password)

	if req.CompanyName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Укажите название компании"})
		return
	}
	if req.Username == "" || req.Password == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Укажите логин и пароль"})
		return
	}

	hashed, err := hashPassword(req.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка хеширования пароля"})
		return
	}

	tx, err := db.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка базы данных"})
		return
	}

	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	now := time.Now().Format(time.RFC3339)

	// Создаём аккаунт (компанию)
	accRes, err := tx.Exec(`INSERT INTO accounts(name, created_at) VALUES(?, ?)`, req.CompanyName, now)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось создать компанию: " + err.Error()})
		return
	}
	accID64, _ := accRes.LastInsertId()
	accID := int(accID64)

	// Создаём основную точку
	wsRes, err := tx.Exec(`INSERT INTO workspaces(account_id, name, is_main, created_at) VALUES(?, ?, 1, ?)`, accID, req.CompanyName, now)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось создать основную точку: " + err.Error()})
		return
	}
	wsID64, _ := wsRes.LastInsertId()
	wsID := int(wsID64)
	dataAccountID := workspaceDataAccountID(accID, wsID)

	// Создаём owner-пользователя
	userRes, err := tx.Exec(`
		INSERT INTO users(account_id, owner_account_id, workspace_id, data_account_id, username, password, role, created_at)
		VALUES(?, ?, ?, ?, ?, ?, 'owner', ?)
	`, accID, accID, wsID, dataAccountID, req.Username, hashed, now)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Такой логин уже существует"})
		return
	}
	userID64, _ := userRes.LastInsertId()

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка сохранения"})
		return
	}
	committed = true

	c.JSON(http.StatusOK, gin.H{
		"accountId":   accID,
		"companyName": req.CompanyName,
		"userId":      int(userID64),
		"username":    req.Username,
		"workspaceId": wsID,
		"role":        "owner",
		"createdAt":   now,
	})
}

// DELETE /super/accounts/:id — удалить компанию и всё что с ней связано
func superDeleteAccount(c *gin.Context) {
	var req struct {
		ID int `uri:"id"`
	}
	if err := c.ShouldBindUri(&req); err != nil || req.ID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID"})
		return
	}

	// Получаем все workspace dataAccountID для этой компании
	rows, err := db.Query(`SELECT id FROM workspaces WHERE account_id = ?`, req.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	var wsIDs []int
	for rows.Next() {
		var wid int
		rows.Scan(&wid)
		wsIDs = append(wsIDs, wid)
	}
	rows.Close()

	// Удаляем данные каждой точки
	for _, wid := range wsIDs {
		dataID := workspaceDataAccountID(req.ID, wid)
		db.Exec(`DELETE FROM employees WHERE account_id = ?`, dataID)
		db.Exec(`DELETE FROM cards WHERE account_id = ?`, dataID)
		db.Exec(`DELETE FROM product_types WHERE account_id = ?`, dataID)
		db.Exec(`DELETE FROM product_categories WHERE account_id = ?`, dataID)
		db.Exec(`DELETE FROM menu_products WHERE account_id = ?`, dataID)
		db.Exec(`DELETE FROM sales WHERE account_id = ?`, dataID)
		db.Exec(`DELETE FROM global_expenses WHERE account_id = ?`, dataID)
		db.Exec(`DELETE FROM folders WHERE account_id = ?`, dataID)
		db.Exec(`DELETE FROM warehouse_items WHERE account_id = ?`, dataID)
	}

	db.Exec(`DELETE FROM users WHERE account_id = ?`, req.ID)
	db.Exec(`DELETE FROM workspaces WHERE account_id = ?`, req.ID)
	db.Exec(`DELETE FROM accounts WHERE id = ?`, req.ID)

	c.JSON(http.StatusOK, gin.H{"ok": true})
}
