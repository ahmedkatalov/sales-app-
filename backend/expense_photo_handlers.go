package main

import (
	"encoding/base64"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// Фото накладной/чека к расходу. Храним файл на диске под data/uploads/expenses/<accID>/,
// а в global_expenses.photo_path — относительный путь. Один расход = одно фото
// (повторная загрузка заменяет). Всё поточечно: доступ только к своим расходам.

const expensePhotoMaxBytes = 6 << 20 // 6 МБ на распакованное изображение

var expenseUploadsRoot = filepath.Join("data", "uploads", "expenses")

// removeExpensePhotoFile — best-effort удаление файла фото расхода (при удалении расхода
// или замене). id — строковый c.Param.
func removeExpensePhotoFile(accID int, idStr string) {
	id, err := strconv.Atoi(idStr)
	if err != nil {
		return
	}
	var p string
	if err := db.QueryRow(`SELECT IFNULL(photo_path,'') FROM global_expenses WHERE id=? AND account_id=?`, id, accID).Scan(&p); err != nil || p == "" {
		return
	}
	if safeExpensePhotoPath(p) {
		_ = os.Remove(p)
	}
}

// safeExpensePhotoPath — защита от path traversal: путь обязан лежать внутри uploads-каталога.
func safeExpensePhotoPath(p string) bool {
	clean := filepath.Clean(p)
	return strings.HasPrefix(clean, expenseUploadsRoot+string(os.PathSeparator))
}

// POST /global-expenses/:id/photo — прикрепить фото (base64 data URL в JSON {photo}).
func uploadExpensePhoto(c *gin.Context) {
	accID := accountID(c)
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный расход"})
		return
	}
	// Расход должен принадлежать точке.
	var exist int
	if e := db.QueryRow(`SELECT 1 FROM global_expenses WHERE id=? AND account_id=?`, id, accID).Scan(&exist); e != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Расход не найден"})
		return
	}

	var body struct {
		Photo string `json:"photo"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные"})
		return
	}
	raw := strings.TrimSpace(body.Photo)

	// Разбираем data:image/<тип>;base64,<данные>
	ext := "jpg"
	if strings.HasPrefix(raw, "data:") {
		comma := strings.Index(raw, ",")
		if comma < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Не удалось прочитать фото"})
			return
		}
		meta := raw[5:comma]
		mime := strings.SplitN(meta, ";", 2)[0]
		switch mime {
		case "image/jpeg", "image/jpg":
			ext = "jpg"
		case "image/png":
			ext = "png"
		case "image/webp":
			ext = "webp"
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": "Поддерживаются только JPEG, PNG или WEBP"})
			return
		}
		raw = raw[comma+1:]
	}

	data, err := base64.StdEncoding.DecodeString(raw)
	if err != nil || len(data) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Не удалось прочитать фото"})
		return
	}
	if len(data) > expensePhotoMaxBytes {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Фото слишком большое — уменьшите качество"})
		return
	}

	dir := filepath.Join(expenseUploadsRoot, strconv.Itoa(accID))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Удаляем прежнее фото (могло быть с другим расширением), потом пишем новое.
	removeExpensePhotoFile(accID, idStr)
	path := filepath.Join(dir, strconv.Itoa(id)+"."+ext)
	if err := os.WriteFile(path, data, 0o644); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if _, err := db.Exec(`UPDATE global_expenses SET photo_path=? WHERE id=? AND account_id=?`, path, id, accID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "hasPhoto": true})
}

// GET /global-expenses/:id/photo — отдать файл фото (только своей точки).
// <img src> не умеет слать заголовки авторизации, поэтому клиент грузит это как blob.
func getExpensePhoto(c *gin.Context) {
	accID := accountID(c)
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный расход"})
		return
	}
	var p string
	if e := db.QueryRow(`SELECT IFNULL(photo_path,'') FROM global_expenses WHERE id=? AND account_id=?`, id, accID).Scan(&p); e != nil || strings.TrimSpace(p) == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "Фото нет"})
		return
	}
	if !safeExpensePhotoPath(p) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Недоступно"})
		return
	}
	if _, err := os.Stat(p); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Файл не найден"})
		return
	}
	c.File(p)
}

// DELETE /global-expenses/:id/photo — открепить фото (файл + путь).
func deleteExpensePhoto(c *gin.Context) {
	accID := accountID(c)
	removeExpensePhotoFile(accID, c.Param("id"))
	if _, err := db.Exec(`UPDATE global_expenses SET photo_path='' WHERE id=? AND account_id=?`, c.Param("id"), accID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "hasPhoto": false})
}
