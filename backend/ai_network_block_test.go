package main

import "testing"

func TestAINetworkBlockMessage(t *testing.T) {
	// Реальный ответ файрвола, который видел пользователь.
	blocked := []byte(`{ "success": false, "error": "Access denied by security policy." }`)
	if msg := aiNetworkBlockMessage(403, blocked); msg == "" {
		t.Fatalf("ожидалось распознавание сетевого блока, получили пусто")
	}

	// Нормальная ошибка провайдера НЕ должна триггерить блок-сообщение.
	apiErr := []byte(`{"error":{"message":"invalid api key","type":"auth"}}`)
	if msg := aiNetworkBlockMessage(401, apiErr); msg != "" {
		t.Fatalf("ошибка авторизации не должна считаться сетевым блоком, получили: %s", msg)
	}

	// Обычный успешный/иной ответ — тоже без блок-сообщения.
	if msg := aiNetworkBlockMessage(200, []byte(`{"choices":[]}`)); msg != "" {
		t.Fatalf("200 не должен считаться блоком, получили: %s", msg)
	}
}
