package main

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"strings"
	"time"
)

func getEmployees(c *gin.Context) {
	rows, err := db.Query(`
		SELECT id, account_id, name, IFNULL(password, '')
		FROM employees
		WHERE account_id = ?
		ORDER BY name
	`, accountID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	list := []Employee{}

	for rows.Next() {
		var e Employee
		var pass string
		if err := rows.Scan(&e.ID, &e.AccountID, &e.Name, &pass); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		e.HasPassword = pass != ""
		e.Password = "" // никогда не отдаём наружу
		list = append(list, e)
	}

	c.JSON(http.StatusOK, list)
}

func createEmployee(c *gin.Context) {
	var e Employee

	if err := c.ShouldBindJSON(&e); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	e.Name = strings.TrimSpace(e.Name)
	if e.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "employee name required"})
		return
	}

	if e.AccountID == 0 {
		e.AccountID = accountID(c)
	}

	// Пароль продавца опционален. Если задан — храним хэш.
	hashed := ""
	if pass := strings.TrimSpace(e.Password); pass != "" {
		h, err := hashPassword(pass)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "не удалось сохранить пароль"})
			return
		}
		hashed = h
	}

	res, err := db.Exec(`
		INSERT INTO employees(account_id, name, password, created_at)
		VALUES(?, ?, ?, ?)
	`, e.AccountID, e.Name, hashed, time.Now().Format(time.RFC3339))

	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "employee already exists"})
		return
	}

	id, _ := res.LastInsertId()
	e.ID = int(id)
	e.HasPassword = hashed != ""
	e.Password = ""

	c.JSON(http.StatusOK, e)
}

// PUT /employees/:id/password — задать/сменить/убрать пароль продавца (пустой = убрать)
func setEmployeePassword(c *gin.Context) {
	var req struct {
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	hashed := ""
	if pass := strings.TrimSpace(req.Password); pass != "" {
		h, err := hashPassword(pass)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "не удалось сохранить пароль"})
			return
		}
		hashed = h
	}

	if _, err := db.Exec(`UPDATE employees SET password = ? WHERE id = ? AND account_id = ?`,
		hashed, c.Param("id"), accountID(c)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "hasPassword": hashed != ""})
}

// POST /employees/:id/verify — проверить пароль при выборе профиля продавца
func verifyEmployeePassword(c *gin.Context) {
	var req struct {
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var stored string
	err := db.QueryRow(`SELECT IFNULL(password, '') FROM employees WHERE id = ? AND account_id = ?`,
		c.Param("id"), accountID(c)).Scan(&stored)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Продавец не найден"})
		return
	}

	// Нет пароля — вход свободный
	if stored == "" {
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	}

	// Важно: при неверном пароле НЕ возвращаем 401 — иначе фронтенд
	// сбросит сессию и разлогинит всё устройство. Отдаём 200 {ok:false}.
	if !checkPassword(stored, strings.TrimSpace(req.Password)) {
		c.JSON(http.StatusOK, gin.H{"ok": false, "error": "Неверный пароль"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func deleteEmployee(c *gin.Context) {
	_, err := db.Exec(`DELETE FROM employees WHERE id = ? AND account_id = ?`, c.Param("id"), accountID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Status(http.StatusOK)
}

func getCards(c *gin.Context) {
	rows, err := db.Query(`
		SELECT id, account_id, name, owner
		FROM cards
		WHERE account_id = ?
		ORDER BY id DESC
	`, accountID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	list := []Card{}

	for rows.Next() {
		var card Card
		if err := rows.Scan(&card.ID, &card.AccountID, &card.Name, &card.Owner); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		list = append(list, card)
	}

	c.JSON(http.StatusOK, list)
}

func createCard(c *gin.Context) {
	var card Card

	if err := c.ShouldBindJSON(&card); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	card.Name = strings.TrimSpace(card.Name)
	if card.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "card name required"})
		return
	}

	if card.AccountID == 0 {
		card.AccountID = accountID(c)
	}

	res, err := db.Exec(`
		INSERT INTO cards(account_id, name, owner, created_at)
		VALUES(?, ?, ?, ?)
	`, card.AccountID, card.Name, card.Owner, time.Now().Format(time.RFC3339))

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	id, _ := res.LastInsertId()
	card.ID = int(id)

	c.JSON(http.StatusOK, card)
}

func deleteCard(c *gin.Context) {
	_, err := db.Exec(`DELETE FROM cards WHERE id = ? AND account_id = ?`, c.Param("id"), accountID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Status(http.StatusOK)
}
