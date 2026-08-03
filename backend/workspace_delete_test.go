package main

import (
	"database/sql"
	"testing"
)

func wsExec(t *testing.T, db *sql.DB, q string, args ...any) {
	t.Helper()
	if _, err := db.Exec(q, args...); err != nil {
		t.Fatalf("exec %q: %v", q, err)
	}
}

func wsCount(t *testing.T, db *sql.DB, q string, args ...any) int {
	t.Helper()
	var n int
	if err := db.QueryRow(q, args...).Scan(&n); err != nil {
		t.Fatalf("count %q: %v", q, err)
	}
	return n
}

// Удаление данных точки: должно снести ВСЁ по своему dataID (без сирот) и НЕ тронуть чужой dataID.
func TestDeleteWorkspaceDataTxScoping(t *testing.T) {
	tdb, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer tdb.Close()
	tdb.SetMaxOpenConns(1)

	acctTables := []string{
		"expenses", "pending_sale_reservations", "pending_sales", "stock_batches",
		"warehouse_movements", "product_recipes", "warehouse_items", "menu_products",
		"product_categories", "product_types", "debts", "debt_customers",
		"cash_movements", "cash_shifts", "global_expenses", "employees", "cards",
	}
	for _, tb := range acctTables {
		wsExec(t, tdb, "CREATE TABLE "+tb+" (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER)")
	}
	wsExec(t, tdb, `CREATE TABLE sales(id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER)`)
	wsExec(t, tdb, `CREATE TABLE sale_items(id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER)`)
	wsExec(t, tdb, `CREATE TABLE folders(id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER)`)
	wsExec(t, tdb, `CREATE TABLE items(id INTEGER PRIMARY KEY AUTOINCREMENT, folder_id INTEGER)`)
	wsExec(t, tdb, `CREATE TABLE months(id INTEGER PRIMARY KEY AUTOINCREMENT, folder_id INTEGER)`)
	wsExec(t, tdb, `CREATE TABLE account_settings(account_id INTEGER PRIMARY KEY)`)

	const X, Y = 400005, 400006 // X удаляем, Y должен выжить

	for _, tb := range acctTables {
		wsExec(t, tdb, "INSERT INTO "+tb+"(account_id) VALUES(?),(?)", X, Y)
	}
	wsExec(t, tdb, `INSERT INTO account_settings(account_id) VALUES(?),(?)`, X, Y)
	wsExec(t, tdb, `INSERT INTO sales(id, account_id) VALUES(1, ?),(2, ?)`, X, Y)
	wsExec(t, tdb, `INSERT INTO sale_items(sale_id) VALUES(1),(2)`) // 1→X, 2→Y
	wsExec(t, tdb, `INSERT INTO folders(id, account_id) VALUES(10, ?),(20, ?)`, X, Y)
	wsExec(t, tdb, `INSERT INTO items(folder_id) VALUES(10),(20)`)
	wsExec(t, tdb, `INSERT INTO months(folder_id) VALUES(10),(20)`)

	tx, err := tdb.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if err := deleteWorkspaceDataTx(tx, X); err != nil {
		tx.Rollback()
		t.Fatalf("deleteWorkspaceDataTx: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	for _, tb := range acctTables {
		if n := wsCount(t, tdb, "SELECT COUNT(*) FROM "+tb+" WHERE account_id = ?", X); n != 0 {
			t.Errorf("%s: остались строки удаляемой точки (%d)", tb, n)
		}
		if n := wsCount(t, tdb, "SELECT COUNT(*) FROM "+tb+" WHERE account_id = ?", Y); n != 1 {
			t.Errorf("%s: задета чужая точка (осталось %d, ждали 1)", tb, n)
		}
	}
	// account_settings
	if wsCount(t, tdb, `SELECT COUNT(*) FROM account_settings WHERE account_id=?`, X) != 0 {
		t.Error("account_settings: X не удалён")
	}
	if wsCount(t, tdb, `SELECT COUNT(*) FROM account_settings WHERE account_id=?`, Y) != 1 {
		t.Error("account_settings: Y задет")
	}
	// sales + sale_items (сироты)
	if wsCount(t, tdb, `SELECT COUNT(*) FROM sales WHERE account_id=?`, X) != 0 {
		t.Error("sales X не удалены")
	}
	if wsCount(t, tdb, `SELECT COUNT(*) FROM sale_items WHERE sale_id=1`) != 0 {
		t.Error("sale_items X остались сиротами")
	}
	if wsCount(t, tdb, `SELECT COUNT(*) FROM sale_items WHERE sale_id=2`) != 1 {
		t.Error("sale_items Y задеты")
	}
	// folders + items + months (сироты)
	if wsCount(t, tdb, `SELECT COUNT(*) FROM folders WHERE account_id=?`, X) != 0 {
		t.Error("folders X не удалены")
	}
	if wsCount(t, tdb, `SELECT COUNT(*) FROM items WHERE folder_id=10`) != 0 {
		t.Error("items X остались сиротами")
	}
	if wsCount(t, tdb, `SELECT COUNT(*) FROM months WHERE folder_id=10`) != 0 {
		t.Error("months X остались сиротами")
	}
	if wsCount(t, tdb, `SELECT COUNT(*) FROM items WHERE folder_id=20`) != 1 {
		t.Error("items Y задеты")
	}
	if wsCount(t, tdb, `SELECT COUNT(*) FROM months WHERE folder_id=20`) != 1 {
		t.Error("months Y задеты")
	}
}
