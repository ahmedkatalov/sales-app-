package main

import (
	"database/sql"
	"github.com/gin-gonic/gin"
	"strconv"
	"strings"
	"time"
)

func parsePositiveInt(v string) int {
	id, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil || id <= 0 {
		return 0
	}
	return id
}

func requestedDataAccountID(c *gin.Context) int {
	if id := parsePositiveInt(c.GetHeader("X-Data-Account-ID")); id > 0 {
		return id
	}
	if id := parsePositiveInt(c.Query("dataAccountId")); id > 0 {
		return id
	}
	return parsePositiveInt(c.Query("accountId"))
}

func requestedOwnerAccountID(c *gin.Context) int {
	if id := parsePositiveInt(c.GetHeader("X-Owner-Account-ID")); id > 0 {
		return id
	}
	if id := parsePositiveInt(c.Query("ownerAccountId")); id > 0 {
		return id
	}
	return parsePositiveInt(c.Query("accountId"))
}

// currentUser теперь читает userID из контекста Gin (заполнен middleware),
// а не из произвольного заголовка от клиента.
func currentUser(c *gin.Context) (User, bool) {
	// Сначала ищем значение, выставленное middleware
	authedID, exists := c.Get("authedUserID")
	userID := 0
	if exists {
		if id, ok := authedID.(int); ok {
			userID = id
		}
	}
	// Фолбэк на заголовок (для обратной совместимости / прямых вызовов)
	if userID <= 0 {
		userID = parsePositiveInt(c.GetHeader("X-User-ID"))
	}
	if userID <= 0 {
		return User{}, false
	}

	var u User
	err := db.QueryRow(`
		SELECT id, account_id, IFNULL(owner_account_id, 0), IFNULL(workspace_id, 0), IFNULL(data_account_id, 0), username, IFNULL(role, '')
		FROM users
		WHERE id = ?
	`, userID).Scan(&u.ID, &u.AccountID, &u.OwnerAccountID, &u.WorkspaceID, &u.DataAccountID, &u.Username, &u.Role)
	if err != nil {
		return User{}, false
	}
	if u.OwnerAccountID == 0 {
		u.OwnerAccountID = u.AccountID
	}
	if u.DataAccountID == 0 && u.WorkspaceID > 0 {
		u.DataAccountID = workspaceDataAccountID(u.OwnerAccountID, u.WorkspaceID)
	}
	return u, true
}

func workspaceExistsForOwner(ownerID int, dataAccountID int) bool {
	if ownerID <= 0 || dataAccountID <= 0 {
		return false
	}
	if dataAccountID == ownerID {
		return true
	}
	var ok int
	err := db.QueryRow(`
		SELECT COUNT(*)
		FROM workspaces
		WHERE account_id = ? AND (? = account_id * 100000 + id)
	`, ownerID, dataAccountID).Scan(&ok)
	return err == nil && ok > 0
}

func accountID(c *gin.Context) int {
	requested := requestedDataAccountID(c)
	if u, ok := currentUser(c); ok {
		role := strings.ToLower(strings.TrimSpace(u.Role))
		if role == "worker" || role == "branch_admin" || role == "workspace" {
			if u.DataAccountID > 0 {
				return u.DataAccountID
			}
			return workspaceDataAccountID(u.OwnerAccountID, u.WorkspaceID)
		}
		ownerID := u.OwnerAccountID
		if ownerID == 0 {
			ownerID = u.AccountID
		}
		if requested > 0 && workspaceExistsForOwner(ownerID, requested) {
			return requested
		}
		main := ensureMainWorkspace(ownerID, "")
		if main.DataAccountID > 0 {
			return main.DataAccountID
		}
		return ownerID
	}
	if requested > 0 {
		return requested
	}
	return 1
}

func ownerAccountID(c *gin.Context) int {
	if u, ok := currentUser(c); ok {
		if u.OwnerAccountID > 0 {
			return u.OwnerAccountID
		}
		return u.AccountID
	}
	if id := requestedOwnerAccountID(c); id > 0 {
		return id
	}
	return 1
}

func workspaceDataAccountID(ownerID int, workspaceID int) int {
	return ownerID*100000 + workspaceID
}

func normalizeType(t string) string {
	t = strings.ToLower(strings.TrimSpace(t))
	if t == "food" || t == "еда" {
		return "food"
	}
	return "drink"
}

func ensureMainWorkspace(ownerID int, shopName string) Workspace {
	var w Workspace
	var isMainInt int

	err := db.QueryRow(`
		SELECT id, account_id, name, IFNULL(is_main, 0), created_at
		FROM workspaces
		WHERE account_id = ? AND IFNULL(is_main, 0) = 1
		ORDER BY id
		LIMIT 1
	`, ownerID).Scan(&w.ID, &w.AccountID, &w.Name, &isMainInt, &w.CreatedAt)

	if err == nil {
		w.IsMain = isMainInt == 1
		w.DataAccountID = workspaceDataAccountID(w.AccountID, w.ID)
		return w
	}

	name := strings.TrimSpace(shopName)
	if name == "" {
		name = "Основная точка"
	}

	now := time.Now().Format(time.RFC3339)
	res, _ := db.Exec(`
		INSERT INTO workspaces(account_id, name, is_main, created_at)
		VALUES(?, ?, 1, ?)
	`, ownerID, name, now)

	id64, _ := res.LastInsertId()
	w = Workspace{
		ID:            int(id64),
		AccountID:     ownerID,
		DataAccountID: workspaceDataAccountID(ownerID, int(id64)),
		Name:          name,
		IsMain:        true,
		CreatedAt:     now,
	}

	return w
}

func scanNullableString(ns sql.NullString) string {
	if ns.Valid {
		return ns.String
	}
	return ""
}
