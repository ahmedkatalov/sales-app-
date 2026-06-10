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

// ── Мультидоступ: дать/убрать доступ пользователю к точке ──────────────────

// GET /workspace-access — список пользователей с доступами по всем точкам owner'а
func getWorkspaceAccess(c *gin.Context) {
	ownerID := ownerAccountID(c)
	rows, err := db.Query(`
		SELECT 
			uw.id, uw.user_id, u.username, uw.workspace_id, w.name, uw.role, uw.data_account_id
		FROM user_workspaces uw
		JOIN users u ON u.id = uw.user_id
		JOIN workspaces w ON w.id = uw.workspace_id
		WHERE uw.owner_account_id = ?
		ORDER BY u.username, w.name
	`, ownerID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	list := []gin.H{}
	for rows.Next() {
		var id, userID, wsID, dataID int
		var username, wsName, role string
		rows.Scan(&id, &userID, &username, &wsID, &wsName, &role, &dataID)
		list = append(list, gin.H{
			"id": id, "userId": userID, "username": username,
			"workspaceId": wsID, "workspaceName": wsName,
			"role": role, "dataAccountId": dataID,
		})
	}
	c.JSON(http.StatusOK, list)
}

// POST /workspace-access — дать пользователю доступ к точке
func grantWorkspaceAccess(c *gin.Context) {
	ownerID := ownerAccountID(c)
	var req struct {
		UserID      int    `json:"userId"`
		WorkspaceID int    `json:"workspaceId"`
		Role        string `json:"role"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Role == "" {
		req.Role = "branch_admin"
	}
	// Проверяем что workspace принадлежит этому owner
	var wsName string
	err := db.QueryRow(`SELECT name FROM workspaces WHERE id = ? AND account_id = ?`, req.WorkspaceID, ownerID).Scan(&wsName)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Точка не найдена"})
		return
	}
	// Проверяем что пользователь принадлежит этому owner
	var username string
	err = db.QueryRow(`SELECT username FROM users WHERE id = ? AND (owner_account_id = ? OR account_id = ?)`, req.UserID, ownerID, ownerID).Scan(&username)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Пользователь не найден"})
		return
	}
	dataID := workspaceDataAccountID(ownerID, req.WorkspaceID)
	now := time.Now().Format(time.RFC3339)
	_, err = db.Exec(`
		INSERT OR REPLACE INTO user_workspaces(user_id, owner_account_id, workspace_id, data_account_id, role, created_at)
		VALUES(?, ?, ?, ?, ?, ?)
	`, req.UserID, ownerID, req.WorkspaceID, dataID, req.Role, now)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"userId": req.UserID, "username": username,
		"workspaceId": req.WorkspaceID, "workspaceName": wsName,
		"role": req.Role, "dataAccountId": dataID,
	})
}

// DELETE /workspace-access/:id — убрать доступ
func revokeWorkspaceAccess(c *gin.Context) {
	ownerID := ownerAccountID(c)
	id := c.Param("id")
	_, err := db.Exec(`
		DELETE FROM user_workspaces WHERE id = ? AND owner_account_id = ?
	`, id, ownerID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusOK)
}

// GET /my-workspaces — список точек к которым у пользователя есть доступ (для экрана выбора)
func getMyWorkspaces(c *gin.Context) {
	u, ok := currentUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	// owner видит все точки компании
	if u.Role == "owner" {
		rows, err := db.Query(`
			SELECT id, account_id, name, IFNULL(is_main,0), created_at
			FROM workspaces WHERE account_id = ? ORDER BY is_main DESC, id
		`, u.OwnerAccountID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		defer rows.Close()
		list := []gin.H{}
		for rows.Next() {
			var id, accID, isMain int
			var name, createdAt string
			rows.Scan(&id, &accID, &name, &isMain, &createdAt)
			dataID := workspaceDataAccountID(accID, id)
			list = append(list, gin.H{
				"id": id, "name": name, "isMain": isMain == 1,
				"dataAccountId": dataID, "role": "owner",
			})
		}
		c.JSON(http.StatusOK, list)
		return
	}
	// branch_admin/worker — смотрим user_workspaces
	rows, err := db.Query(`
		SELECT uw.workspace_id, w.name, IFNULL(w.is_main,0), uw.data_account_id, uw.role
		FROM user_workspaces uw
		JOIN workspaces w ON w.id = uw.workspace_id
		WHERE uw.user_id = ?
		ORDER BY w.is_main DESC, w.name
	`, u.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	list := []gin.H{}
	for rows.Next() {
		var wsID, isMain, dataID int
		var name, role string
		rows.Scan(&wsID, &name, &isMain, &dataID, &role)
		list = append(list, gin.H{
			"id": wsID, "name": name, "isMain": isMain == 1,
			"dataAccountId": dataID, "role": role,
		})
	}
	// Фолбэк — старый workspace_id если нет записей в user_workspaces
	if len(list) == 0 && u.WorkspaceID > 0 {
		var wsName string
		_ = db.QueryRow(`SELECT name FROM workspaces WHERE id = ?`, u.WorkspaceID).Scan(&wsName)
		list = append(list, gin.H{
			"id": u.WorkspaceID, "name": wsName, "isMain": false,
			"dataAccountId": u.DataAccountID, "role": u.Role,
		})
	}
	c.JSON(http.StatusOK, list)
}
