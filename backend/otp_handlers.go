package main

import (
	"crypto/rand"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// isEmailLike — проверяем, похож ли логин на email
func isEmailLike(s string) bool {
	return strings.Contains(s, "@") && strings.Contains(s, ".")
}

// generateOTPCode — генерирует 6-значный код
func generateOTPCode() string {
	b := make([]byte, 3)
	rand.Read(b)
	n := int(b[0])<<16 | int(b[1])<<8 | int(b[2])
	return fmt.Sprintf("%06d", n%1000000)
}

// getUserEmail — получаем email пользователя (из поля email или из username если это email)
func getUserEmail(userID int) (string, error) {
	var email string
	err := db.QueryRow(`SELECT IFNULL(email, '') FROM users WHERE id = ?`, userID).Scan(&email)
	if err != nil {
		return "", err
	}
	if email != "" {
		return email, nil
	}
	// Fallback: если username выглядит как email — используем его
	var username string
	err = db.QueryRow(`SELECT username FROM users WHERE id = ?`, userID).Scan(&username)
	if err != nil {
		return "", err
	}
	if isEmailLike(username) {
		return username, nil
	}
	return "", fmt.Errorf("у пользователя не указан email")
}

// POST /auth/login-otp/request
// Проверяет логин/пароль и отправляет OTP на email
func requestLoginOTP(c *gin.Context) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный формат данных"})
		return
	}

	req.Username = strings.TrimSpace(req.Username)
	req.Password = strings.TrimSpace(req.Password)

	if req.Username == "" || req.Password == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Введи логин и пароль"})
		return
	}

	// 1. Проверяем логин/пароль
	var userID int
	var hashedPassword string
	err := db.QueryRow(`SELECT id, password FROM users WHERE username = ?`, req.Username).
		Scan(&userID, &hashedPassword)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Неверный логин или пароль"})
		return
	}

	if !checkPassword(hashedPassword, req.Password) {
		// Совместимость с plaintext паролями
		if hashedPassword != req.Password {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Неверный логин или пароль"})
			return
		}
	}

	// 2. Получаем email
	email, err := getUserEmail(userID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "У этого аккаунта не указан email для отправки кода. Обратитесь к администратору.",
		})
		return
	}

	// 3. Инвалидируем старые коды
	db.Exec(`UPDATE login_otp_codes SET used_at = ? WHERE user_id = ? AND used_at IS NULL`,
		time.Now().Format(time.RFC3339), userID)

	// 4. Генерируем и сохраняем код
	code := generateOTPCode()
	expiresAt := time.Now().Add(10 * time.Minute).Format(time.RFC3339)
	now := time.Now().Format(time.RFC3339)

	_, err = db.Exec(`
		INSERT INTO login_otp_codes(user_id, code, email, expires_at, attempts, created_at)
		VALUES(?, ?, ?, ?, 0, ?)
	`, userID, code, email, expiresAt, now)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось создать код"})
		return
	}

	// 5. Отправляем письмо
	if err := emailJSClient.SendOTP(email, code); err != nil {
		// Не блокируем вход если EmailJS не работает — логируем ошибку
		fmt.Printf("EmailJS error: %v\n", err)
	}

	// Маскируем email для ответа: li***@coffee.com
	maskedEmail := maskEmail(email)

	c.JSON(http.StatusOK, gin.H{
		"ok":          true,
		"mode":        "otp_sent",
		"maskedEmail": maskedEmail,
		"message":     "Код подтверждения отправлен на почту",
	})
}

// POST /auth/login-otp/confirm
// Проверяет OTP код и создаёт сессию
func confirmLoginOTP(c *gin.Context) {
	var req struct {
		Username string `json:"username"`
		Code     string `json:"code"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный формат данных"})
		return
	}

	req.Username = strings.TrimSpace(req.Username)
	req.Code = strings.TrimSpace(req.Code)

	if req.Username == "" || req.Code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Введи логин и код"})
		return
	}

	// 1. Получаем userID
	var userID int
	err := db.QueryRow(`SELECT id FROM users WHERE username = ?`, req.Username).Scan(&userID)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Пользователь не найден"})
		return
	}

	// 2. Находим активный код
	var otpID int
	var storedCode string
	var expiresAt string
	var attempts int

	err = db.QueryRow(`
		SELECT id, code, expires_at, attempts
		FROM login_otp_codes
		WHERE user_id = ? AND used_at IS NULL
		ORDER BY created_at DESC
		LIMIT 1
	`, userID).Scan(&otpID, &storedCode, &expiresAt, &attempts)

	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Код не найден. Запроси новый."})
		return
	}

	// 3. Проверяем срок действия
	expTime, _ := time.Parse(time.RFC3339, expiresAt)
	if time.Now().After(expTime) {
		db.Exec(`UPDATE login_otp_codes SET used_at = ? WHERE id = ?`,
			time.Now().Format(time.RFC3339), otpID)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Срок действия кода истёк. Запроси новый."})
		return
	}

	// 4. Проверяем попытки
	if attempts >= 5 {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Слишком много попыток. Запроси новый код."})
		return
	}

	// 5. Проверяем код
	if req.Code != storedCode {
		db.Exec(`UPDATE login_otp_codes SET attempts = attempts + 1 WHERE id = ?`, otpID)
		remaining := 5 - attempts - 1
		if remaining <= 0 {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Неверный код. Попытки исчерпаны — запроси новый."})
		} else {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": fmt.Sprintf("Неверный код. Осталось попыток: %d", remaining),
			})
		}
		return
	}

	// 6. Инвалидируем код
	db.Exec(`UPDATE login_otp_codes SET used_at = ? WHERE id = ?`,
		time.Now().Format(time.RFC3339), otpID)

	// 7. Создаём сессию (переиспользуем логику из login)
	var u User
	var accountName string
	var hashedPassword string

	err = db.QueryRow(`
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
		WHERE u.id = ?
	`, userID).Scan(
		&u.ID, &u.AccountID, &u.OwnerAccountID, &u.WorkspaceID, &u.DataAccountID,
		&u.Username, &hashedPassword, &u.Role, &accountName,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения данных пользователя"})
		return
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

// maskEmail — маскируем email: li***@coffee.com
func maskEmail(email string) string {
	parts := strings.SplitN(email, "@", 2)
	if len(parts) != 2 {
		return email
	}
	local := parts[0]
	if len(local) <= 2 {
		return local + "***@" + parts[1]
	}
	return local[:2] + "***@" + parts[1]
}
