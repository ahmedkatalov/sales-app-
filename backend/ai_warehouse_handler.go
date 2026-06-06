package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type aiWarehouseItemRef struct {
	ID                int     `json:"id"`
	Name              string  `json:"name"`
	Unit              string  `json:"unit"`
	Quantity          float64 `json:"quantity"`
	UnitCost          float64 `json:"unitCost"`
	PackagingQuantity float64 `json:"packagingQuantity"`
	Note              string  `json:"note"`
}

type aiWarehouseParseRequest struct {
	Text  string               `json:"text"`
	Items []aiWarehouseItemRef `json:"items"`
}

type aiWarehouseParseResult struct {
	Name             string   `json:"name"`
	MatchedItemID    int      `json:"matchedItemId"`
	PurchaseQuantity float64  `json:"purchaseQuantity"`
	PurchaseUnit     string   `json:"purchaseUnit"`
	StorageUnit      string   `json:"unit"`
	UnitsPerPackage  float64  `json:"unitsPerPackage"`
	BasePerUnit      float64  `json:"basePerUnit"`
	Price            float64  `json:"price"`
	MinQuantity      float64  `json:"minQuantity"`
	Supplier         string   `json:"supplier"`
	Note             string   `json:"note"`
	Confidence       float64  `json:"confidence"`
	Explanation      string   `json:"explanation"`
	Questions        []string `json:"questions"`
	UsedRealAI       bool     `json:"usedRealAi"`
}

type openAIResponse struct {
	Output []struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	} `json:"output"`
	OutputText string `json:"output_text"`
	Choices    []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func parseWarehousePurchaseAI(c *gin.Context) {
	var req aiWarehouseParseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	req.Text = strings.TrimSpace(req.Text)
	if req.Text == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Напиши закупку обычным языком"})
		return
	}

	result, err := callOpenAIWarehouseParser(req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	result = normalizeAIWarehouseResult(result, req)
	c.JSON(http.StatusOK, result)
}

func callOpenAIWarehouseParser(req aiWarehouseParseRequest) (aiWarehouseParseResult, error) {
	apiKey := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	if apiKey == "" {
		return aiWarehouseParseResult{}, errors.New("OPENAI_API_KEY не настроен. Это должен быть настоящий API-ключ OpenAI, иначе реальная нейронка работать не будет")
	}

	model := strings.TrimSpace(os.Getenv("OPENAI_MODEL"))
	if model == "" {
		model = "anthropic/claude-sonnet-4-6"
	}

	itemsJSON, _ := json.Marshal(req.Items)
	schema := `{
  "name": "нормальное название товара без опечаток, например молоко",
  "matchedItemId": 0,
  "purchaseQuantity": 1,
  "purchaseUnit": "box|pack|bottle|pcs|kg|g|l|ml",
  "unit": "g|ml|pcs",
  "unitsPerPackage": 1,
  "basePerUnit": 1,
  "price": 0,
  "minQuantity": 0,
  "supplier": "",
  "note": "",
  "confidence": 0.9,
  "explanation": "короткое объяснение расчёта",
  "questions": []
}`

	prompt := fmt.Sprintf(`Ты AI-помощник склада для кафе/магазина.
Твоя задача — понять ОДНУ закупочную позицию на русском, даже с опечатками: "молаако" = "молоко".
Верни СТРОГО один JSON без markdown.

КРИТИЧЕСКИ ВАЖНО:
- Не создавай товар из всей фразы. Если фрагмент "4 пачки молока" — name="молоко". Если во входе случайно несколько товаров, выбери только первый товар и добавь вопрос, что нужно разделить товары.
- Если не хватает размера упаковки, количества или цены — НЕ СОХРАНЯЙ МОЛЧА. Добавь вопрос в questions.
- Цена обязательна для закупки. Если пользователь не указал цену/стоимость закупки, price=0 и добавь вопрос "За сколько купили ...?".
- Количество обязательное. Если пользователь написал только "купил молоко" или "купил стаканчики" без количества — задай вопрос сколько купили.
- Если товар новый и название общее: стаканчики/тарелки/крышки/контейнеры/упаковка — не создавай сразу. Уточни размер/вид и предложи варианты: например "стаканчики 250мл для кофе", "стаканчики 350мл" или свой вариант.
- Если questions не пустой, frontend НЕ будет сохранять закупку.

Правила:
1. matchedItemId: если товар похож на существующий складской товар — выбери его id даже при опечатке/падеже/множественном числе.
2. Если matchedItemId найден, используй название и unit существующего товара.
3. purchaseUnit — как купили: box, pack, bottle, pcs, kg, g, l, ml.
4. unit — базовая единица хранения/списания: g, ml, pcs.
5. Если размер указан явно: "по 1л" => basePerUnit=1000, unit=ml; "по 180г" => basePerUnit=180, unit=g.
6. Если размер НЕ указан:
   - сначала используй packagingQuantity похожего существующего товара, если она > 1;
   - если пользователь написал "стандартное/обычное молоко" — можно принять 1 пачка = 1000 ml;
   - если пользователь написал просто "молоко 4 пачки" и старого размера нет — questions=["Пачка молока сколько литров: 1л, 0.9л или другое?"];
   - "рис 3 пачки" без старого размера — questions=["Сколько кг или грамм в одной пачке риса?"];
   - "масло 2 бутылки" без старого размера — questions=["Бутылка масла сколько литров или мл?"];
   - "масло 2 пачки" без старого размера — questions=["Пачка масла сколько грамм?"];
7. Для коробки/упаковки: если внутри указано "10 пачек по 180г" => purchaseQuantity=1, purchaseUnit=box, unitsPerPackage=10, basePerUnit=180, unit=g.
8. Цена — общая цена закупки. Если цена не указана, price=0 и questions обязательно должен содержать вопрос про цену.
9. Если не указано количество закупки, questions обязательно должен содержать вопрос про количество.
10. Для стаканчиков/тарелок/крышек, если нет точного размера/вида, спрашивай как сохранить товар, а не создавай "стаканчики для кофе" автоматически.
11. confidence ставь ниже 0.7, если есть вопросы.
12. Нельзя писать текст вне JSON.

Формат JSON:
%s

Существующие товары склада:
%s

Текст пользователя:
%s`, schema, string(itemsJSON), req.Text)

	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("OPENROUTER_BASE_URL")), "/")
	useOpenRouter := strings.Contains(apiKey, "sk-or-") || strings.Contains(baseURL, "openrouter")
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}

	var endpoint string
	var body map[string]any
	if useOpenRouter {
		endpoint = baseURL + "/chat/completions"
		body = map[string]any{
			"model": model,
			"messages": []map[string]string{
				{"role": "system", "content": "Ты возвращаешь только валидный JSON без markdown."},
				{"role": "user", "content": prompt},
			},
			"temperature": 0.1,
		}
	} else {
		endpoint = baseURL + "/responses"
		body = map[string]any{
			"model":       model,
			"input":       prompt,
			"temperature": 0.1,
		}
	}
	bodyBytes, _ := json.Marshal(body)

	httpReq, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return aiWarehouseParseResult{}, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	httpReq.Header.Set("Content-Type", "application/json")
	if useOpenRouter {
		httpReq.Header.Set("HTTP-Referer", "http://localhost:5173")
		httpReq.Header.Set("X-Title", "Sales App Warehouse AI")
	}

	client := &http.Client{Timeout: 45 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return aiWarehouseParseResult{}, fmt.Errorf("нейронка не ответила: %w", err)
	}
	defer resp.Body.Close()

	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var apiResp openAIResponse
		_ = json.Unmarshal(data, &apiResp)
		if apiResp.Error != nil && apiResp.Error.Message != "" {
			return aiWarehouseParseResult{}, fmt.Errorf("OpenAI error: %s", apiResp.Error.Message)
		}
		return aiWarehouseParseResult{}, fmt.Errorf("OpenAI вернул статус %d", resp.StatusCode)
	}

	var apiResp openAIResponse
	if err := json.Unmarshal(data, &apiResp); err != nil {
		return aiWarehouseParseResult{}, err
	}

	text := strings.TrimSpace(apiResp.OutputText)
	if text == "" && len(apiResp.Choices) > 0 {
		text = strings.TrimSpace(apiResp.Choices[0].Message.Content)
	}
	if text == "" {
		for _, out := range apiResp.Output {
			for _, content := range out.Content {
				if strings.TrimSpace(content.Text) != "" {
					text += content.Text
				}
			}
		}
	}

	text = extractJSONObject(text)
	var result aiWarehouseParseResult
	if err := json.Unmarshal([]byte(text), &result); err != nil {
		return aiWarehouseParseResult{}, fmt.Errorf("нейронка ответила не JSON: %s", text)
	}
	result.UsedRealAI = true
	return result, nil
}

func aiTextHasExplicitSize(text string) bool {
	t := strings.ToLower(strings.ReplaceAll(text, ",", "."))
	patterns := []string{
		`по\s*\d+(?:\.\d+)?\s*(кг|килограмм|г|гр|грамм|л|литр|мл|миллилитр)`,
		`\d+(?:\.\d+)?\s*(кг|килограмм|г|гр|грамм|л|литр|мл|миллилитр)`,
		`одн\w*\s+\w*\s*\d+(?:\.\d+)?\s*(кг|г|гр|л|мл)`,
	}
	for _, pattern := range patterns {
		if regexp.MustCompile(pattern).MatchString(t) {
			return true
		}
	}
	return false
}

func aiTextHasExplicitQuantity(text string) bool {
	t := strings.ToLower(strings.ReplaceAll(text, ",", "."))
	patterns := []string{
		`\d+(?:\.\d+)?\s*(короб\w*|упак\w*|пач\w*|бутыл\w*|кг|килограмм\w*|г|гр|грамм\w*|мл|миллилитр\w*|л\b|литр\w*|шт|штук\w*|шту\w*)`,
		`\b\d+(?:\.\d+)?\b`,
	}
	for _, pattern := range patterns {
		if regexp.MustCompile(pattern).MatchString(t) {
			return true
		}
	}
	return false
}

func aiTextHasExplicitPrice(text string) bool {
	t := strings.ToLower(strings.ReplaceAll(text, ",", "."))
	patterns := []string{
		`(?:за|цена|стоимость|сумма|на сумму|обошл\w*)\s*\d+(?:\.\d+)?`,
		`\d+(?:\.\d+)?\s*(₽|руб|р\b)`,
	}
	for _, pattern := range patterns {
		if regexp.MustCompile(pattern).MatchString(t) {
			return true
		}
	}
	return false
}

func isGenericNewWarehouseName(name string) bool {
	n := normalizeWarehouseName(name)
	generic := []string{"стакан", "стаканчик", "тарел", "крыш", "контейнер", "пакет", "салфет", "вилка", "ложк", "трубоч", "перчат"}
	for _, g := range generic {
		if strings.Contains(n, g) {
			return true
		}
	}
	return false
}

func similarWarehouseItemRefs(name string, items []aiWarehouseItemRef) []aiWarehouseItemRef {
	needle := normalizeWarehouseName(name)
	out := []aiWarehouseItemRef{}
	if needle == "" {
		return out
	}
	for _, item := range items {
		cand := normalizeWarehouseName(item.Name)
		if cand == "" {
			continue
		}
		if strings.Contains(cand, needle) || strings.Contains(needle, cand) {
			out = append(out, item)
			continue
		}
		for _, part := range strings.Fields(needle) {
			if len(part) >= 4 && strings.Contains(cand, part) {
				out = append(out, item)
				break
			}
		}
	}
	return out
}

func appendUniqueQuestion(questions []string, q string) []string {
	q = strings.TrimSpace(q)
	if q == "" {
		return questions
	}
	for _, existing := range questions {
		if strings.TrimSpace(existing) == q {
			return questions
		}
	}
	return append(questions, q)
}

func aiTextMentionsContainer(text string) bool {
	t := strings.ToLower(text)
	return regexp.MustCompile(`(пачк|упак|бутыл|короб|шт|штук)`).MatchString(t)
}

func aiQuestionForMissingSize(name string, purchaseUnit string, storageUnit string) string {
	n := normalizeWarehouseName(name)
	switch purchaseUnit {
	case "box":
		return fmt.Sprintf("Сколько внутри в одной коробке товара «%s» и какой размер одной штуки? Например: 10 пачек по 1л или 12 пачек по 180г.", name)
	case "pack":
		if strings.Contains(n, "молок") || storageUnit == "ml" {
			return fmt.Sprintf("Пачка «%s» сколько литров или мл? Например: 1л, 900мл.", name)
		}
		return fmt.Sprintf("Пачка «%s» сколько грамм или кг? Например: 1кг, 800г.", name)
	case "bottle":
		return fmt.Sprintf("Бутылка «%s» сколько литров или мл? Например: 1л, 500мл.", name)
	case "pcs":
		if storageUnit == "g" {
			return fmt.Sprintf("Одна штука «%s» сколько грамм?", name)
		}
		if storageUnit == "ml" {
			return fmt.Sprintf("Одна штука «%s» сколько мл или литров?", name)
		}
	}
	return fmt.Sprintf("Уточни размер упаковки товара «%s»: сколько грамм/мл/литров/кг в одной штуке?", name)
}
func normalizeAIWarehouseResult(result aiWarehouseParseResult, req aiWarehouseParseRequest) aiWarehouseParseResult {
	originalText := req.Text
	hasExplicitSize := aiTextHasExplicitSize(originalText)
	hasExplicitQty := aiTextHasExplicitQuantity(originalText)
	hasExplicitPrice := aiTextHasExplicitPrice(originalText)

	result.Name = cleanAIProductName(result.Name)
	result.PurchaseUnit = normalizeAIUnit(result.PurchaseUnit)
	result.StorageUnit = normalizeAIStorageUnit(result.StorageUnit)

	if result.PurchaseQuantity <= 0 {
		result.PurchaseQuantity = 0
	}
	if result.UnitsPerPackage <= 0 {
		result.UnitsPerPackage = 1
	}
	if result.Confidence <= 0 {
		result.Confidence = 0.5
	}
	if result.Confidence > 1 {
		result.Confidence = 1
	}

	var matched aiWarehouseItemRef
	if result.MatchedItemID > 0 {
		for _, item := range req.Items {
			if item.ID == result.MatchedItemID {
				matched = item
				break
			}
		}
	}

	if result.Name == "" {
		result.Name = simpleNameFromPurchaseText(req.Text)
	}
	if matched.ID == 0 {
		if m := fuzzyMatchWarehouseItem(result.Name, req.Items); m.ID > 0 {
			matched = m
			result.MatchedItemID = m.ID
		}
	}

	if matched.ID > 0 {
		// Даже если старый товар в базе был создан как "купил апельсин", AI должен вернуть нормальное название.
		cleanMatchedName := cleanAIProductName(matched.Name)
		if cleanMatchedName != "" {
			result.Name = cleanMatchedName
		} else {
			result.Name = matched.Name
		}
		if matched.Unit != "" {
			result.StorageUnit = normalizeAIStorageUnit(matched.Unit)
		}
	}
	result.Name = cleanAIProductName(result.Name)

	if !hasExplicitQty || result.PurchaseQuantity <= 0 {
		result.Questions = appendUniqueQuestion(result.Questions, fmt.Sprintf("Сколько купили товара «%s»? Например: 4 пачки, 100 шт, 2 кг.", result.Name))
		result.Confidence = 0.4
	}

	if !hasExplicitPrice || result.Price <= 0 {
		result.Questions = appendUniqueQuestion(result.Questions, fmt.Sprintf("За сколько купили «%s»? Укажи общую цену закупки.", result.Name))
		result.Confidence = 0.4
	}

	if matched.ID == 0 && isGenericNewWarehouseName(result.Name) {
		similar := similarWarehouseItemRefs(result.Name, req.Items)
		if len(similar) > 0 {
			names := []string{}
			for i, item := range similar {
				if i >= 5 {
					break
				}
				names = append(names, fmt.Sprintf("%d) %s", i+1, item.Name))
			}
			result.Questions = appendUniqueQuestion(result.Questions, fmt.Sprintf("Я нашла похожие товары: %s. К какому добавить закупку или создать новый вариант?", strings.Join(names, "; ")))
		} else {
			result.Questions = appendUniqueQuestion(result.Questions, fmt.Sprintf("Как правильно сохранить «%s»? Например: стаканчики 250мл для кофе, стаканчики 350мл, тарелки большие или свой вариант.", result.Name))
		}
		result.Confidence = 0.45
	}

	containerPurchase := result.PurchaseUnit == "pack" || result.PurchaseUnit == "bottle" || result.PurchaseUnit == "box"

	// Если пользователь купил упаковками/пачками/бутылками без размера, берём прошлый размер товара,
	// но только когда товар реально хранится в граммах/мл. Если товар хранится в штуках, нельзя превращать
	// "2 бутылки масла" в "2 шт" или "200 шт" — нужно уточнение.
	if !hasExplicitSize && aiTextMentionsContainer(originalText) && result.BasePerUnit <= 1 && matched.PackagingQuantity > 1 && result.StorageUnit != "pcs" {
		result.BasePerUnit = matched.PackagingQuantity
		if result.Explanation == "" {
			result.Explanation = fmt.Sprintf("Использовала прошлый размер упаковки товара: 1 шт = %s %s", numberToString(matched.PackagingQuantity), result.StorageUnit)
		}
	}

	// Без явного размера и без надёжной истории — лучше спросить, а не создавать мусор.
	missingReliableSize := result.BasePerUnit <= 1 || result.StorageUnit == "pcs"
	if containerPurchase && !hasExplicitSize && missingReliableSize {
		q := aiQuestionForMissingSize(result.Name, result.PurchaseUnit, result.StorageUnit)
		if len(result.Questions) == 0 {
			result.Questions = []string{q}
		}
		result.Confidence = 0.45
	}

	// Разумные дефолты только когда нет вопросов и это явно стандартный/обычный товар.
	standardText := strings.Contains(strings.ToLower(originalText), "стандарт") || strings.Contains(strings.ToLower(originalText), "обычн")
	if result.BasePerUnit <= 0 {
		if standardText || matched.PackagingQuantity > 1 {
			result.BasePerUnit = defaultBasePerUnit(result.Name, result.PurchaseUnit, result.StorageUnit)
		} else {
			result.BasePerUnit = 1
		}
	}

	if len(result.Questions) > 0 {
		result.Explanation = "Нужно уточнение перед сохранением, чтобы не испортить остатки склада."
	}

	return result
}

func cleanAIProductName(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	s = strings.ReplaceAll(s, "ё", "е")
	// Удаляем даты/время из истории и служебные слова только как отдельные слова.
	// Старый вариант удалял "так" как кусок слова и ломал "стаканчики" -> "с анчики".
	s = regexp.MustCompile(`\b\d{4}-\d{2}-\d{2}(?:t|\s)?\d{0,2}:?\d{0,2}:?\d{0,2}\b`).ReplaceAllString(s, " ")
	s = regexp.MustCompile(`\b(такс|так|короче|значит|купил|купила|купили|купи|купить|докупил|докупила|докупили|закупил|закупила|закупили|взял|взяла|взяли|добавил|добавила|добавили|приход|поступил|поступила|поступили|приобрел|приобрела|приобрели)\b`).ReplaceAllString(s, " ")
	re := regexp.MustCompile(`\d+(?:[\.,]\d+)?\s*(короб\w*|упак\w*|пач\w*|бутыл\w*|кг|килограмм\w*|гр|грамм\w*|мл|миллилитр\w*|л\b|литр\w*|шт|штук\w*|шту\w*|₽|руб\w*|р\b)`)
	s = re.ReplaceAllString(s, " ")
	s = regexp.MustCompile(`\b(по|за|цена|стоимость|сумма|каждая|каждый|которые|который|которая|значит|примерно|граммовка|граммовку|одной|один|одна)\b`).ReplaceAllString(s, " ")
	s = strings.Join(strings.Fields(s), " ")
	return canonicalWarehouseProductName(s)
}

func canonicalWarehouseProductName(name string) string {
	n := strings.ToLower(strings.TrimSpace(strings.ReplaceAll(name, "ё", "е")))
	n = strings.Join(strings.Fields(n), " ")
	if n == "" {
		return ""
	}
	aliases := map[string]string{
		"ганат": "гранат", "ганата": "гранат", "ганату": "гранат", "граната": "гранат", "гранату": "гранат", "гранаты": "гранат", "гранатом": "гранат", "гранат": "гранат",
		"апельсины": "апельсин", "апельсина": "апельсин", "апельсину": "апельсин", "апельсином": "апельсин", "апельсин": "апельсин",
		"ананасы": "ананас", "ананаса": "ананас", "ананасу": "ананас", "ананасом": "ананас", "ананас": "ананас",
		"мандарины": "мандарин", "мандарина": "мандарин", "мандарину": "мандарин", "мандарином": "мандарин", "мандарин": "мандарин",
		"яблоки": "яблоки", "яблок": "яблоки", "яблока": "яблоки", "яблоко": "яблоки",
		"бананы": "банан", "банана": "банан", "банану": "банан", "банан": "банан",
		"лимоны": "лимон", "лимона": "лимон", "лимону": "лимон", "лимон": "лимон",
		"груши": "груша", "грушу": "груша", "груша": "груша",
		"клубники": "клубника", "клубнику": "клубника", "клубника": "клубника",
		"помидоры": "помидоры", "помидор": "помидоры", "помидора": "помидоры", "помидору": "помидоры", "томаты": "помидоры", "томат": "помидоры",
	}
	if v, ok := aliases[n]; ok {
		return v
	}
	words := strings.Fields(n)
	known := []string{}
	other := []string{}
	for i, w := range words {
		if v, ok := aliases[w]; ok {
			words[i] = v
			known = append(known, v)
		} else {
			other = append(other, w)
		}
	}
	if len(known) == 1 && len(other) <= 2 {
		return known[0]
	}
	return strings.Join(words, " ")
}

func fuzzyMatchWarehouseItem(name string, items []aiWarehouseItemRef) aiWarehouseItemRef {
	needle := normalizeWarehouseName(name)
	if needle == "" {
		return aiWarehouseItemRef{}
	}
	bestScore := 0
	var best aiWarehouseItemRef
	for _, item := range items {
		cand := normalizeWarehouseName(item.Name)
		score := 0
		if cand == needle {
			score = 100
		} else if strings.Contains(cand, needle) || strings.Contains(needle, cand) {
			score = 85
		} else {
			for _, part := range strings.Fields(needle) {
				if len(part) >= 4 && strings.Contains(cand, part) {
					score += 25
				}
			}
		}
		if score > bestScore {
			bestScore = score
			best = item
		}
	}
	if bestScore >= 60 {
		return best
	}
	return aiWarehouseItemRef{}
}

func normalizeAIUnit(unit string) string {
	u := strings.ToLower(strings.TrimSpace(unit))
	switch u {
	case "kg", "кг", "килограмм", "килограммы":
		return "kg"
	case "g", "гр", "г", "грамм", "граммы":
		return "g"
	case "l", "л", "литр", "литры":
		return "l"
	case "ml", "мл", "миллилитр", "миллилитры":
		return "ml"
	case "box", "кор", "коробка", "коробки":
		return "box"
	case "pack", "пачка", "пачки", "упаковка", "упаковки":
		return "pack"
	case "bottle", "бутылка", "бутылки":
		return "bottle"
	case "pcs", "шт", "штук", "штуки":
		return "pcs"
	default:
		return "pcs"
	}
}

func normalizeAIStorageUnit(unit string) string {
	u := normalizeAIUnit(unit)
	if u == "kg" || u == "g" {
		return "g"
	}
	if u == "l" || u == "ml" {
		return "ml"
	}
	return "pcs"
}

func defaultBasePerUnit(name string, purchaseUnit string, storageUnit string) float64 {
	n := normalizeWarehouseName(name)
	if storageUnit == "ml" {
		if strings.Contains(n, "молок") || strings.Contains(n, "вода") || strings.Contains(n, "слив") || strings.Contains(n, "сок") {
			return 1000
		}
		if strings.Contains(n, "сироп") {
			return 700
		}
		return 1000
	}
	if storageUnit == "g" {
		if strings.Contains(n, "масл") {
			return 180
		}
		if strings.Contains(n, "сгущ") {
			return 380
		}
		return 100
	}
	return 1
}

func extractJSONObject(text string) string {
	text = strings.TrimSpace(text)
	start := strings.Index(text, "{")
	end := strings.LastIndex(text, "}")
	if start >= 0 && end > start {
		return text[start : end+1]
	}
	return text
}

func simpleNameFromPurchaseText(text string) string {
	s := strings.ToLower(text)
	re := regexp.MustCompile(`\d+(?:[\.,]\d+)?\s*(короб\w*|упак\w*|пач\w*|бутыл\w*|кг|килограмм\w*|гр|грамм\w*|мл|миллилитр\w*|л\b|литр\w*|шт|штук\w*|шту\w*|₽|руб\w*)`)
	s = re.ReplaceAllString(s, " ")
	for _, word := range []string{"купил", "купила", "закупил", "закупила", "взял", "взяла", "внутри", "одна", "один", "стандартное", "стандартный", "цена", "стоимость", "за"} {
		s = strings.ReplaceAll(s, word, " ")
	}
	s = strings.Join(strings.Fields(s), " ")
	if s == "" {
		return "товар"
	}
	return s
}

func numberToString(value float64) string {
	return strconv.FormatFloat(value, 'f', -1, 64)
}

type aiWarehouseAskMessage struct {
	Role string `json:"role"`
	Text string `json:"text"`
}

type aiWarehouseAskRequest struct {
	Text    string                  `json:"text"`
	History []aiWarehouseAskMessage `json:"history"`
	Memory  map[string]any          `json:"memory"`
}

type aiWarehouseAskResponse struct {
	Answer string `json:"answer"`
}

type aiWarehouseContext struct {
	Workspaces        []map[string]any `json:"workspaces"`
	Employees         []map[string]any `json:"employees"`
	Cards             []map[string]any `json:"cards"`
	ProductTypes      []map[string]any `json:"productTypes"`
	ProductCategories []map[string]any `json:"productCategories"`
	Items             []map[string]any `json:"items"`
	MenuProducts      []map[string]any `json:"menuProducts"`
	RecentMoves       []map[string]any `json:"recentMovements"`
	RecentSales       []map[string]any `json:"recentSales"`
	PendingSales      []map[string]any `json:"pendingSales"`
	DebtCustomers     []map[string]any `json:"debtCustomers"`
	Debts             []map[string]any `json:"debts"`
	GlobalExpenses    []map[string]any `json:"globalExpenses"`
	Folders           []map[string]any `json:"folders"`
	MonthlyExpenses   []map[string]any `json:"monthlyExpenses"`
	Capabilities      []map[string]any `json:"capabilities"`
	Stats             map[string]any   `json:"stats"`
}

type aiExpenseParseRequest struct {
	Text string `json:"text"`
}

type aiExpenseParseResult struct {
	Name        string   `json:"name"`
	Amount      float64  `json:"amount"`
	Category    string   `json:"category"`
	Type        string   `json:"type"`
	Comment     string   `json:"comment"`
	Confidence  float64  `json:"confidence"`
	Explanation string   `json:"explanation"`
	Questions   []string `json:"questions"`
}

func parseExpenseAI(c *gin.Context) {
	var req aiExpenseParseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.Text = strings.TrimSpace(req.Text)
	if req.Text == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Напиши расход обычным языком"})
		return
	}
	result, err := callOpenAIExpenseParser(req.Text)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	result.Name = strings.TrimSpace(result.Name)
	if result.Name == "" {
		result.Questions = appendUniqueQuestion(result.Questions, "Что именно записать в расход?")
	}
	if result.Amount <= 0 {
		result.Questions = appendUniqueQuestion(result.Questions, "На какую сумму был расход?")
	}
	result = normalizeAIExpenseResult(result, req.Text)
	c.JSON(http.StatusOK, result)
}

func normalizeAIExpenseResult(result aiExpenseParseResult, text string) aiExpenseParseResult {
	result.Name = cleanAIProductName(result.Name)
	if result.Name == "" {
		result.Name = cleanAIProductName(text)
	}
	t := strings.ToLower(text + " " + result.Name + " " + result.Type)
	productRe := regexp.MustCompile(`(фрукт|овощ|молок|кофе|зерн|сироп|сахар|мяс|куриц|рыб|рис|мук|масл|сыр|слив|напит|сок|ананас|гранат|апельсин|банан|яблок|ингредиент|сырье|сырьё|закуп)`)
	houseRe := regexp.MustCompile(`(аренд|квартир|коммун|свет|вода|газ|зарплат|аванс|такси|достав|уборк|хими|салфет|моющ|ремонт|сайт|сервис|интернет|связь|wildberries|вайлдберриз|озон|канц)`)

	cat := strings.ToLower(strings.TrimSpace(result.Category))
	if cat == "продукты" || cat == "product" || cat == "products" || productRe.MatchString(t) && !houseRe.MatchString(t) {
		result.Category = "products"
	} else {
		result.Category = "household"
	}
	if productRe.MatchString(t) && !houseRe.MatchString(t) {
		result.Category = "products"
	}
	if houseRe.MatchString(t) && !regexp.MustCompile(`(ананас|гранат|апельсин|банан|яблок|молок|кофе|сырье|сырьё|ингредиент)`).MatchString(t) {
		result.Category = "household"
	}

	if result.Category == "products" {
		if result.Type == "" || result.Type == "Расход" || result.Type == "Продукты" || result.Type == "Другое" || result.Type == "Прочее" {
			result.Type = "Закупка сырья"
		}
	} else {
		lt := strings.ToLower(result.Type)
		switch {
		case strings.Contains(t, "аренд") || strings.Contains(t, "квартир"):
			result.Type = "Аренда"
		case strings.Contains(t, "коммун") || strings.Contains(t, "свет") || strings.Contains(t, "вода") || strings.Contains(t, "газ"):
			result.Type = "Коммуналка"
		case strings.Contains(t, "зарплат") || strings.Contains(t, "аванс"):
			result.Type = "Зарплата"
		case strings.Contains(t, "такси") || strings.Contains(t, "достав"):
			result.Type = "Доставка"
		case strings.Contains(t, "уборк") || strings.Contains(t, "хими") || strings.Contains(t, "моющ"):
			result.Type = "Уборка"
		case lt == "" || lt == "расход" || lt == "другое":
			result.Type = "Прочее"
		}
	}
	if result.Confidence <= 0 {
		result.Confidence = 0.7
	}
	return result
}

func callOpenAIExpenseParser(text string) (aiExpenseParseResult, error) {
	apiKey := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	if apiKey == "" {
		return aiExpenseParseResult{}, errors.New("OPENAI_API_KEY не настроен")
	}
	model := strings.TrimSpace(os.Getenv("OPENAI_MODEL"))
	if model == "" {
		model = "anthropic/claude-sonnet-4-6"
	}
	prompt := fmt.Sprintf(`Ты AI-бухгалтер для кафе/магазина. Разбери ОДИН расход на русском и верни строго JSON без markdown.

Схема:
{"name":"что оплатили без лишних слов","amount":5000,"category":"household|products","type":"Уборка|Коммуналка|Зарплата|Аренда|Доставка|Прочее|Общий продуктовый расход|Закупка сырья","comment":"","confidence":0.9,"explanation":"коротко почему выбрал категорию","questions":[]}

Правила классификации:
- category="products" только для закупки еды/сырья/ингредиентов/напитков/товаров меню: фрукты, молоко, кофе, мясо, овощи, сахар, сироп, стаканчики/упаковка для продажи.
- Для products type="Закупка сырья", если это ингредиенты/товары для меню; иначе type="Общий продуктовый расход".
- category="household" для бытовых и операционных расходов: уборка, химия, аренда, коммуналка, такси/доставка, зарплата/аванс, сайт/сервис, ремонт, маркетплейсы, канцтовары, интернет, связь.
- Для household выбери ближайший type из: Уборка, Коммуналка, Зарплата, Аренда, Доставка, Прочее.
- name очищай от слов "купил", "оплатил", "расход", суммы и даты. Например "купил химию для уборки 1200" => name="химия для уборки", category="household", type="Уборка".
- Если сумма не указана — amount=0 и questions=["На какую сумму был расход?"]
- Если непонятно, продукт это или бытовой расход, задай короткий вопрос.
- Не выдумывай сумму.

Текст: %s`, text)
	return callAIJSON[aiExpenseParseResult](prompt, model, apiKey, "Sales App Expense AI")
}

func callAIJSON[T any](prompt, model, apiKey, title string) (T, error) {
	var zero T
	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("OPENROUTER_BASE_URL")), "/")
	useOpenRouter := strings.Contains(apiKey, "sk-or-") || strings.Contains(baseURL, "openrouter")
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}
	var endpoint string
	var body map[string]any
	if useOpenRouter {
		endpoint = baseURL + "/chat/completions"
		body = map[string]any{"model": model, "messages": []map[string]string{{"role": "system", "content": "Возвращай только валидный JSON без markdown."}, {"role": "user", "content": prompt}}, "temperature": 0.1}
	} else {
		endpoint = baseURL + "/responses"
		body = map[string]any{"model": model, "input": prompt, "temperature": 0.1}
	}
	bodyBytes, _ := json.Marshal(body)
	httpReq, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return zero, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	httpReq.Header.Set("Content-Type", "application/json")
	if useOpenRouter {
		httpReq.Header.Set("HTTP-Referer", "http://localhost:5173")
		httpReq.Header.Set("X-Title", title)
	}
	resp, err := (&http.Client{Timeout: 45 * time.Second}).Do(httpReq)
	if err != nil {
		return zero, fmt.Errorf("нейронка не ответила: %w", err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var apiResp openAIResponse
		_ = json.Unmarshal(data, &apiResp)
		if apiResp.Error != nil && apiResp.Error.Message != "" {
			return zero, fmt.Errorf("OpenAI error: %s", apiResp.Error.Message)
		}
		return zero, fmt.Errorf("OpenAI вернул статус %d", resp.StatusCode)
	}
	var apiResp openAIResponse
	if err := json.Unmarshal(data, &apiResp); err != nil {
		return zero, err
	}
	out := strings.TrimSpace(apiResp.OutputText)
	if out == "" && len(apiResp.Choices) > 0 {
		out = strings.TrimSpace(apiResp.Choices[0].Message.Content)
	}
	if out == "" {
		for _, o := range apiResp.Output {
			for _, c := range o.Content {
				out += c.Text
			}
		}
	}
	out = extractJSONObject(out)
	var result T
	if err := json.Unmarshal([]byte(out), &result); err != nil {
		return zero, fmt.Errorf("нейронка ответила не JSON: %s", out)
	}
	return result, nil
}

func askWarehouseAI(c *gin.Context) {
	var req aiWarehouseAskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.Text = strings.TrimSpace(req.Text)
	if req.Text == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Напиши вопрос"})
		return
	}
	accID := accountID(c)
	ctx := buildSmartContext(accID, req.Text)
	answer, err := callSmartAssistant(req.Text, ctx, req.History, req.Memory)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, aiWarehouseAskResponse{Answer: answer})
}

// buildSmartContext — грузит только нужные данные по ключевым словам вопроса
func buildSmartContext(accID int, question string) map[string]any {
	q := strings.ToLower(question)
	ctx := map[string]any{}
	ctx["today"] = queryTodayStats(accID)

	if containsAnyKw(q, "склад", "товар", "остат", "закуп", "сырь", "запас", "кончает", "заканчивает", "приход", "поступ", "себестоим") {
		ctx["warehouse"] = queryWarehouseItems(accID)
		ctx["movements"] = queryRecentMovements(accID, 8)
	}
	if containsAnyKw(q, "меню", "блюд", "напит", "рецепт", "прибыл", "маржа", "цена", "состав", "категор", "тип", "продукт", "кофе", "эспрессо", "латте", "капучино") {
		ctx["menu"] = queryMenuProducts(accID)
		ctx["types"] = queryProductTypes(accID)
		ctx["categories"] = queryProductCategories(accID)
	}
	if containsAnyKw(q, "продаж", "выручк", "чек", "продали", "сегодня", "вчера", "неделя", "месяц", "заказ", "заработ") {
		ctx["sales"] = queryRecentSales(accID, 20)
	}
	if containsAnyKw(q, "долг", "должен", "клиент", "рассрочк", "задолженн", "кредит", "кто должен") {
		ctx["debtCustomers"] = queryDebtCustomers(accID, 50)
		ctx["debts"] = queryDebts(accID, 50)
	}
	if containsAnyKw(q, "расход", "затрат", "аренд", "зарплат", "трат", "оплатил", "коммунал") {
		ctx["expenses"] = queryGlobalExpenses(accID, 30)
	}
	if containsAnyKw(q, "сотрудник", "работник", "карт", "точк", "филиал", "касс", "смена") {
		ctx["employees"] = queryEmployees(accID)
		ctx["workspaces"] = queryWorkspaces(accID)
		ctx["cards"] = queryCards(accID)
	}
	if len(ctx) == 1 {
		ctx["warehouse"] = queryWarehouseItems(accID)
		ctx["menu"] = queryMenuProducts(accID)
		ctx["sales"] = queryRecentSales(accID, 10)
	}
	return ctx
}

func containsAnyKw(text string, keywords ...string) bool {
	for _, kw := range keywords {
		if strings.Contains(text, kw) {
			return true
		}
	}
	return false
}

func queryWarehouseItems(accID int) []map[string]any {
	rows, err := db.Query(`SELECT id, name, unit, quantity, IFNULL(unit_cost,0), IFNULL(price,0), IFNULL(min_quantity,0), IFNULL(supplier,'') FROM warehouse_items WHERE account_id=? AND IFNULL(hidden,0)=0 ORDER BY name`, accID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id int
		var name, unit, supplier string
		var qty, uc, price, minQty float64
		if rows.Scan(&id, &name, &unit, &qty, &uc, &price, &minQty, &supplier) == nil {
			out = append(out, map[string]any{"id": id, "name": name, "unit": unit, "qty": qty, "unitCost": uc, "price": price, "minQty": minQty, "supplier": supplier})
		}
	}
	return out
}

func queryRecentMovements(accID, limit int) []map[string]any {
	rows, err := db.Query(`SELECT IFNULL(w.name,''), m.movement_type, m.quantity, IFNULL(w.unit,''), IFNULL(m.reason,''), m.created_at FROM warehouse_movements m LEFT JOIN warehouse_items w ON w.id=m.warehouse_item_id AND w.account_id=m.account_id WHERE m.account_id=? ORDER BY m.id DESC LIMIT ?`, accID, limit)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var name, mtype, unit, reason, at string
		var qty float64
		if rows.Scan(&name, &mtype, &qty, &unit, &reason, &at) == nil {
			out = append(out, map[string]any{"name": name, "type": mtype, "qty": qty, "unit": unit, "reason": reason, "at": at})
		}
	}
	return out
}

func queryMenuProducts(accID int) []map[string]any {
	rows, err := db.Query(`SELECT id, name, IFNULL(category,''), IFNULL(type,''), IFNULL(price,0), IFNULL(cost,0) FROM menu_products WHERE account_id=? ORDER BY name`, accID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id int
		var name, cat, typ string
		var price, cost float64
		if rows.Scan(&id, &name, &cat, &typ, &price, &cost) == nil {
			profit := price - cost
			margin := 0.0
			if price > 0 {
				margin = profit / price * 100
			}
			out = append(out, map[string]any{"id": id, "name": name, "category": cat, "type": typ, "price": price, "cost": cost, "profit": profit, "margin": fmt.Sprintf("%.0f%%", margin)})
		}
	}
	return out
}

func queryProductTypes(accID int) []map[string]any {
	rows, err := db.Query(`SELECT id, name FROM product_types WHERE account_id=? ORDER BY name`, accID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id int
		var name string
		if rows.Scan(&id, &name) == nil {
			out = append(out, map[string]any{"id": id, "name": name})
		}
	}
	return out
}

func queryProductCategories(accID int) []map[string]any {
	rows, err := db.Query(`SELECT id, name, IFNULL(type,'') FROM product_categories WHERE account_id=? ORDER BY name`, accID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id int
		var name, typ string
		if rows.Scan(&id, &name, &typ) == nil {
			out = append(out, map[string]any{"id": id, "name": name, "type": typ})
		}
	}
	return out
}

func queryTodayStats(accID int) map[string]any {
	var revenue, cost float64
	var count int
	_ = db.QueryRow(`SELECT IFNULL(SUM(total),0), COUNT(*) FROM sales WHERE account_id=? AND date(created_at)=date('now')`, accID).Scan(&revenue, &count)
	_ = db.QueryRow(`SELECT IFNULL(SUM(IFNULL(si.cost,0)*si.qty),0) FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE s.account_id=? AND date(s.created_at)=date('now')`, accID).Scan(&cost)
	return map[string]any{"revenue": revenue, "cost": cost, "profit": revenue - cost, "salesCount": count}
}

func queryRecentSales(accID, limit int) []map[string]any {
	rows, err := db.Query(`SELECT s.id, IFNULL(e.name,''), IFNULL(s.payment_type,''), IFNULL(s.total,0), IFNULL(s.created_at,'') FROM sales s LEFT JOIN employees e ON e.id=s.employee_id AND e.account_id=s.account_id WHERE s.account_id=? ORDER BY s.id DESC LIMIT ?`, accID, limit)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id int
		var emp, pay, at string
		var total float64
		if rows.Scan(&id, &emp, &pay, &total, &at) == nil {
			out = append(out, map[string]any{"id": id, "employee": emp, "payType": pay, "total": total, "at": at})
		}
	}
	return out
}

func queryDebtCustomers(accID, limit int) []map[string]any {
	rows, err := db.Query(`SELECT dc.id, dc.name, IFNULL(SUM(CASE WHEN d.status='open' THEN d.amount ELSE 0 END),0), COUNT(CASE WHEN d.status='open' THEN 1 END) FROM debt_customers dc LEFT JOIN debts d ON d.customer_id=dc.id AND d.account_id=dc.account_id WHERE dc.account_id=? GROUP BY dc.id, dc.name ORDER BY SUM(CASE WHEN d.status='open' THEN d.amount ELSE 0 END) DESC LIMIT ?`, accID, limit)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, cnt int
		var name string
		var amount float64
		if rows.Scan(&id, &name, &amount, &cnt) == nil {
			out = append(out, map[string]any{"id": id, "name": name, "openAmount": amount, "openCount": cnt})
		}
	}
	return out
}

func queryDebts(accID, limit int) []map[string]any {
	rows, err := db.Query(`SELECT d.id, IFNULL(dc.name,''), d.amount, d.status, IFNULL(d.created_at,'') FROM debts d LEFT JOIN debt_customers dc ON dc.id=d.customer_id AND dc.account_id=d.account_id WHERE d.account_id=? ORDER BY CASE WHEN d.status='open' THEN 0 ELSE 1 END, d.id DESC LIMIT ?`, accID, limit)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id int
		var name, status, at string
		var amount float64
		if rows.Scan(&id, &name, &amount, &status, &at) == nil {
			out = append(out, map[string]any{"id": id, "customer": name, "amount": amount, "status": status, "at": at})
		}
	}
	return out
}

func queryGlobalExpenses(accID, limit int) []map[string]any {
	rows, err := db.Query(`SELECT id, IFNULL(category,''), IFNULL(type,''), IFNULL(name,''), IFNULL(amount,0), IFNULL(created_at,'') FROM global_expenses WHERE account_id=? ORDER BY id DESC LIMIT ?`, accID, limit)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id int
		var cat, typ, name, at string
		var amount float64
		if rows.Scan(&id, &cat, &typ, &name, &amount, &at) == nil {
			out = append(out, map[string]any{"id": id, "category": cat, "type": typ, "name": name, "amount": amount, "at": at})
		}
	}
	return out
}

func queryEmployees(accID int) []map[string]any {
	rows, err := db.Query(`SELECT id, name FROM employees WHERE account_id=? ORDER BY name`, accID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id int
		var name string
		if rows.Scan(&id, &name) == nil {
			out = append(out, map[string]any{"id": id, "name": name})
		}
	}
	return out
}

func queryWorkspaces(accID int) []map[string]any {
	rows, err := db.Query(`SELECT id, name, IFNULL(is_main,0) FROM workspaces WHERE account_id=? ORDER BY is_main DESC, id`, accID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, isMain int
		var name string
		if rows.Scan(&id, &name, &isMain) == nil {
			out = append(out, map[string]any{"id": id, "name": name, "isMain": isMain == 1})
		}
	}
	return out
}

func queryCards(accID int) []map[string]any {
	rows, err := db.Query(`SELECT id, name, IFNULL(owner,'') FROM cards WHERE account_id=? ORDER BY name`, accID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id int
		var name, owner string
		if rows.Scan(&id, &name, &owner) == nil {
			out = append(out, map[string]any{"id": id, "name": name, "owner": owner})
		}
	}
	return out
}

func callSmartAssistant(question string, ctx map[string]any, history []aiWarehouseAskMessage, memory map[string]any) (string, error) {
	apiKey := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	if apiKey == "" {
		return "", errors.New("OPENAI_API_KEY не настроен")
	}
	model := strings.TrimSpace(os.Getenv("OPENAI_MODEL"))
	if model == "" {
		model = "anthropic/claude-sonnet-4-6"
	}

	systemPrompt := `Ты — свободный умный AI-оператор бизнеса (кафе/магазин). Отвечаешь по-русски живо и по делу, как опытный управляющий.
Ты не ограничен только складом: анализируй весь доступный контекст приложения и сам выбирай, что важно для ответа.

ПОЛНЫЙ ДОСТУП К ДАННЫМ БИЗНЕСА (в сообщении ниже):
• Склад: остатки, себестоимость, поставщики, движения товаров
• Меню: блюда, рецепты, цены, маржа, прибыль с каждого
• Продажи: выручка, чеки, сотрудники, статистика сегодня
• Долги: кто должен, суммы, даты, количество долгов
• Расходы: все категории расходов бизнеса
• Сотрудники, карты, точки продаж

ПРАВИЛА ОТВЕТА:
1. Данные бизнеса — в JSON. Ищи ПРЕЖДЕ чем говорить "не знаю".
2. Общие вопросы (калории, рецепты, советы по бизнесу, маркетинг, цены рынка, бытовые вопросы) — отвечай из своих знаний. НИКОГДА не говори "нет данных" или "нет доступа к интернету", если вопрос можно решить общими знаниями.
3. Если пользователь просит действие, которое уже доступно через приложение, объясни что сделал/что нужно уточнить. Не притворяйся, что сделал действие, если backend не передал подтверждение выполнения.
4. Если данных в JSON не хватает для точного бизнес-ответа — честно скажи, каких данных нет, но дай лучший вывод по имеющимся данным.
5. Кратко и конкретно. Если много данных — топ-5 и предложи уточнить.
6. Без markdown-таблиц. Списки через •.
7. Понимай сленг и опечатки: "бабки"=деньги, "кофэ"=кофе, "клента"=клиента.
8. Будь живым — можешь шутить, поддержать, дать совет по бизнесу.

КОНКРЕТНЫЕ ПОДСКАЗКИ:
• "что заканчивается?" → warehouse[].qty <= warehouse[].minQty (если minQty=0, смотри у кого qty < 500 и единица g/ml)
• "продажи сегодня" → today.revenue, today.salesCount, today.profit
• "кто должен?" → debtCustomers[], отсортированы по openAmount DESC
• "себестоимость / маржа меню" → menu[].cost, menu[].profit, menu[].margin
• "последние расходы" → expenses[], отсортированы по дате
• "сколько на складе X?" → warehouse[], ищи по name`

	ctxJSON, _ := json.Marshal(ctx)
	memJSON, _ := json.Marshal(memory)

	type hMsg struct{ Role, Content string }
	var hist []hMsg
	start := 0
	if len(history) > 12 {
		start = len(history) - 12
	}
	for _, h := range history[start:] {
		role := "user"
		if h.Role != "user" {
			role = "assistant"
		}
		text := strings.TrimSpace(h.Text)
		if len(text) > 600 {
			text = text[:600] + "..."
		}
		hist = append(hist, hMsg{role, text})
	}

	userPrompt := "ДАННЫЕ БИЗНЕСА:\n" + string(ctxJSON) + "\n\nКОНТЕКСТ СЕССИИ:\n" + string(memJSON) + "\n\nВОПРОС: " + question

	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("OPENROUTER_BASE_URL")), "/")
	if baseURL == "" {
		baseURL = "https://openrouter.ai/api/v1"
	}

	allMessages := []map[string]any{{"role": "system", "content": systemPrompt}}
	for _, h := range hist {
		allMessages = append(allMessages, map[string]any{"role": h.Role, "content": h.Content})
	}
	allMessages = append(allMessages, map[string]any{"role": "user", "content": userPrompt})

	body := map[string]any{
		"model":       model,
		"messages":    allMessages,
		"temperature": 0.3,
		"max_tokens":  2048,
	}
	bodyBytes, _ := json.Marshal(body)

	httpReq, err := http.NewRequest(http.MethodPost, baseURL+"/chat/completions", bytes.NewReader(bodyBytes))
	if err != nil {
		return "", err
	}
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("HTTP-Referer", "https://sales-app.local")
	httpReq.Header.Set("X-Title", "Sales App AI Assistant")

	resp, err := (&http.Client{Timeout: 60 * time.Second}).Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("AI не ответил: %w", err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 300 {
		lim := 300
		if len(data) < lim {
			lim = len(data)
		}
		var apiResp openAIResponse
		_ = json.Unmarshal(data, &apiResp)
		if apiResp.Error != nil && apiResp.Error.Message != "" {
			return "", fmt.Errorf("AI error: %s", apiResp.Error.Message)
		}
		return "", fmt.Errorf("AI вернул статус %d: %s", resp.StatusCode, string(data[:lim]))
	}

	var apiResp openAIResponse
	if err := json.Unmarshal(data, &apiResp); err != nil {
		return "", err
	}
	text := strings.TrimSpace(apiResp.OutputText)
	if text == "" && len(apiResp.Choices) > 0 {
		text = strings.TrimSpace(apiResp.Choices[0].Message.Content)
	}
	if text == "" {
		for _, out := range apiResp.Output {
			for _, c := range out.Content {
				text += c.Text
			}
		}
	}
	if strings.TrimSpace(text) == "" {
		text = "Не смог сформировать ответ. Попробуй переформулировать."
	}
	return strings.TrimSpace(text), nil
}

// buildWarehouseAIContext — оставлена для совместимости
func buildWarehouseAIContext(accID int) (aiWarehouseContext, error) {
	return aiWarehouseContext{}, nil
}

// callOpenAIWarehouseAssistant — оставлена для совместимости
func callOpenAIWarehouseAssistant(question string, ctx aiWarehouseContext, history []aiWarehouseAskMessage) (string, error) {
	return callSmartAssistant(question, buildSmartContext(0, question), history, nil)
}

type aiMenuRecipeIngredient struct {
	Name            string  `json:"name"`
	WarehouseItemID int     `json:"warehouseItemId"`
	Quantity        float64 `json:"quantity"`
	Unit            string  `json:"unit"`
}

type aiMenuParseRequest struct {
	Text         string               `json:"text"`
	Items        []aiWarehouseItemRef `json:"items"`
	MenuProducts []map[string]any     `json:"menuProducts"`
}

type aiMenuParseResult struct {
	Name        string                   `json:"name"`
	Price       float64                  `json:"price"`
	Type        string                   `json:"type"`
	Category    string                   `json:"category"`
	Recipe      []aiMenuRecipeIngredient `json:"recipe"`
	Confidence  float64                  `json:"confidence"`
	Explanation string                   `json:"explanation"`
	Questions   []string                 `json:"questions"`
}

func parseMenuProductAI(c *gin.Context) {
	var req aiMenuParseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.Text = strings.TrimSpace(req.Text)
	if req.Text == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Напиши какой товар меню добавить"})
		return
	}
	result, err := callOpenAIMenuParser(req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	result = normalizeAIMenuResult(result, req)
	c.JSON(http.StatusOK, result)
}

func callOpenAIMenuParser(req aiMenuParseRequest) (aiMenuParseResult, error) {
	apiKey := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	if apiKey == "" {
		return aiMenuParseResult{}, errors.New("OPENAI_API_KEY не настроен")
	}
	model := strings.TrimSpace(os.Getenv("OPENAI_MODEL"))
	if model == "" {
		model = "anthropic/claude-sonnet-4-6"
	}
	itemsJSON, _ := json.Marshal(req.Items)
	menuJSON, _ := json.Marshal(req.MenuProducts)
	prompt := fmt.Sprintf(`Ты AI-оператор меню для кафе/магазина. Разбери запрос на создание товара меню, типа и категории.
Верни строго JSON без markdown.

Формат:
{"name":"Эспрессо","price":200,"type":"Напитки","category":"Крепкие напитки","recipe":[{"name":"кофе","warehouseItemId":1,"quantity":20,"unit":"g"},{"name":"вода","warehouseItemId":2,"quantity":50,"unit":"ml"}],"confidence":0.9,"explanation":"","questions":[]}

Правила:
- Сначала пойми намерение. Если пользователь пишет "создай тип напитки, папка крепкие напитки, внутри эспрессо..." — это создание меню, НЕ закупка склада.
- type — верхний раздел/тип меню. Например: "Напитки".
- category — папка/категория внутри типа. Например: "Крепкие напитки".
- name — название товара меню. Не включай в name слова "создай", "тип", "папка", "цена", "состав".
- Цена продажи обязательна. Если не хватает цены: price=0 и questions=["Какая цена продажи у ...?"]
- Если категория/тип указаны в тексте — используй их без уточнения. Если не указаны, сам предложи логичную категорию: кофе/напитки/еда/десерты.
- Рецепт обязателен для точной себестоимости. Если пользователь не указал состав/граммовки — questions должен спросить состав.
- warehouseItemId бери из списка склада по смыслу и опечаткам. "кофеин", "кофеина", "кофейные зерна" в рецепте эспрессо обычно означает складской ингредиент "кофе".
- Если ингредиент не найден в складе — warehouseItemId=0. Система уточнит у пользователя, создать его как складской ингредиент или выбрать похожий товар.
- Количество ингредиентов указывай в единице списания склада: g/ml/pcs.
- Если пользователь написал "50мг воды" или "50 мг воды" — это почти наверняка опечатка, считай как 50 ml, потому что вода для напитка измеряется в мл.
- Если пользователь спрашивает только аналитический вопрос, а не создание меню — questions=["Это вопрос, а не создание товара меню. Спроси в чате обычным вопросом."]
- Нельзя выдумывать цену и точный рецепт.

Склад:
%s

Текущее меню:
%s

Текст пользователя:
%s`, string(itemsJSON), string(menuJSON), req.Text)
	return callAIJSON[aiMenuParseResult](prompt, model, apiKey, "Sales App Menu AI")
}

func cleanAIMenuName(name string, original string) string {
	name = strings.TrimSpace(name)
	lower := strings.ToLower(original)
	if name == "" {
		known := []string{"эспрессо", "espresso", "латте", "капучино", "флэт уайт", "flat white", "американо", "раф"}
		for _, k := range known {
			if strings.Contains(lower, k) {
				name = k
				break
			}
		}
	}
	cleaned := strings.ToLower(name)
	badWords := []string{"создай", "создать", "добавь", "добавить", "тип", "папка", "папку", "категория", "категорию", "внутри", "цена", "состав", "обычно", "используем"}
	for _, w := range badWords {
		cleaned = strings.ReplaceAll(cleaned, w, " ")
	}
	cleaned = strings.Join(strings.Fields(cleaned), " ")
	if strings.Contains(cleaned, "эспресс") || strings.Contains(cleaned, "espresso") {
		return "Эспрессо"
	}
	if strings.Contains(cleaned, "капуч") {
		return "Капучино"
	}
	if strings.Contains(cleaned, "латте") {
		return "Латте"
	}
	if strings.Contains(cleaned, "флэт") || strings.Contains(cleaned, "flat") {
		return "Флэт уайт"
	}
	if cleaned == "" {
		return strings.TrimSpace(name)
	}
	return strings.TrimSpace(cleaned)
}

func normalizeAIMenuResult(result aiMenuParseResult, req aiMenuParseRequest) aiMenuParseResult {
	result.Name = cleanAIMenuName(result.Name, req.Text)
	result.Type = strings.TrimSpace(result.Type)
	result.Category = strings.TrimSpace(result.Category)
	if result.Name == "" {
		result.Questions = appendUniqueQuestion(result.Questions, "Как назвать товар меню?")
	}
	if result.Price <= 0 {
		result.Questions = appendUniqueQuestion(result.Questions, fmt.Sprintf("Какая цена продажи у «%s»?", result.Name))
	}
	if result.Type == "" {
		name := normalizeWarehouseName(result.Name)
		if strings.Contains(name, "коф") || strings.Contains(name, "латте") || strings.Contains(name, "капуч") || strings.Contains(name, "флэт") || strings.Contains(name, "чай") || strings.Contains(name, "напит") {
			result.Type = "Напитки"
		} else {
			result.Type = "Еда"
		}
	}
	if result.Category == "" {
		if result.Type == "Напитки" {
			result.Category = "Кофе"
		} else {
			result.Category = "Основное"
		}
	}
	if len(result.Recipe) == 0 {
		result.Questions = appendUniqueQuestion(result.Questions, fmt.Sprintf("Укажи состав «%s»: какие ингредиенты и сколько грамм/мл/шт нужно на одну продажу?", result.Name))
	}
	for i := range result.Recipe {
		result.Recipe[i].Name = strings.TrimSpace(result.Recipe[i].Name)
		result.Recipe[i].Unit = normalizeAIStorageUnit(result.Recipe[i].Unit)
		if result.Recipe[i].WarehouseItemID <= 0 && result.Recipe[i].Name != "" {
			if m := fuzzyMatchWarehouseItem(result.Recipe[i].Name, req.Items); m.ID > 0 {
				result.Recipe[i].WarehouseItemID = m.ID
				result.Recipe[i].Name = m.Name
			}
		}
		if result.Recipe[i].WarehouseItemID <= 0 {
			if result.Recipe[i].Name == "" {
				result.Questions = appendUniqueQuestion(result.Questions, "Какой складской ингредиент использовать в рецепте?")
			} else {
				result.Questions = appendUniqueQuestion(result.Questions, fmt.Sprintf("На складе нет ингредиента «%s». Создать/добавить его на склад или выбрать похожий товар?", result.Recipe[i].Name))
			}
		}
		if result.Recipe[i].Quantity <= 0 {
			result.Questions = appendUniqueQuestion(result.Questions, fmt.Sprintf("Сколько %s ингредиента «%s» нужно на одну продажу?", result.Recipe[i].Unit, result.Recipe[i].Name))
		}
	}
	if len(result.Questions) > 0 {
		result.Confidence = 0.45
		result.Explanation = "Нужно уточнение перед созданием товара меню."
	} else if result.Confidence <= 0 {
		result.Confidence = 0.85
	}
	return result
}

// ---------------------------------------------------------------------------
// detectIntent — Claude за 1 вызов определяет намерение и возвращает данные
// ---------------------------------------------------------------------------

type intentRequest struct {
	Text       string               `json:"text"`
	Items      []aiWarehouseItemRef `json:"items"`
	MenuTypes  []string             `json:"menuTypes"`
	MenuCats   []string             `json:"menuCats"`
	HasPending bool                 `json:"hasPending"`
}

type intentResponse struct {
	Intent   string                   `json:"intent"`
	Items    []aiWarehouseParseResult `json:"items,omitempty"`
	Expense  *aiExpenseParseResult    `json:"expense,omitempty"`
	Menu     *aiMenuParseResult       `json:"menu,omitempty"`
	Names    []string                 `json:"names,omitempty"`
	TypeName string                   `json:"typeName,omitempty"`
	CatName  string                   `json:"catName,omitempty"`
	Answer   string                   `json:"answer,omitempty"`
	Error    string                   `json:"error,omitempty"`
}

func detectIntent(c *gin.Context) {
	var req intentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.Text = strings.TrimSpace(req.Text)
	if req.Text == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "пустой текст"})
		return
	}

	apiKey := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	if apiKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "OPENAI_API_KEY не настроен"})
		return
	}
	model := strings.TrimSpace(os.Getenv("OPENAI_MODEL"))
	if model == "" {
		model = "anthropic/claude-sonnet-4-6"
	}

	itemsJSON, _ := json.Marshal(req.Items)
	typesJSON, _ := json.Marshal(req.MenuTypes)
	catsJSON, _ := json.Marshal(req.MenuCats)

	systemPrompt := `Ты умный роутер команд для приложения учёта продаж (кафе/магазин).
Получаешь текст пользователя и возвращаешь ТОЛЬКО валидный JSON с полем "intent" и данными.
Без markdown, без пояснений снаружи JSON. Не используй фронтовые правила: именно модель должна понять намерение по смыслу, даже с ошибками и разговорной речью.`

	userPrompt := fmt.Sprintf(`Определи намерение и верни JSON.

INTENT варианты:
- "purchase" — купили товар(ы) для склада. Поле items[] с товарами.
- "expense" — оплатили расход (аренда, такси, зарплата). Поле expense{}.
- "menu_create" — создать блюдо/напиток. Поле menu{}.
- "menu_type_create" — создать тип/раздел меню. Поле names[].
- "menu_cat_create" — создать папку меню. Поля catName, typeName.
- "cancel" — отмена ("стоп", "отмена", "забей").
- "question" — вопрос, общая консультация, свободный разговор или команда, для которой нет безопасного действия в этом JSON-протоколе.

ПРАВИЛА purchase:
- Любая покупка товара для склада: купил/взял/закупил + товар + количество + цена
- Может быть несколько товаров в одном тексте — все в items[]
- items[] схема:
  {"name":"апельсин","matchedItemId":0,"purchaseQuantity":3,"purchaseUnit":"kg","unit":"g","basePerUnit":1000,"price":500,"questions":[]}
- name: ТОЛЬКО чистое название. БЕЗ слов купил/взял/за/рублей/кг/новые/это
- purchaseUnit: kg/g/l/ml/pcs/pack/bottle/box
- unit: базовая единица хранения: g/ml/pcs
- basePerUnit: сколько базовых в одной закупочной (kg→1000g, l→1000ml, иначе 1)
- price: ОБЩАЯ сумма за все единицы этого товара
- Если цена есть → questions=[]
- Понимай: "на сумму 500р" = price:500, "за 30р" = price:30, "100 граммов" = purchaseQuantity:100, purchaseUnit:"g"

ПРАВИЛА expense:
- Хозяйственные расходы: аренда, такси, зарплата, уборка, реклама
- НЕ путать с закупкой (молоко, кофе, фрукты = purchase)
- expense: {"name":"...","amount":1200,"category":"household","type":"Такси","questions":[]}

ТИПЫ МЕНЮ: %s
КАТЕГОРИИ: %s
СКЛАД: %s
ЕСТЬ PENDING: %v

ТЕКСТ: %s

Пример ответа на "купил апельсин 3кг за 500р и петрушку 100г за 30р":
{"intent":"purchase","items":[{"name":"апельсин","purchaseQuantity":3,"purchaseUnit":"kg","unit":"g","basePerUnit":1000,"price":500,"questions":[]},{"name":"петрушка","purchaseQuantity":100,"purchaseUnit":"g","unit":"g","basePerUnit":1,"price":30,"questions":[]}]}`,
		string(typesJSON), string(catsJSON), string(itemsJSON), req.HasPending, req.Text)

	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("OPENROUTER_BASE_URL")), "/")
	if baseURL == "" {
		baseURL = "https://openrouter.ai/api/v1"
	}

	body := map[string]any{
		"model": model,
		"messages": []map[string]any{
			{"role": "system", "content": systemPrompt},
			{"role": "user", "content": userPrompt},
		},
		"temperature": 0,
		"max_tokens":  1024,
	}
	bodyBytes, _ := json.Marshal(body)

	httpReq, err := http.NewRequest(http.MethodPost, baseURL+"/chat/completions", bytes.NewReader(bodyBytes))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("HTTP-Referer", "https://sales-app.local")
	httpReq.Header.Set("X-Title", "Sales App Intent Router")

	resp, err := (&http.Client{Timeout: 20 * time.Second}).Do(httpReq)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "AI не ответил: " + err.Error()})
		return
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 300 {
		lim := 300
		if len(data) < lim {
			lim = len(data)
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("AI %d: %s", resp.StatusCode, string(data[:lim]))})
		return
	}

	var apiResp openAIResponse
	json.Unmarshal(data, &apiResp)
	text := strings.TrimSpace(apiResp.OutputText)
	if text == "" && len(apiResp.Choices) > 0 {
		text = strings.TrimSpace(apiResp.Choices[0].Message.Content)
	}

	// Чистим markdown
	text = regexp.MustCompile("(?s)```(?:json)?\\s*").ReplaceAllString(text, "")
	text = strings.ReplaceAll(text, "```", "")
	text = strings.TrimSpace(text)
	if s := strings.Index(text, "{"); s >= 0 {
		if e := strings.LastIndex(text, "}"); e > s {
			text = text[s : e+1]
		}
	}

	var result intentResponse
	if err := json.Unmarshal([]byte(text), &result); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "AI вернул не JSON: " + text[:func() int {
			if len(text) < 200 {
				return len(text)
			}
			return 200
		}()]})
		return
	}

	// Нормализуем имена товаров
	if result.Intent == "purchase" {
		for i, item := range result.Items {
			result.Items[i].Name = cleanAIProductName(item.Name)
			if result.Items[i].Name == "" {
				result.Items[i].Name = item.Name
			}
		}
	}

	c.JSON(http.StatusOK, result)
}
