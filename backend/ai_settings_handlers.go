package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
)

// The existing installation-wide connection is stored as one snapshot, so a
// request never combines one provider's key with another provider's URL/model.
type aiConfig struct{ APIKey, Model, BaseURL string }

var aiConfigSnapshot atomic.Pointer[aiConfig]
var aiConfigSaveMu sync.Mutex
var aiSettingsClient = func() *http.Client {
	client := directHTTPClient(25 * time.Second)
	client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	return client
}()

var aiProviderURLs = map[string]string{
	"openrouter": "https://openrouter.ai/api/v1",
	"odirouter":  "https://api.odirouter.ai/v1",
	"openai":     "https://api.openai.com/v1",
}

func aiProvider(base string) string {
	for provider, endpoint := range aiProviderURLs {
		if base == endpoint {
			return provider
		}
	}
	return "custom"
}
func defaultAIConfig() aiConfig {
	cfg := aiConfig{APIKey: strings.TrimSpace(os.Getenv("OPENAI_API_KEY")), Model: strings.TrimSpace(os.Getenv("OPENAI_MODEL")), BaseURL: strings.TrimRight(strings.TrimSpace(os.Getenv("OPENROUTER_BASE_URL")), "/")}
	if cfg.BaseURL == "" {
		cfg.BaseURL = aiProviderURLs["openai"]
		if strings.HasPrefix(cfg.APIKey, "sk-or-") {
			cfg.BaseURL = aiProviderURLs["openrouter"]
		}
	}
	if cfg.Model == "" {
		cfg.Model = "gpt-4o-mini"
		if aiProvider(cfg.BaseURL) == "openrouter" {
			cfg.Model = "openai/gpt-4o-mini"
		}
	}
	return cfg
}
func currentAIConfig() aiConfig {
	if cfg := aiConfigSnapshot.Load(); cfg != nil {
		return *cfg
	}
	return defaultAIConfig()
}
func applyAISettingsFromDB() {
	cfg := defaultAIConfig()
	var key, model, base string
	if db.QueryRow(`SELECT IFNULL(api_key,''), IFNULL(model,''), IFNULL(base_url,'') FROM ai_settings WHERE id=1`).Scan(&key, &model, &base) == nil {
		if strings.TrimSpace(key) != "" {
			cfg.APIKey = strings.TrimSpace(key)
		}
		if strings.TrimSpace(model) != "" {
			cfg.Model = strings.TrimSpace(model)
		}
		if strings.TrimSpace(base) != "" {
			cfg.BaseURL = strings.TrimRight(strings.TrimSpace(base), "/")
		}
	}
	if strings.TrimSpace(model) == "" && strings.TrimSpace(os.Getenv("OPENAI_MODEL")) == "" {
		cfg.Model = "gpt-4o-mini"
		if aiProvider(cfg.BaseURL) == "openrouter" {
			cfg.Model = "openai/gpt-4o-mini"
		}
	}
	aiConfigSnapshot.Store(&cfg)
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
func normalizeAIBase(base string) (string, error) {
	u, err := url.Parse(strings.TrimRight(strings.TrimSpace(base), "/"))
	if err != nil || u.Hostname() == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" {
		return "", errors.New("Введите API-адрес http:// или https:// без ключа, параметров и фрагмента.")
	}
	if strings.HasSuffix(u.Path, "/chat/completions") || strings.HasSuffix(u.Path, "/models") || strings.HasSuffix(u.Path, "/responses") {
		return "", errors.New("Укажите базовый API-адрес, без /chat/completions, /models или /responses.")
	}
	u.Host = strings.ToLower(u.Host)
	return u.String(), nil
}

type aiSettingsInput struct {
	Provider string  `json:"provider"`
	BaseURL  *string `json:"baseUrl"`
	Model    *string `json:"model"`
	APIKey   string  `json:"apiKey"`
	Query    string  `json:"query"`
	Page     int     `json:"page"`
}

func resolveAISettings(cur aiConfig, in aiSettingsInput, needModel bool) (aiConfig, error) {
	next := cur
	if in.BaseURL != nil {
		next.BaseURL = strings.TrimSpace(*in.BaseURL)
	}
	if in.Provider != "" && in.Provider != "custom" {
		base, ok := aiProviderURLs[in.Provider]
		if !ok {
			return next, errors.New("Неизвестный провайдер ИИ.")
		}
		if next.BaseURL == "" || in.BaseURL == nil {
			next.BaseURL = base
		}
		if strings.TrimRight(next.BaseURL, "/") != base {
			return next, errors.New("API-адрес не соответствует выбранному провайдеру.")
		}
	}
	var err error
	next.BaseURL, err = normalizeAIBase(next.BaseURL)
	if err != nil {
		return next, err
	}
	if in.Model != nil {
		next.Model = strings.TrimSpace(*in.Model)
	}
	if needModel && (next.Model == "" || len(next.Model) > 250 || strings.ContainsAny(next.Model, "\r\n\t ")) {
		return next, errors.New("Укажите точный ID модели из каталога провайдера.")
	}
	key := strings.TrimSpace(in.APIKey)
	if key != "" {
		next.APIKey = key
	} else if next.BaseURL != cur.BaseURL {
		return next, errors.New("Для другого провайдера или API-адреса введите его API-ключ.")
	}
	if next.APIKey == "" {
		return next, errors.New("Введите API-ключ провайдера.")
	}
	if strings.ContainsAny(next.APIKey, "\r\n") || strings.Contains(next.APIKey, "…") || strings.Contains(next.APIKey, "••") {
		return next, errors.New("Введите полный API-ключ, а не его маску.")
	}
	return next, nil
}
func getAISettings(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	cfg := currentAIConfig()
	c.JSON(http.StatusOK, gin.H{"provider": aiProvider(cfg.BaseURL), "model": cfg.Model, "baseUrl": cfg.BaseURL, "hasKey": cfg.APIKey != "", "keyMasked": maskKey(cfg.APIKey), "scope": "server"})
}
func setAISettings(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	var input aiSettingsInput
	if c.ShouldBindJSON(&input) != nil {
		c.JSON(400, gin.H{"error": "Неверные данные"})
		return
	}
	aiConfigSaveMu.Lock()
	defer aiConfigSaveMu.Unlock()
	cfg, err := resolveAISettings(currentAIConfig(), input, true)
	if err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	if _, err = db.Exec(`INSERT INTO ai_settings(id,api_key,model,base_url,updated_at) VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET api_key=excluded.api_key,model=excluded.model,base_url=excluded.base_url,updated_at=excluded.updated_at`, cfg.APIKey, cfg.Model, cfg.BaseURL, time.Now().Format(time.RFC3339)); err != nil {
		c.JSON(500, gin.H{"error": "Не удалось сохранить подключение ИИ."})
		return
	}
	aiConfigSnapshot.Store(&cfg)
	c.JSON(200, gin.H{"ok": true})
}
func aiSettingsRequest(ctx context.Context, cfg aiConfig, method, path string, body any) ([]byte, error) {
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, cfg.BaseURL+path, reader)
	if err != nil {
		return nil, errors.New("Некорректный API-адрес.")
	}
	req.Header.Set("Authorization", "Bearer "+cfg.APIKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := aiSettingsClient.Do(req)
	if err != nil {
		return nil, errors.New("Не удалось связаться с провайдером. Проверьте адрес и доступ с сервера.")
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 12<<20))
	if err != nil {
		return nil, errors.New("Не удалось прочитать ответ провайдера.")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, errors.New(strings.ReplaceAll(friendlyAIError(resp.StatusCode, data), cfg.APIKey, "[ключ скрыт]"))
	}
	return data, nil
}
func testAISettings(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	var input aiSettingsInput
	if c.ShouldBindJSON(&input) != nil {
		c.JSON(400, gin.H{"error": "Неверные данные"})
		return
	}
	cfg, err := resolveAISettings(currentAIConfig(), input, true)
	if err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	// Draft values are tested without changing the active connection.
	body := map[string]any{"model": cfg.Model, "messages": []map[string]string{{"role": "user", "content": "Reply OK."}}, "max_tokens": 16}
	data, err := aiSettingsRequest(c.Request.Context(), cfg, http.MethodPost, "/chat/completions", body)
	if err == nil {
		var response struct {
			Choices []json.RawMessage `json:"choices"`
		}
		if json.Unmarshal(data, &response) != nil || len(response.Choices) == 0 {
			err = errors.New("Провайдер не вернул ответ модели в формате Chat Completions.")
		}
	}
	if err != nil {
		c.JSON(200, gin.H{"ok": false, "error": err.Error()})
		return
	}
	c.JSON(200, gin.H{"ok": true, "model": cfg.Model, "provider": aiProvider(cfg.BaseURL)})
}

type aiCatalogModel struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	ContextLength int    `json:"contextLength"`
	Vision        bool   `json:"vision"`
}

func parseAIModelCatalog(data []byte) ([]aiCatalogModel, int, error) {
	var raw struct {
		Data []struct {
			ID            string   `json:"id"`
			Name          string   `json:"name"`
			Category      string   `json:"category"`
			ContextLength int      `json:"context_length"`
			Input         []string `json:"input_modalities"`
			Architecture  struct {
				Input  []string `json:"input_modalities"`
				Output []string `json:"output_modalities"`
			} `json:"architecture"`
		} `json:"data"`
		Total int `json:"total"`
	}
	if json.Unmarshal(data, &raw) != nil || raw.Data == nil {
		return nil, 0, errors.New("Провайдер вернул непонятный список моделей. Можно указать ID вручную.")
	}
	out := make([]aiCatalogModel, 0, len(raw.Data))
	seen := map[string]bool{}
	for _, m := range raw.Data {
		if m.ID == "" || seen[m.ID] || m.Category != "" && m.Category != "llm" {
			continue
		}
		if len(m.Architecture.Output) > 0 {
			text := false
			for _, v := range m.Architecture.Output {
				if v == "text" {
					text = true
				}
			}
			if !text {
				continue
			}
		}
		vision := false
		for _, v := range append(m.Input, m.Architecture.Input...) {
			if v == "image" {
				vision = true
			}
		}
		name := m.Name
		if name == "" {
			name = m.ID
		}
		seen[m.ID] = true
		out = append(out, aiCatalogModel{m.ID, name, m.ContextLength, vision})
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out, raw.Total, nil
}
func getAIModels(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	var input aiSettingsInput
	if c.ShouldBindJSON(&input) != nil {
		c.JSON(400, gin.H{"error": "Неверные данные"})
		return
	}
	cfg, err := resolveAISettings(currentAIConfig(), input, false)
	if err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	page := input.Page
	if page < 1 {
		page = 1
	}
	path := "/models"
	if aiProvider(cfg.BaseURL) == "odirouter" {
		q := url.Values{"category": {"llm"}, "output_modality": {"text"}, "page": {strconv.Itoa(page)}, "page_size": {"100"}, "keyword": {strings.TrimSpace(input.Query)}}
		path = "/models/catalog?" + q.Encode()
	}
	data, err := aiSettingsRequest(c.Request.Context(), cfg, http.MethodGet, path, nil)
	if err != nil {
		c.JSON(502, gin.H{"error": err.Error()})
		return
	}
	models, total, err := parseAIModelCatalog(data)
	if err != nil {
		c.JSON(502, gin.H{"error": err.Error()})
		return
	}
	if aiProvider(cfg.BaseURL) != "odirouter" {
		query := strings.ToLower(strings.TrimSpace(input.Query))
		filtered := make([]aiCatalogModel, 0)
		for _, m := range models {
			if strings.Contains(strings.ToLower(m.Name+" "+m.ID), query) {
				filtered = append(filtered, m)
			}
		}
		models = filtered
		total = len(models)
	}
	c.JSON(200, gin.H{"models": models, "total": total, "page": page, "hasMore": aiProvider(cfg.BaseURL) == "odirouter" && page*100 < total})
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
	return "Провайдер вернул ошибку: " + http.StatusText(status) + ". Проверьте ключ, модель и баланс в кабинете провайдера."
}
