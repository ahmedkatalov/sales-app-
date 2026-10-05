package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// Настройки ИИ из приложения. Значения из БД (строка ai_settings id=1) ПЕРЕКРЫВАЮТ
// переменные окружения: при сохранении пишем и в БД, и в окружение процесса
// (os.Setenv), чтобы все AI-хендлеры (читают os.Getenv) сразу подхватили новое —
// без перезапуска. На старте применяем сохранённое из БД.

// applyAISettingsFromDB — на старте: переносим сохранённые значения в окружение.
func applyAISettingsFromDB() {
	var key, model, base string
	err := db.QueryRow(`SELECT IFNULL(api_key,''), IFNULL(model,''), IFNULL(base_url,'') FROM ai_settings WHERE id=1`).Scan(&key, &model, &base)
	if err != nil {
		return
	}
	if strings.TrimSpace(key) != "" {
		_ = os.Setenv("OPENAI_API_KEY", strings.TrimSpace(key))
	}
	if strings.TrimSpace(model) != "" {
		_ = os.Setenv("OPENAI_MODEL", strings.TrimSpace(model))
	}
	if strings.TrimSpace(base) != "" {
		_ = os.Setenv("OPENROUTER_BASE_URL", strings.TrimSpace(base))
	}
}

func maskKey(k string) string {
	k = strings.TrimSpace(k)
	if k == "" {
		return ""
	}
	if len(k) <= 8 {
		return "••••"
	}
	return k[:4] + "…" + k[len(k)-4:]
}

// GET /settings/ai — текущая конфигурация ИИ (ключ НЕ отдаём целиком, только маску).
func getAISettings(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	var key, model, base string
	_ = db.QueryRow(`SELECT IFNULL(api_key,''), IFNULL(model,''), IFNULL(base_url,'') FROM ai_settings WHERE id=1`).Scan(&key, &model, &base)

	effKey := strings.TrimSpace(key)
	if effKey == "" {
		effKey = strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	}
	if strings.TrimSpace(model) == "" {
		model = strings.TrimSpace(os.Getenv("OPENAI_MODEL"))
	}
	if strings.TrimSpace(base) == "" {
		base = strings.TrimSpace(os.Getenv("OPENROUTER_BASE_URL"))
	}
	c.JSON(http.StatusOK, gin.H{
		"model":     model,
		"baseUrl":   base,
		"hasKey":    effKey != "",
		"keyMasked": maskKey(effKey),
	})
}

// PUT /settings/ai — сохранить ключ/модель/базовый URL. Пустой apiKey = оставить
// прежний ключ (чтобы не стирать его при правке модели). Применяем сразу в окружение.
func setAISettings(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	var body struct {
		ApiKey  string `json:"apiKey"`
		Model   string `json:"model"`
		BaseURL string `json:"baseUrl"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные"})
		return
	}
	model := strings.TrimSpace(body.Model)
	base := strings.TrimRight(strings.TrimSpace(body.BaseURL), "/")
	newKey := strings.TrimSpace(body.ApiKey)

	var curKey string
	_ = db.QueryRow(`SELECT IFNULL(api_key,'') FROM ai_settings WHERE id=1`).Scan(&curKey)
	if newKey == "" {
		newKey = curKey // не присылали ключ — оставляем прежний
	}

	now := time.Now().Format(time.RFC3339)
	if _, err := db.Exec(`
		INSERT INTO ai_settings(id, api_key, model, base_url, updated_at) VALUES(1, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET api_key=excluded.api_key, model=excluded.model, base_url=excluded.base_url, updated_at=excluded.updated_at
	`, newKey, model, base, now); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Применяем сразу в окружение процесса (все AI-хендлеры читают os.Getenv).
	if newKey != "" {
		_ = os.Setenv("OPENAI_API_KEY", newKey)
	}
	if model != "" {
		_ = os.Setenv("OPENAI_MODEL", model)
	}
	if base != "" {
		_ = os.Setenv("OPENROUTER_BASE_URL", base)
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// POST /settings/ai/test — проверка: делаем короткий запрос к /chat/completions
// с текущими ключом/моделью/URL и сообщаем, ответила ли нейросеть.
func testAISettings(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	apiKey := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	if apiKey == "" {
		c.JSON(http.StatusOK, gin.H{"ok": false, "error": "Не задан API-ключ"})
		return
	}
	model := strings.TrimSpace(os.Getenv("OPENAI_MODEL"))
	if model == "" {
		model = "gpt-4o-mini"
	}
	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("OPENROUTER_BASE_URL")), "/")
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}

	body, _ := json.Marshal(map[string]any{
		"model": model,
		"messages": []map[string]string{
			{"role": "user", "content": "ping"},
		},
		"max_tokens": 1,
	})
	req, err := http.NewRequest(http.MethodPost, baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"ok": false, "error": err.Error()})
		return
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := directHTTPClient(20 * time.Second).Do(req)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"ok": false, "error": "Нейросеть не ответила: " + err.Error()})
		return
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		c.JSON(http.StatusOK, gin.H{"ok": true, "model": model, "baseUrl": baseURL})
		return
	}
	msg := friendlyAIError(resp.StatusCode, data)
	c.JSON(http.StatusOK, gin.H{"ok": false, "error": msg})
}

// friendlyAIError — короткое человекочитаемое сообщение из ответа провайдера.
func friendlyAIError(status int, data []byte) string {
	var apiResp openAIResponse
	_ = json.Unmarshal(data, &apiResp)
	if apiResp.Error != nil && strings.TrimSpace(apiResp.Error.Message) != "" {
		return apiResp.Error.Message
	}
	if m := aiNetworkBlockMessage(status, data); m != "" {
		return m
	}
	snippet := strings.TrimSpace(string(data))
	if len(snippet) > 180 {
		snippet = snippet[:180]
	}
	if snippet == "" {
		return errors.New("провайдер вернул статус " + http.StatusText(status)).Error()
	}
	return snippet
}
