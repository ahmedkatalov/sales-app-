package main

import (
	"strings"
	"testing"
)

// «900р», «1500р» — очень частая русская запись цены. Раньше `р\b` их не ловил
// (\b — ASCII-граница, кириллическая «р» не ASCII-слово), из-за чего приложение
// зря спрашивало «за сколько купили?» и блокировало сохранение закупки.
func TestAiTextHasExplicitPrice(t *testing.T) {
	yes := []string{
		"молоко 5 пачек 900р",
		"аренда 1500р",
		"молоко 900 р",
		"900₽",
		"500 руб",
		"за 900",
		"цена 250",
		"молоко 900р, сахар 200р",
	}
	no := []string{
		"молоко 5 пачек",
		"река зелёная", // одиночная «р» без числа не должна считаться ценой
		"5 литров молока",
		"просто текст без цены",
	}
	for _, s := range yes {
		if !aiTextHasExplicitPrice(s) {
			t.Errorf("ожидали цена=есть для %q, получили нет", s)
		}
	}
	for _, s := range no {
		if aiTextHasExplicitPrice(s) {
			t.Errorf("ожидали цена=нет для %q, получили есть", s)
		}
	}
}

// Чистка имени: количество+единица после числа убирается, обычное слово — нет.
func TestCleanAIProductNameStripsTrailingUnits(t *testing.T) {
	if got := cleanAIProductName("молоко 900р"); strings.Contains(got, "900") {
		t.Errorf("«900р» не убрано из имени: %q", got)
	}
	if got := cleanAIProductName("вода 2 л"); strings.Contains(got, "2") {
		t.Errorf("«2 л» не убрано из имени: %q", got)
	}
	// «эль» — без ведущего числа, «л» не должна съедаться → имя не пустеет
	if got := strings.TrimSpace(cleanAIProductName("эль")); got == "" {
		t.Errorf("имя «эль» ошибочно вычищено в пустоту")
	}
}
