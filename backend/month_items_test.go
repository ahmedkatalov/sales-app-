package main

import (
	"database/sql"
	"math"
	"testing"
)

// Проверяем, что помесячный леджер items (его читает «Аналитика») копит ДЕНЬГИ верно:
// price*qty = фактическая чистая выручка даже при смене цены в течение месяца и при скидке.
func TestMonthItemLedgerWeightedNetRevenue(t *testing.T) {
	tdb, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer tdb.Close()
	tdb.SetMaxOpenConns(1) // один коннект — чтобы :memory: не пересоздавался

	if _, err := tdb.Exec(`
		CREATE TABLE folders(id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER, name TEXT, created_at TEXT);
		CREATE TABLE months(id INTEGER PRIMARY KEY AUTOINCREMENT, folder_id INTEGER, month TEXT, created_at TEXT);
		CREATE TABLE items(id INTEGER PRIMARY KEY AUTOINCREMENT, folder_id INTEGER, month_id INTEGER, name TEXT, cost REAL, price REAL, qty REAL);
	`); err != nil {
		t.Fatal(err)
	}

	record := func(item SaleItem, discountFactor float64) {
		tx, err := tdb.Begin()
		if err != nil {
			t.Fatal(err)
		}
		if err := increaseMonthItemTx(tx, 1, item, discountFactor, "2026-08-01T00:00:00+03:00"); err != nil {
			tx.Rollback()
			t.Fatalf("increaseMonthItemTx: %v", err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}
	}

	// Кейс 1: цену подняли в течение месяца, без скидки.
	// Реально: 10*200 + 5*250 = 3250 выручка; прибыль (200-50)*10+(250-60)*5 = 2450.
	record(SaleItem{Name: "Латте", Type: "drink", Qty: 10, Price: 200, Cost: 50}, 1.0)
	record(SaleItem{Name: "Латте", Type: "drink", Qty: 5, Price: 250, Cost: 60}, 1.0)

	var price, cost, qty float64
	if err := tdb.QueryRow(`SELECT price, cost, qty FROM items WHERE name='Латте'`).Scan(&price, &cost, &qty); err != nil {
		t.Fatal(err)
	}
	if rev := price * qty; math.Abs(rev-3250) > 0.01 {
		t.Fatalf("выручка Латте: ожидали 3250, получили %.2f (price=%.4f qty=%.2f)", rev, price, qty)
	}
	if prof := (price - cost) * qty; math.Abs(prof-2450) > 0.01 {
		t.Fatalf("прибыль Латте: ожидали 2450, получили %.2f", prof)
	}

	// Кейс 2: скидка 10% на чек — выручка должна быть чистой (180, а не 200).
	record(SaleItem{Name: "Капучино", Type: "drink", Qty: 1, Price: 200, Cost: 50}, 0.9)
	var p2, q2 float64
	if err := tdb.QueryRow(`SELECT price, qty FROM items WHERE name='Капучино'`).Scan(&p2, &q2); err != nil {
		t.Fatal(err)
	}
	if rev := p2 * q2; math.Abs(rev-180) > 0.01 {
		t.Fatalf("выручка со скидкой: ожидали 180, получили %.2f", rev)
	}
}
