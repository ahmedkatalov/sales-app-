package main

import (
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func aiString(s string) *string { return &s }
func TestAIProviderKeyIsolation(t *testing.T) {
	cur := aiConfig{APIKey: "test-odirouter-private-key", Model: "test-model", BaseURL: aiProviderURLs["odirouter"]}
	cfg, err := resolveAISettings(cur, aiSettingsInput{Provider: "odirouter", Model: aiString("new-model")}, true)
	if err != nil || cfg.APIKey != cur.APIKey || cfg.Model != "new-model" {
		t.Fatalf("same-provider model change failed: %v", err)
	}
	for _, base := range []string{aiProviderURLs["openrouter"], "https://other.example/v1"} {
		if _, err := resolveAISettings(cur, aiSettingsInput{BaseURL: &base}, false); err == nil {
			t.Fatal("saved key must not travel to a different endpoint")
		}
	}
	cfg, err = resolveAISettings(cur, aiSettingsInput{Provider: "openrouter", APIKey: "new-test-key", Model: aiString("openai/test-model")}, true)
	if err != nil || cfg.BaseURL != aiProviderURLs["openrouter"] || cfg.APIKey != "new-test-key" {
		t.Fatalf("provider switch failed: %v", err)
	}
	for _, base := range []string{"javascript:alert(1)", "https://user:secret@host.example/v1", "https://host.example/v1?api_key=secret", "https://host.example/v1#key", "https://host.example/v1/chat/completions"} {
		if _, err := normalizeAIBase(base); err == nil {
			t.Errorf("accepted unsafe/malformed API URL %q", base)
		}
	}
	for _, model := range []string{"", "model name", "model\nnext"} {
		if _, err := resolveAISettings(cur, aiSettingsInput{Model: &model}, true); err == nil {
			t.Error("invalid model accepted")
		}
	}
	if _, err := resolveAISettings(cur, aiSettingsInput{Provider: "openrouter", BaseURL: aiString(cur.BaseURL), APIKey: "test"}, true); err == nil {
		t.Fatal("provider/URL mismatch accepted")
	}
}

func TestAIModelCatalogFormats(t *testing.T) {
	for _, body := range []string{
		`{"data":[{"id":"vision","name":"Vision","context_length":200000,"input_modalities":["text","image"],"category":"llm"},{"id":"image-only","category":"image"}],"total":1}`,
		`{"data":[{"id":"vision","name":"Vision","context_length":200000,"architecture":{"input_modalities":["text","image"],"output_modalities":["text"]}},{"id":"image-only","architecture":{"output_modalities":["image"]}}]}`,
	} {
		models, _, err := parseAIModelCatalog([]byte(body))
		if err != nil || len(models) != 1 || !models[0].Vision || models[0].ContextLength != 200000 {
			t.Fatalf("catalog parse failed: %v %+v", err, models)
		}
	}
	for _, body := range []string{`{}`, `not-json`, `{"data":null}`} {
		if _, _, err := parseAIModelCatalog([]byte(body)); err == nil {
			t.Fatal("malformed catalog accepted")
		}
	}
}

type aiTestTransport func(*http.Request) (*http.Response, error)

func (f aiTestTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestAISettingsDraftSaveAndRestart(t *testing.T) {
	previousDB, previousClient, previousConfig := db, aiSettingsClient, aiConfigSnapshot.Load()
	tdb, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	tdb.SetMaxOpenConns(1)
	db = tdb
	t.Cleanup(func() {
		db = previousDB
		aiSettingsClient = previousClient
		aiConfigSnapshot.Store(previousConfig)
		tdb.Close()
	})
	wsExec(t, tdb, `CREATE TABLE users(id INTEGER PRIMARY KEY,account_id INTEGER,owner_account_id INTEGER,workspace_id INTEGER,data_account_id INTEGER,username TEXT,role TEXT)`)
	wsExec(t, tdb, `INSERT INTO users VALUES(1,10,10,0,10,'owner','owner'),(2,10,10,0,10,'cashier','worker')`)
	wsExec(t, tdb, `CREATE TABLE ai_settings(id INTEGER PRIMARY KEY,api_key TEXT,model TEXT,base_url TEXT,updated_at TEXT)`)
	cfg := aiConfig{APIKey: "test-private-initial-key", Model: "initial-model", BaseURL: aiProviderURLs["odirouter"]}
	aiConfigSnapshot.Store(&cfg)
	calls := 0
	aiSettingsClient = &http.Client{Transport: aiTestTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		body := `{"choices":[{"message":{"content":"OK"}}]}`
		if strings.Contains(r.URL.Path, "/models") {
			if r.URL.Path != "/v1/models/catalog" || r.URL.Query().Get("category") != "llm" || r.URL.Query().Get("page") != "2" {
				t.Error("wrong OdiRouter catalog URL")
			}
			body = `{"data":[{"id":"new-model","category":"llm","input_modalities":["image","text"]}],"total":101}`
		} else {
			if r.URL.String() != aiProviderURLs["openrouter"]+"/chat/completions" || r.Header.Get("Authorization") != "Bearer test-new-provider-key" {
				t.Error("draft sent to the wrong provider/key")
			}
			var payload map[string]any
			json.NewDecoder(r.Body).Decode(&payload)
			if payload["model"] != "draft-model" {
				t.Error("test ignored draft model")
			}
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})}
	gin.SetMode(gin.TestMode)
	router := gin.New()
	user := 1
	router.Use(func(c *gin.Context) { c.Set("authedUserID", user) })
	router.GET("/settings/ai", getAISettings)
	router.PUT("/settings/ai", setAISettings)
	router.POST("/settings/ai/test", testAISettings)
	router.POST("/settings/ai/models", getAIModels)
	request := func(method, path, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		return w
	}
	result := request("GET", "/settings/ai", "")
	if result.Code != 200 || strings.Contains(result.Body.String(), cfg.APIKey) {
		t.Fatal("settings exposed full key")
	}
	user = 2
	for _, path := range []string{"/settings/ai/test", "/settings/ai/models"} {
		if r := request("POST", path, `{}`); r.Code != 403 {
			t.Fatal("cashier could access provider")
		}
	}
	user = 1
	result = request("POST", "/settings/ai/test", `{"provider":"openrouter","baseUrl":"https://openrouter.ai/api/v1","model":"draft-model"}`)
	if result.Code != 400 || calls != 0 {
		t.Fatal("saved key was allowed for a different provider")
	}
	draft := `{"provider":"openrouter","baseUrl":"https://openrouter.ai/api/v1","model":"draft-model","apiKey":"test-new-provider-key"}`
	result = request("POST", "/settings/ai/test", draft)
	if result.Code != 200 || !strings.Contains(result.Body.String(), `"ok":true`) {
		t.Fatalf("draft test failed %s", result.Body.String())
	}
	if currentAIConfig() != cfg || wsCount(t, tdb, "SELECT count(*) FROM ai_settings") != 0 {
		t.Fatal("testing a draft changed active/saved settings")
	}
	result = request("POST", "/settings/ai/models", `{"provider":"odirouter","page":2}`)
	if result.Code != 200 || !strings.Contains(result.Body.String(), `"vision":true`) {
		t.Fatalf("catalog failed: %s", result.Body.String())
	}
	previousTransport := aiSettingsClient.Transport
	aiSettingsClient.Transport = aiTestTransport(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 401, Body: io.NopCloser(strings.NewReader(`{"error":{"message":"invalid test-private-initial-key"}}`)), Header: make(http.Header)}, nil
	})
	result = request("POST", "/settings/ai/models", `{}`)
	if result.Code != 502 || strings.Contains(result.Body.String(), cfg.APIKey) {
		t.Fatal("provider rejection leaked a key or became an app-auth failure")
	}
	aiSettingsClient.Transport = previousTransport
	result = request("PUT", "/settings/ai", draft)
	if result.Code != 200 || currentAIConfig().APIKey != "test-new-provider-key" {
		t.Fatal("save failed")
	}
	aiConfigSnapshot.Store(nil)
	applyAISettingsFromDB()
	if currentAIConfig().Model != "draft-model" || currentAIConfig().BaseURL != aiProviderURLs["openrouter"] {
		t.Fatal("saved connection did not survive reload")
	}
}

func TestAIExpenseUsesSavedConnection(t *testing.T) {
	previous := aiConfigSnapshot.Load()
	t.Cleanup(func() { aiConfigSnapshot.Store(previous) })
	t.Setenv("OPENAI_API_KEY", "wrong-environment-key")
	t.Setenv("OPENAI_MODEL", "wrong-environment-model")
	t.Setenv("OPENROUTER_BASE_URL", "http://127.0.0.1:1")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer saved-runtime-key" {
			t.Error("expense parser ignored selected provider/key")
		}
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		if body["model"] != "selected-model" {
			t.Error("expense parser ignored selected model")
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"choices":[{"message":{"content":"{\"name\":\"Test\",\"amount\":25}"}}]}`)
	}))
	defer server.Close()
	cfg := aiConfig{APIKey: "saved-runtime-key", Model: "selected-model", BaseURL: server.URL + "/v1"}
	aiConfigSnapshot.Store(&cfg)
	result, err := callOpenAIExpenseParser("Test expense 25")
	if err != nil || result.Amount != 25 {
		t.Fatalf("configured expense parser failed: %v %+v", err, result)
	}
}
