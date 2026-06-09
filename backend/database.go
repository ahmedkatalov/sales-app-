package main

import "log"

func createTables() {
	_, err := db.Exec(`
	CREATE TABLE IF NOT EXISTS accounts (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		created_at TEXT
	);

	CREATE TABLE IF NOT EXISTS workspaces (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		account_id INTEGER NOT NULL,
		name TEXT NOT NULL,
		is_main INTEGER DEFAULT 0,
		created_at TEXT
	);

	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		account_id INTEGER DEFAULT 1,
		owner_account_id INTEGER DEFAULT 0,
		workspace_id INTEGER DEFAULT 0,
		data_account_id INTEGER DEFAULT 0,
		username TEXT NOT NULL UNIQUE,
		password TEXT NOT NULL,
		role TEXT NOT NULL,
		created_at TEXT
	);

	CREATE TABLE IF NOT EXISTS employees (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		account_id INTEGER DEFAULT 1,
		name TEXT NOT NULL,
		created_at TEXT
	);

	CREATE TABLE IF NOT EXISTS cards (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		account_id INTEGER DEFAULT 1,
		name TEXT NOT NULL,
		owner TEXT,
		created_at TEXT
	);

	CREATE TABLE IF NOT EXISTS product_types (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		account_id INTEGER DEFAULT 1,
		name TEXT NOT NULL,
		created_at TEXT
	);

	CREATE TABLE IF NOT EXISTS product_categories (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		account_id INTEGER DEFAULT 1,
		name TEXT NOT NULL,
		type_id INTEGER DEFAULT 0,
		type TEXT DEFAULT '',
		created_at TEXT
	);

	CREATE TABLE IF NOT EXISTS menu_products (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		account_id INTEGER DEFAULT 1,
		category_id INTEGER DEFAULT 0,
		name TEXT NOT NULL,
		category TEXT,
		type TEXT DEFAULT '',
		price REAL DEFAULT 0,
		cost REAL DEFAULT 0,
		created_at TEXT
	);

	CREATE TABLE IF NOT EXISTS warehouse_items (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		account_id INTEGER DEFAULT 1,
		name TEXT NOT NULL,
		unit TEXT DEFAULT 'g',
		quantity REAL DEFAULT 0,
		price REAL DEFAULT 0,
		unit_cost REAL DEFAULT 0,
		supplier TEXT DEFAULT '',
		expiry_date TEXT DEFAULT '',
		min_quantity REAL DEFAULT 0,
		note TEXT DEFAULT '',
		hidden INTEGER DEFAULT 0,
		deleted INTEGER DEFAULT 0,
		deleted_at TEXT DEFAULT '',
		delete_reason TEXT DEFAULT '',
		delete_note TEXT DEFAULT '',
		created_at TEXT
	);

	CREATE TABLE IF NOT EXISTS stock_batches (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		account_id INTEGER DEFAULT 1,
		warehouse_item_id INTEGER DEFAULT 0,
		quantity REAL DEFAULT 0,
		remaining_quantity REAL DEFAULT 0,
		purchase_price REAL DEFAULT 0,
		unit_cost REAL DEFAULT 0,
		supplier TEXT DEFAULT '',
		expiry_date TEXT DEFAULT '',
		note TEXT DEFAULT '',
		created_at TEXT
	);

	CREATE TABLE IF NOT EXISTS warehouse_movements (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		account_id INTEGER DEFAULT 1,
		warehouse_item_id INTEGER DEFAULT 0,
		movement_type TEXT,
		quantity REAL DEFAULT 0,
		reason TEXT DEFAULT '',
		note TEXT DEFAULT '',
		hidden INTEGER DEFAULT 0,
		deleted INTEGER DEFAULT 0,
		deleted_at TEXT DEFAULT '',
		delete_reason TEXT DEFAULT '',
		delete_note TEXT DEFAULT '',
		created_at TEXT
	);

	CREATE TABLE IF NOT EXISTS product_recipes (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		account_id INTEGER DEFAULT 1,
		product_id INTEGER DEFAULT 0,
		warehouse_item_id INTEGER DEFAULT 0,
		ingredient_name TEXT DEFAULT '',
		quantity REAL DEFAULT 0,
		input_quantity REAL DEFAULT 0,
		input_unit TEXT DEFAULT '',
		conversion_note TEXT DEFAULT ''
	);

	CREATE TABLE IF NOT EXISTS sales (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		account_id INTEGER DEFAULT 1,
		employee_id INTEGER DEFAULT 0,
		payment_type TEXT,
		card_id INTEGER,
		subtotal REAL DEFAULT 0,
		discount_percent REAL DEFAULT 0,
		discount_amount REAL DEFAULT 0,
		total REAL DEFAULT 0,
		cash_given REAL DEFAULT 0,
		change_amount REAL DEFAULT 0,
		created_at TEXT
	);

	CREATE TABLE IF NOT EXISTS sale_items (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		sale_id INTEGER,
		product_id INTEGER,
		name TEXT,
		type TEXT,
		qty REAL DEFAULT 1,
		price REAL DEFAULT 0,
		cost REAL DEFAULT 0,
		total REAL DEFAULT 0
	);

	CREATE TABLE IF NOT EXISTS pending_sales (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		account_id INTEGER DEFAULT 1,
		employee_id INTEGER DEFAULT 0,
		seller_name TEXT DEFAULT '',
		subtotal REAL DEFAULT 0,
		discount_percent REAL DEFAULT 0,
		discount_amount REAL DEFAULT 0,
		total REAL DEFAULT 0,
		items_json TEXT DEFAULT '[]',
		created_at TEXT
	);

	CREATE TABLE IF NOT EXISTS pending_sale_reservations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		pending_sale_id INTEGER NOT NULL,
		account_id INTEGER DEFAULT 1,
		product_id INTEGER DEFAULT 0,
		warehouse_item_id INTEGER DEFAULT 0,
		batch_id INTEGER DEFAULT 0,
		quantity REAL DEFAULT 0,
		unit_cost REAL DEFAULT 0,
		total_cost REAL DEFAULT 0,
		created_at TEXT
	);

	CREATE TABLE IF NOT EXISTS debt_customers (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		account_id INTEGER DEFAULT 1,
		name TEXT NOT NULL,
		created_at TEXT
	);

	CREATE TABLE IF NOT EXISTS debts (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		account_id INTEGER DEFAULT 1,
		customer_id INTEGER DEFAULT 0,
		sale_id INTEGER DEFAULT 0,
		amount REAL DEFAULT 0,
		status TEXT DEFAULT 'open',
		created_at TEXT,
		paid_at TEXT DEFAULT ''
	);

	CREATE TABLE IF NOT EXISTS global_expenses (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		account_id INTEGER DEFAULT 1,
		employee_id INTEGER DEFAULT 0,
		category TEXT,
		type TEXT,
		name TEXT,
		amount REAL DEFAULT 0,
		comment TEXT,
		created_at TEXT
	);

	CREATE TABLE IF NOT EXISTS folders (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		account_id INTEGER DEFAULT 1,
		name TEXT NOT NULL,
		created_at TEXT
	);

	CREATE TABLE IF NOT EXISTS months (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		folder_id INTEGER NOT NULL,
		month TEXT NOT NULL,
		created_at TEXT,
		UNIQUE(folder_id, month)
	);

	CREATE TABLE IF NOT EXISTS items (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		folder_id INTEGER NOT NULL,
		month_id INTEGER NOT NULL,
		name TEXT,
		cost REAL DEFAULT 0,
		price REAL DEFAULT 0,
		qty REAL DEFAULT 0
	);

	CREATE TABLE IF NOT EXISTS login_otp_codes (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		code TEXT NOT NULL,
		email TEXT NOT NULL,
		expires_at TEXT NOT NULL,
		used_at TEXT,
		attempts INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS expenses (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		account_id INTEGER DEFAULT 1,
		folder_id INTEGER NOT NULL,
		month_id INTEGER NOT NULL,
		category TEXT NOT NULL,
		type TEXT,
		sub_type TEXT,
		name TEXT,
		qty REAL DEFAULT 0,
		price REAL DEFAULT 0,
		amount REAL DEFAULT 0,
		comment TEXT
	);
	`)

	if err != nil {
		log.Fatal(err)
	}

	migrations := []string{
		`ALTER TABLE users ADD COLUMN email TEXT DEFAULT ''`,
		`ALTER TABLE users ADD COLUMN account_id INTEGER DEFAULT 1`,
		`ALTER TABLE users ADD COLUMN owner_account_id INTEGER DEFAULT 0`,
		`ALTER TABLE users ADD COLUMN workspace_id INTEGER DEFAULT 0`,
		`ALTER TABLE users ADD COLUMN data_account_id INTEGER DEFAULT 0`,
		`ALTER TABLE employees ADD COLUMN account_id INTEGER DEFAULT 1`,
		`ALTER TABLE cards ADD COLUMN account_id INTEGER DEFAULT 1`,
		`ALTER TABLE menu_products ADD COLUMN account_id INTEGER DEFAULT 1`,
		`ALTER TABLE menu_products ADD COLUMN category_id INTEGER DEFAULT 0`,
		`ALTER TABLE menu_products ADD COLUMN cost REAL DEFAULT 0`,
		`ALTER TABLE product_categories ADD COLUMN account_id INTEGER DEFAULT 1`,
		`ALTER TABLE product_categories ADD COLUMN type_id INTEGER DEFAULT 0`,
		`ALTER TABLE product_categories ADD COLUMN type TEXT DEFAULT ''`,
		`ALTER TABLE sales ADD COLUMN account_id INTEGER DEFAULT 1`,
		`ALTER TABLE sales ADD COLUMN employee_id INTEGER DEFAULT 0`,
		`ALTER TABLE global_expenses ADD COLUMN account_id INTEGER DEFAULT 1`,
		`ALTER TABLE global_expenses ADD COLUMN employee_id INTEGER DEFAULT 0`,
		`ALTER TABLE folders ADD COLUMN account_id INTEGER DEFAULT 1`,
		`ALTER TABLE workspaces ADD COLUMN is_main INTEGER DEFAULT 0`,
		`ALTER TABLE warehouse_items ADD COLUMN account_id INTEGER DEFAULT 1`,
		`ALTER TABLE warehouse_items ADD COLUMN name TEXT DEFAULT ''`,
		`ALTER TABLE warehouse_items ADD COLUMN unit TEXT DEFAULT 'g'`,
		`ALTER TABLE warehouse_items ADD COLUMN quantity REAL DEFAULT 0`,
		`ALTER TABLE warehouse_items ADD COLUMN price REAL DEFAULT 0`,
		`ALTER TABLE warehouse_items ADD COLUMN unit_cost REAL DEFAULT 0`,
		`ALTER TABLE warehouse_items ADD COLUMN supplier TEXT DEFAULT ''`,
		`ALTER TABLE warehouse_items ADD COLUMN expiry_date TEXT DEFAULT ''`,
		`ALTER TABLE warehouse_items ADD COLUMN min_quantity REAL DEFAULT 0`,
		`ALTER TABLE warehouse_items ADD COLUMN note TEXT DEFAULT ''`,
		`ALTER TABLE warehouse_items ADD COLUMN hidden INTEGER DEFAULT 0`,
		`ALTER TABLE warehouse_items ADD COLUMN deleted INTEGER DEFAULT 0`,
		`ALTER TABLE warehouse_items ADD COLUMN deleted_at TEXT DEFAULT ''`,
		`ALTER TABLE warehouse_items ADD COLUMN delete_reason TEXT DEFAULT ''`,
		`ALTER TABLE warehouse_items ADD COLUMN delete_note TEXT DEFAULT ''`,
		`ALTER TABLE warehouse_items ADD COLUMN created_at TEXT DEFAULT ''`,
		`ALTER TABLE warehouse_items ADD COLUMN control_mode TEXT DEFAULT 'exact'`,
		`ALTER TABLE warehouse_items ADD COLUMN loss_percent REAL DEFAULT 0`,
		`ALTER TABLE warehouse_items ADD COLUMN inventory_method TEXT DEFAULT 'fifo'`,
		`ALTER TABLE warehouse_items ADD COLUMN packaging_quantity REAL DEFAULT 1`,
		`ALTER TABLE product_recipes ADD COLUMN input_quantity REAL DEFAULT 0`,
		`ALTER TABLE product_recipes ADD COLUMN input_unit TEXT DEFAULT ''`,
		`ALTER TABLE product_recipes ADD COLUMN conversion_note TEXT DEFAULT ''`,
		`ALTER TABLE warehouse_movements ADD COLUMN account_id INTEGER DEFAULT 1`,
		`ALTER TABLE warehouse_movements ADD COLUMN warehouse_item_id INTEGER DEFAULT 0`,
		`ALTER TABLE warehouse_movements ADD COLUMN movement_type TEXT DEFAULT ''`,
		`ALTER TABLE warehouse_movements ADD COLUMN quantity REAL DEFAULT 0`,
		`ALTER TABLE warehouse_movements ADD COLUMN reason TEXT DEFAULT ''`,
		`ALTER TABLE warehouse_movements ADD COLUMN note TEXT DEFAULT ''`,
		`ALTER TABLE warehouse_movements ADD COLUMN created_at TEXT DEFAULT ''`,
		`ALTER TABLE product_recipes ADD COLUMN account_id INTEGER DEFAULT 1`,
		`ALTER TABLE product_recipes ADD COLUMN product_id INTEGER DEFAULT 0`,
		`ALTER TABLE product_recipes ADD COLUMN warehouse_item_id INTEGER DEFAULT 0`,
		`ALTER TABLE product_recipes ADD COLUMN quantity REAL DEFAULT 0`,
		`ALTER TABLE stock_batches ADD COLUMN account_id INTEGER DEFAULT 1`,
		`ALTER TABLE stock_batches ADD COLUMN warehouse_item_id INTEGER DEFAULT 0`,
		`ALTER TABLE stock_batches ADD COLUMN quantity REAL DEFAULT 0`,
		`ALTER TABLE stock_batches ADD COLUMN remaining_quantity REAL DEFAULT 0`,
		`ALTER TABLE stock_batches ADD COLUMN purchase_price REAL DEFAULT 0`,
		`ALTER TABLE stock_batches ADD COLUMN unit_cost REAL DEFAULT 0`,
		`ALTER TABLE stock_batches ADD COLUMN supplier TEXT DEFAULT ''`,
		`ALTER TABLE stock_batches ADD COLUMN expiry_date TEXT DEFAULT ''`,
		`ALTER TABLE stock_batches ADD COLUMN note TEXT DEFAULT ''`,
		`ALTER TABLE stock_batches ADD COLUMN created_at TEXT DEFAULT ''`,
		`ALTER TABLE sale_items ADD COLUMN cost REAL DEFAULT 0`,
		`ALTER TABLE expenses ADD COLUMN account_id INTEGER DEFAULT 1`,
		`ALTER TABLE pending_sale_reservations ADD COLUMN pending_sale_id INTEGER DEFAULT 0`,
		`ALTER TABLE pending_sale_reservations ADD COLUMN account_id INTEGER DEFAULT 1`,
		`ALTER TABLE pending_sale_reservations ADD COLUMN product_id INTEGER DEFAULT 0`,
		`ALTER TABLE pending_sale_reservations ADD COLUMN warehouse_item_id INTEGER DEFAULT 0`,
		`ALTER TABLE pending_sale_reservations ADD COLUMN batch_id INTEGER DEFAULT 0`,
		`ALTER TABLE pending_sale_reservations ADD COLUMN quantity REAL DEFAULT 0`,
		`ALTER TABLE pending_sale_reservations ADD COLUMN unit_cost REAL DEFAULT 0`,
		`ALTER TABLE pending_sale_reservations ADD COLUMN total_cost REAL DEFAULT 0`,
		`ALTER TABLE pending_sale_reservations ADD COLUMN created_at TEXT DEFAULT ''`,
	}

	for _, q := range migrations {
		db.Exec(q)
	}

	db.Exec(`UPDATE expenses SET account_id = IFNULL((SELECT account_id FROM folders WHERE folders.id = expenses.folder_id), account_id)`)

	// Если склад был создан старым способом без партий — создаём стартовые партии.
	db.Exec(`
		INSERT INTO stock_batches(account_id, warehouse_item_id, quantity, remaining_quantity, purchase_price, unit_cost, supplier, expiry_date, note, created_at)
		SELECT account_id, id, quantity, quantity, price, unit_cost, supplier, expiry_date, note, created_at
		FROM warehouse_items wi
		WHERE quantity > 0
		  AND NOT EXISTS (
			SELECT 1 FROM stock_batches sb
			WHERE sb.account_id = wi.account_id AND sb.warehouse_item_id = wi.id
		  )
	`)

	// Совместимость со старой версией склада, где были min_qty / stock_batches.
	db.Exec(`UPDATE warehouse_items SET min_quantity = min_qty WHERE min_quantity = 0 AND min_qty IS NOT NULL`)
	db.Exec(`UPDATE warehouse_items SET quantity = (SELECT IFNULL(SUM(qty_remaining), 0) FROM stock_batches WHERE stock_batches.item_id = warehouse_items.id AND stock_batches.account_id = warehouse_items.account_id) WHERE quantity = 0`)
	db.Exec(`UPDATE warehouse_items SET unit_cost = (SELECT CASE WHEN IFNULL(SUM(qty_remaining), 0) > 0 THEN IFNULL(SUM(qty_remaining * unit_cost), 0) / SUM(qty_remaining) ELSE unit_cost END FROM stock_batches WHERE stock_batches.item_id = warehouse_items.id AND stock_batches.account_id = warehouse_items.account_id) WHERE unit_cost = 0`)
	db.Exec(`UPDATE warehouse_items SET price = quantity * unit_cost WHERE price = 0 AND quantity > 0 AND unit_cost > 0`)
	db.Exec(`UPDATE product_recipes SET warehouse_item_id = item_id WHERE warehouse_item_id = 0 AND item_id IS NOT NULL`)
	db.Exec(`UPDATE product_recipes SET input_quantity = quantity WHERE IFNULL(input_quantity, 0) = 0`)
	db.Exec(`UPDATE product_recipes SET input_unit = (SELECT unit FROM warehouse_items WHERE warehouse_items.id = product_recipes.warehouse_item_id AND warehouse_items.account_id = product_recipes.account_id) WHERE IFNULL(input_unit, '') = ''`)
	db.Exec(`UPDATE product_recipes SET quantity = qty WHERE quantity = 0 AND qty IS NOT NULL`)

	db.Exec(`UPDATE users SET role = 'worker' WHERE role = 'workspace'`)

	// Автозаполнение email из username (если username выглядит как email)
	db.Exec(`UPDATE users SET email = username WHERE (email IS NULL OR email = '') AND username LIKE '%@%'`)
}
