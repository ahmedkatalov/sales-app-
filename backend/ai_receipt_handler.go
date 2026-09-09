package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// Распознавание фото накладной/чека (часто рукописного) мультимодальной моделью.
// Возвращает позиции закупки в том же виде, что и текстовый парсер, — фронт гонит
// их через обычный поток закупки (проверка → запись), а фото цепляет к расходу.

type receiptParseRequest struct {
	Image string        `json:"image"` // data:image/...;base64,...
	Hint  string        `json:"hint"`  // необязательная подсказка от пользователя
	Items []interface{} `json:"items"` // текущие товары склада для сопоставления
}

type receiptItem struct {
	Name             string   `json:"name"`
	Quantity         float64  `json:"quantity"`
	PurchaseQuantity float64  `json:"purchaseQuantity"`
	PurchaseUnit     string   `json:"purchaseUnit"`
	Unit             string   `json:"unit"`
	BasePerUnit      float64  `json:"basePerUnit"`
	UnitsPerPackage  float64  `json:"unitsPerPackage"`
	Price            float64  `json:"price"`
	MatchedItemID    int      `json:"matchedItemId"`
	Questions        []string `json:"questions"`
}

type receiptResult struct {
	Items []receiptItem `json:"items"`
	Total float64       `json:"total"`
	Note  string        `json:"note"`
}

// Асинхронные задачи распознавания: vision-запрос идёт в фоне, а HTTP-ответ
// отдаётся мгновенно (jobId) — так ни один прокси (nginx/vite) не рвёт долгое
// соединение по таймауту (это и давало 503). Клиент забирает результат опросом.
type receiptJob struct {
	accID  int
	status string // pending | done | error
	result receiptResult
	errMsg string
	at     time.Time
}

var (
	receiptJobs   = map[string]*receiptJob{}
	receiptJobsMu sync.Mutex
)

func newReceiptJobID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// POST /ai/warehouse/parse-photo — принимает фото, запускает распознавание в фоне,
// сразу возвращает {jobId}.
func parseReceiptPhotoAI(c *gin.Context) {
	accID := accountID(c)
	var req receiptParseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные"})
		return
	}
	if !strings.HasPrefix(strings.TrimSpace(req.Image), "data:image/") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Нужно фото накладной"})
		return
	}
	// ~9 МБ base64 ≈ ~6.7 МБ изображения — подстраховка от гигантского фото.
	if len(req.Image) > 9<<20 {
		c.JSON(http.StatusOK, gin.H{"status": "error", "items": []any{}, "note": "Фото слишком большое — переснимите чуть меньше."})
		return
	}

	id := newReceiptJobID()
	receiptJobsMu.Lock()
	// Подчищаем старые задачи (>10 мин), чтобы карта не росла бесконечно.
	for k, j := range receiptJobs {
		if time.Since(j.at) > 10*time.Minute {
			delete(receiptJobs, k)
		}
	}
	receiptJobs[id] = &receiptJob{accID: accID, status: "pending", at: time.Now()}
	receiptJobsMu.Unlock()

	go func() {
		res, err := callReceiptVisionParser(req)
		receiptJobsMu.Lock()
		if j := receiptJobs[id]; j != nil {
			j.at = time.Now()
			if err != nil {
				j.status, j.errMsg = "error", err.Error()
			} else {
				j.status, j.result = "done", res
			}
		}
		receiptJobsMu.Unlock()
	}()

	c.JSON(http.StatusOK, gin.H{"jobId": id, "status": "pending"})
}

// GET /ai/warehouse/parse-photo/:jobId — статус/результат распознавания.
func getReceiptPhotoJob(c *gin.Context) {
	accID := accountID(c)
	receiptJobsMu.Lock()
	j := receiptJobs[c.Param("jobId")]
	receiptJobsMu.Unlock()
	if j == nil || j.accID != accID {
		c.JSON(http.StatusOK, gin.H{"status": "error", "items": []any{}, "note": "Задача не найдена — попробуйте ещё раз."})
		return
	}
	switch j.status {
	case "pending":
		c.JSON(http.StatusOK, gin.H{"status": "pending"})
	case "error":
		c.JSON(http.StatusOK, gin.H{"status": "error", "items": []any{}, "note": j.errMsg})
	default:
		c.JSON(http.StatusOK, gin.H{"status": "done", "items": j.result.Items, "total": j.result.Total, "note": j.result.Note})
	}
}

func callReceiptVisionParser(req receiptParseRequest) (receiptResult, error) {
	apiKey := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	if apiKey == "" {
		return receiptResult{}, errors.New("OPENAI_API_KEY не настроен")
	}
	model := strings.TrimSpace(os.Getenv("OPENAI_MODEL"))
	if model == "" {
		model = "anthropic/claude-sonnet-4-6"
	}

	itemsJSON, _ := json.Marshal(req.Items)
	prompt := fmt.Sprintf(`Ты распознаёшь фото НАКЛАДНОЙ или ЧЕКА для кафе/магазина. Текст часто РУКОПИСНЫЙ, на русском, с сокращениями и опечатками.
Извлеки список закупленных позиций. Верни СТРОГО один JSON без markdown.

Для каждой позиции:
- name: каноничное правильное название (исправь опечатки/бренд: "кокакола"->"Кока-Кола", "малако"->"Молоко").
- purchaseQuantity: сколько купили (число). Если написано "5кг" -> 5, purchaseUnit="kg".
- purchaseUnit: как купили: kg, g, l, ml, pcs, pack, box, bottle.
- unit: базовая единица хранения: g, ml или pcs.
- basePerUnit: размер упаковки в базовых единицах (по 1л -> 1000, unit=ml; по 180г -> 180, unit=g), иначе 1.
- unitsPerPackage: сколько единиц в коробке/упаковке, иначе 1.
- price: ЦЕНА ЗА ВСЮ ПОЗИЦИЮ (не за единицу).
- matchedItemId: id похожего товара со склада (даже при опечатке/падеже), иначе 0.
- questions: список уточнений, если чего-то не хватает.

КРИТИЧЕСКИ про цены:
- Если у позиции цена НЕ подписана, но её можно ОДНОЗНАЧНО вычислить из итога — вычисли.
  Пример: "молоко 100, кола 100, спрайт —, ИТОГО 300" => спрайт=100 (300−100−100).
  Пример: если все позиции по одной цене и указан итог — раздели.
- Если однозначно вычислить нельзя — price=0 и добавь в questions "За сколько купили <name>?".
- Если не указано количество — добавь вопрос про количество.

Верни JSON:
{"items":[{"name":"","purchaseQuantity":0,"purchaseUnit":"","unit":"","basePerUnit":1,"unitsPerPackage":1,"price":0,"matchedItemId":0,"questions":[]}],"total":0,"note":"кратко: что распознал, что неясно"}

Если на фото НЕ накладная или совсем не разобрать — верни items=[] и note с объяснением.

Существующие товары склада (для matchedItemId):
%s

Подсказка пользователя (может быть пустой): %s`, string(itemsJSON), strings.TrimSpace(req.Hint))

	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("OPENROUTER_BASE_URL")), "/")
	useOpenRouter := strings.Contains(apiKey, "sk-or-") || strings.Contains(baseURL, "openrouter")
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}
	// Vision-запрос — мультимодальное сообщение (текст + картинка) в формате
	// chat/completions (его понимают и OpenRouter, и OpenAI).
	body := map[string]any{
		"model": model,
		"messages": []map[string]any{
			{"role": "system", "content": "Ты возвращаешь только валидный JSON без markdown."},
			{"role": "user", "content": []map[string]any{
				{"type": "text", "text": prompt},
				{"type": "image_url", "image_url": map[string]any{"url": req.Image}},
			}},
		},
		"temperature": 0.1,
	}
	bodyBytes, _ := json.Marshal(body)

	httpReq, err := http.NewRequest(http.MethodPost, baseURL+"/chat/completions", bytes.NewReader(bodyBytes))
	if err != nil {
		return receiptResult{}, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	httpReq.Header.Set("Content-Type", "application/json")
	if useOpenRouter {
		httpReq.Header.Set("HTTP-Referer", "http://localhost:5173")
		httpReq.Header.Set("X-Title", "Sales App Receipt AI")
	}

	client := directHTTPClient(60 * time.Second) // vision дольше — даём запас
	resp, err := client.Do(httpReq)
	if err != nil {
		return receiptResult{}, fmt.Errorf("нейронка не ответила: %w", err)
	}
	defer resp.Body.Close()

	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		if msg := aiNetworkBlockMessage(resp.StatusCode, data); msg != "" {
			return receiptResult{}, errors.New(msg)
		}
		var apiResp openAIResponse
		_ = json.Unmarshal(data, &apiResp)
		if apiResp.Error != nil && apiResp.Error.Message != "" {
			return receiptResult{}, fmt.Errorf("ИИ ошибка: %s", apiResp.Error.Message)
		}
		return receiptResult{}, fmt.Errorf("ИИ вернул статус %d", resp.StatusCode)
	}

	var apiResp openAIResponse
	if err := json.Unmarshal(data, &apiResp); err != nil {
		return receiptResult{}, err
	}
	text := strings.TrimSpace(apiResp.OutputText)
	if text == "" && len(apiResp.Choices) > 0 {
		text = strings.TrimSpace(apiResp.Choices[0].Message.Content)
	}
	if text == "" {
		for _, out := range apiResp.Output {
			for _, content := range out.Content {
				text += content.Text
			}
		}
	}
	text = extractJSONObject(text)
	var result receiptResult
	if err := json.Unmarshal([]byte(text), &result); err != nil {
		return receiptResult{}, fmt.Errorf("не удалось разобрать ответ ИИ")
	}
	return result, nil
}
