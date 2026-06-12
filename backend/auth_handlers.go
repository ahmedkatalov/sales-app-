package main

import (
	"crypto/rand"
	"encoding/hex"
	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"net/http"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
func generateToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// Сессии хранятся в SQLite — не сбрасываются при рестарте сервера.
func storeSession(token string, userID int) {
	now := time.Now()
	expiresAt := now.Add(30 * 24 * time.Hour) // 30 дней
	_, _ = db.Exec(
		`INSERT OR REPLACE INTO user_sessions(token, user_id, created_at, expires_at) VALUES(?, ?, ?, ?)`,
		token, userID, now.Format(time.RFC3339), expiresAt.Format(time.RFC3339),
	)
}

func lookupSession(token string) (int, bool) {
	var userID int
	var expiresAt string
	err := db.QueryRow(
		`SELECT user_id, expires_at FROM user_sessions WHERE token = ?`, token,
	).Scan(&userID, &expiresAt)
	if err != nil {
		return 0, false
	}
	// Проверяем срок действия
	if exp, err := time.Parse(time.RFC3339, expiresAt); err == nil {
		if time.Now().After(exp) {
			deleteSession(token)
			return 0, false
		}
	}
	return userID, true
}

func deleteSession(token string) {
	_, _ = db.Exec(`DELETE FROM user_sessions WHERE token = ?`, token)
}

// ---------------------------------------------------------------------------
// hashPassword / checkPassword
// ---------------------------------------------------------------------------

func hashPassword(plain string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func checkPassword(hash, plain string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)) == nil
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

func registerAdmin(c *gin.Context) {
	// Recover от паники чтобы не было ERR_CONNECTION_RESET
	defer func() {
		if r := recover(); r != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Внутренняя ошибка сервера при регистрации"})
		}
	}()

	var req struct {
		ShopName string `json:"shopName"`
		Username string `json:"username"`
		Password string `json:"password"`
		Name     string `json:"name"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный формат данных: " + err.Error()})
		return
	}

	req.ShopName = strings.TrimSpace(req.ShopName)
	req.Username = strings.TrimSpace(req.Username)
	req.Password = strings.TrimSpace(req.Password)

	if req.Username == "" || req.Password == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Заполни логин/email и пароль"})
		return
	}
	// ShopName необязателен — если не указан, берём username
	if req.ShopName == "" {
		req.ShopName = req.Username
	}

	// Хешируем пароль перед записью в БД
	hashed, err := hashPassword(req.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка хеширования пароля"})
		return
	}

	tx, err := db.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось начать регистрацию: " + err.Error()})
		return
	}

	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	now := time.Now().Format(time.RFC3339)

	accRes, err := tx.Exec(`
		INSERT INTO accounts(name, created_at)
		VALUES(?, ?)
	`, req.ShopName, now)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось создать аккаунт: " + err.Error()})
		return
	}

	accID64, _ := accRes.LastInsertId()
	accID := int(accID64)

	wsRes, err := tx.Exec(`
		INSERT INTO workspaces(account_id, name, is_main, created_at)
		VALUES(?, ?, 1, ?)
	`, accID, req.ShopName, now)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось создать основную точку: " + err.Error()})
		return
	}

	wsID64, _ := wsRes.LastInsertId()
	wsID := int(wsID64)
	dataAccountID := workspaceDataAccountID(accID, wsID)

	userRes, err := tx.Exec(`
		INSERT INTO users(account_id, owner_account_id, workspace_id, data_account_id, username, password, role, created_at)
		VALUES(?, ?, ?, ?, ?, ?, 'owner', ?)
	`, accID, accID, wsID, dataAccountID, req.Username, hashed, now)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Такой логин/email уже существует"})
		return
	}

	userID64, _ := userRes.LastInsertId()
	userID := int(userID64)

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось сохранить регистрацию: " + err.Error()})
		return
	}
	committed = true

	// Выдаём токен сразу после регистрации
	token, err := generateToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось создать сессию"})
		return
	}
	storeSession(token, userID)

	mainWorkspace := Workspace{
		ID:            wsID,
		AccountID:     accID,
		DataAccountID: dataAccountID,
		Name:          req.ShopName,
		IsMain:        true,
		CreatedAt:     now,
	}

	c.JSON(http.StatusOK, gin.H{
		"token":              token,
		"id":                 userID,
		"accountId":          accID,
		"ownerAccountId":     accID,
		"username":           req.Username,
		"role":               "owner",
		"defaultWorkspaceId": mainWorkspace.ID,
		"workspaceId":        mainWorkspace.ID,
		"dataAccountId":      mainWorkspace.DataAccountID,
		"workspaceName":      mainWorkspace.Name,
		"ownerName":          req.ShopName,
		"workspace":          mainWorkspace,
		"canSwitchBranches":  true,
	})
}

func login(c *gin.Context) {
	defer func() {
		if r := recover(); r != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Внутренняя ошибка сервера при входе"})
		}
	}()

	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	req.Username = strings.TrimSpace(req.Username)
	req.Password = strings.TrimSpace(req.Password)

	var u User
	var accountName string
	var hashedPassword string

	err := db.QueryRow(`
		SELECT 
			u.id,
			u.account_id,
			IFNULL(u.owner_account_id, 0),
			IFNULL(u.workspace_id, 0),
			IFNULL(u.data_account_id, 0),
			u.username,
			u.password,
			u.role,
			IFNULL(a.name, '')
		FROM users u
		LEFT JOIN accounts a ON a.id = u.account_id
		WHERE u.username = ?
	`, req.Username).Scan(
		&u.ID,
		&u.AccountID,
		&u.OwnerAccountID,
		&u.WorkspaceID,
		&u.DataAccountID,
		&u.Username,
		&hashedPassword,
		&u.Role,
		&accountName,
	)

	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Неверный логин или пароль. Проверь данные и попробуй снова."})
		return
	}

	// Проверяем пароль через bcrypt.
	// Если в БД ещё хранится plaintext (старые записи) — сравниваем напрямую
	// и сразу перехешируем при успехе.
	if !checkPassword(hashedPassword, req.Password) {
		// Пробуем plaintext-совместимость для старых учёток
		if hashedPassword != req.Password {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Неверный логин или пароль"})
			return
		}
		// Обновляем до bcrypt
		if newHash, err := hashPassword(req.Password); err == nil {
			_, _ = db.Exec(`UPDATE users SET password = ? WHERE id = ?`, newHash, u.ID)
		}
	}

	if u.Role == "" || u.Role == "admin" {
		u.Role = "owner"
	}
	if u.Role == "workspace" {
		u.Role = "worker"
	}
	if u.OwnerAccountID == 0 {
		u.OwnerAccountID = u.AccountID
	}

	token, err := generateToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось создать сессию"})
		return
	}
	storeSession(token, u.ID)

	if u.Role == "branch_admin" || u.Role == "worker" {
		var w Workspace
		var isMainInt int

		err := db.QueryRow(`
			SELECT id, account_id, name, IFNULL(is_main, 0), created_at
			FROM workspaces
			WHERE id = ? AND account_id = ?
		`, u.WorkspaceID, u.OwnerAccountID).Scan(&w.ID, &w.AccountID, &w.Name, &isMainInt, &w.CreatedAt)

		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Рабочая точка не найдена"})
			return
		}

		w.IsMain = isMainInt == 1
		w.DataAccountID = workspaceDataAccountID(w.AccountID, w.ID)

		c.JSON(http.StatusOK, gin.H{
			"token":              token,
			"id":                 u.ID,
			"accountId":          u.AccountID,
			"ownerAccountId":     u.OwnerAccountID,
			"username":           u.Username,
			"role":               u.Role,
			"defaultWorkspaceId": w.ID,
			"workspaceId":        w.ID,
			"dataAccountId":      w.DataAccountID,
			"workspaceName":      w.Name,
			"ownerName":          accountName,
			"workspace":          w,
			"canSwitchBranches":  false,
		})
		return
	}

	mainWorkspace := ensureMainWorkspace(u.AccountID, accountName)

	c.JSON(http.StatusOK, gin.H{
		"token":              token,
		"id":                 u.ID,
		"accountId":          u.AccountID,
		"ownerAccountId":     u.AccountID,
		"username":           u.Username,
		"role":               "owner",
		"defaultWorkspaceId": mainWorkspace.ID,
		"dataAccountId":      mainWorkspace.DataAccountID,
		"workspaceName":      mainWorkspace.Name,
		"ownerName":          accountName,
		"workspace":          mainWorkspace,
		"canSwitchBranches":  true,
	})
}

func logout(c *gin.Context) {
	token := tokenFromRequest(c)
	if token != "" {
		deleteSession(token)
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
