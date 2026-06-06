package main

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"strings"
	"time"
)

func getEmployees(c *gin.Context) {
	rows, err := db.Query(`
		SELECT id, account_id, name
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
		if err := rows.Scan(&e.ID, &e.AccountID, &e.Name); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
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

	res, err := db.Exec(`
		INSERT INTO employees(account_id, name, created_at)
		VALUES(?, ?, ?)
	`, e.AccountID, e.Name, time.Now().Format(time.RFC3339))

	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "employee already exists"})
		return
	}

	id, _ := res.LastInsertId()
	e.ID = int(id)

	c.JSON(http.StatusOK, e)
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
