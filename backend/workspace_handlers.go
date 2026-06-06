package main

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func getWorkspaces(c *gin.Context) {
	ownerID := ownerAccountID(c)

	rows, err := db.Query(`
		SELECT id, account_id, name, IFNULL(is_main, 0), created_at
		FROM workspaces
		WHERE account_id = ?
		ORDER BY is_main DESC, id DESC
	`, ownerID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	list := []Workspace{}

	for rows.Next() {
		var w Workspace
		var isMainInt int

		if err := rows.Scan(&w.ID, &w.AccountID, &w.Name, &isMainInt, &w.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		w.IsMain = isMainInt == 1
		w.DataAccountID = workspaceDataAccountID(w.AccountID, w.ID)
		list = append(list, w)
	}

	if len(list) == 0 {
		var accountName string
		_ = db.QueryRow(`SELECT name FROM accounts WHERE id = ?`, ownerID).Scan(&accountName)
		w := ensureMainWorkspace(ownerID, accountName)
		list = append(list, w)
	}

	c.JSON(http.StatusOK, list)
}

func createWorkspace(c *gin.Context) {
	var req struct {
		AccountID int    `json:"accountId"`
		Name      string `json:"name"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.AccountID == 0 {
		req.AccountID = ownerAccountID(c)
	}

	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Введите название филиала"})
		return
	}

	now := time.Now().Format(time.RFC3339)
	res, err := db.Exec(`
		INSERT INTO workspaces(account_id, name, is_main, created_at)
		VALUES(?, ?, 0, ?)
	`, req.AccountID, req.Name, now)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	id, _ := res.LastInsertId()
	w := Workspace{
		ID:            int(id),
		AccountID:     req.AccountID,
		DataAccountID: workspaceDataAccountID(req.AccountID, int(id)),
		Name:          req.Name,
		IsMain:        false,
		CreatedAt:     now,
	}

	c.JSON(http.StatusOK, w)
}

func deleteWorkspace(c *gin.Context) {
	ownerID := ownerAccountID(c)
	id, _ := strconv.Atoi(c.Param("id"))

	var isMain int
	err := db.QueryRow(`SELECT IFNULL(is_main, 0) FROM workspaces WHERE id = ? AND account_id = ?`, id, ownerID).Scan(&isMain)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Филиал не найден"})
		return
	}
	if isMain == 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Основную точку удалить нельзя"})
		return
	}

	dataID := workspaceDataAccountID(ownerID, id)
	db.Exec(`DELETE FROM users WHERE IFNULL(owner_account_id, account_id) = ? AND workspace_id = ? AND role IN ('branch_admin', 'worker', 'workspace')`, ownerID, id)
	db.Exec(`DELETE FROM employees WHERE account_id = ?`, dataID)
	db.Exec(`DELETE FROM cards WHERE account_id = ?`, dataID)
	db.Exec(`DELETE FROM product_types WHERE account_id = ?`, dataID)
	db.Exec(`DELETE FROM product_categories WHERE account_id = ?`, dataID)
	db.Exec(`DELETE FROM menu_products WHERE account_id = ?`, dataID)
	db.Exec(`DELETE FROM sales WHERE account_id = ?`, dataID)
	db.Exec(`DELETE FROM global_expenses WHERE account_id = ?`, dataID)
	db.Exec(`DELETE FROM folders WHERE account_id = ?`, dataID)

	_, err = db.Exec(`DELETE FROM workspaces WHERE id = ? AND account_id = ?`, id, ownerID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Status(http.StatusOK)
}

func getWorkspaceUsers(c *gin.Context) {
	ownerID := ownerAccountID(c)

	rows, err := db.Query(`
		SELECT 
			u.id,
			u.account_id,
			IFNULL(u.owner_account_id, 0),
			IFNULL(u.workspace_id, 0),
			IFNULL(u.data_account_id, 0),
			u.username,
			CASE 
				WHEN u.role = 'workspace' THEN 'worker'
				ELSE u.role
			END,
			IFNULL(w.name, '')
		FROM users u
		LEFT JOIN workspaces w ON w.id = u.workspace_id AND w.account_id = u.owner_account_id
		WHERE IFNULL(u.owner_account_id, u.account_id) = ?
		  AND u.role IN ('branch_admin', 'worker', 'workspace')
		ORDER BY u.id DESC
	`, ownerID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	list := []gin.H{}

	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.AccountID, &u.OwnerAccountID, &u.WorkspaceID, &u.DataAccountID, &u.Username, &u.Role, &u.WorkspaceName); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		list = append(list, gin.H{
			"id":             u.ID,
			"accountId":      u.AccountID,
			"ownerAccountId": u.OwnerAccountID,
			"workspaceId":    u.WorkspaceID,
			"dataAccountId":  u.DataAccountID,
			"username":       u.Username,
			"role":           u.Role,
			"workspaceName":  u.WorkspaceName,
		})
	}

	c.JSON(http.StatusOK, list)
}

func createWorkspaceUser(c *gin.Context) {
	var req struct {
		OwnerAccountID int    `json:"ownerAccountId"`
		WorkspaceID    int    `json:"workspaceId"`
		Username       string `json:"username"`
		Password       string `json:"password"`
		Role           string `json:"role"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.OwnerAccountID == 0 {
		req.OwnerAccountID = ownerAccountID(c)
	}

	req.Username = strings.TrimSpace(req.Username)
	req.Role = strings.TrimSpace(req.Role)
	if req.Role == "" {
		req.Role = "worker"
	}

	if req.Role != "branch_admin" && req.Role != "worker" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "role must be branch_admin or worker"})
		return
	}

	if req.WorkspaceID == 0 || req.Username == "" || req.Password == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "workspaceId, username and password required"})
		return
	}

	var workspaceName string
	err := db.QueryRow(`
		SELECT name
		FROM workspaces
		WHERE id = ? AND account_id = ?
	`, req.WorkspaceID, req.OwnerAccountID).Scan(&workspaceName)

	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Рабочая точка не найдена"})
		return
	}

	dataID := workspaceDataAccountID(req.OwnerAccountID, req.WorkspaceID)

	res, err := db.Exec(`
		INSERT INTO users(account_id, owner_account_id, workspace_id, data_account_id, username, password, role, created_at)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?)
	`, req.OwnerAccountID, req.OwnerAccountID, req.WorkspaceID, dataID, req.Username, req.Password, req.Role, time.Now().Format(time.RFC3339))

	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Такой логин уже существует"})
		return
	}

	id, _ := res.LastInsertId()

	c.JSON(http.StatusOK, gin.H{
		"id":             int(id),
		"accountId":      req.OwnerAccountID,
		"ownerAccountId": req.OwnerAccountID,
		"workspaceId":    req.WorkspaceID,
		"dataAccountId":  dataID,
		"username":       req.Username,
		"role":           req.Role,
		"workspaceName":  workspaceName,
	})
}

func deleteWorkspaceUser(c *gin.Context) {
	ownerID := ownerAccountID(c)

	_, err := db.Exec(`
		DELETE FROM users
		WHERE id = ?
		  AND IFNULL(owner_account_id, account_id) = ?
		  AND role IN ('branch_admin', 'worker', 'workspace')
	`, c.Param("id"), ownerID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Status(http.StatusOK)
}
