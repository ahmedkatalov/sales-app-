CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  employee_id INTEGER,
  card_id INTEGER,

  payment_type TEXT NOT NULL,
  card_name TEXT,

  subtotal REAL DEFAULT 0,
  discount_percent REAL DEFAULT 0,
  discount_amount REAL DEFAULT 0,
  total REAL DEFAULT 0,

  paid_amount REAL DEFAULT 0,
  change_amount REAL DEFAULT 0,

  status TEXT DEFAULT 'completed',

  seller_name TEXT,

  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  created_date TEXT,
  created_time TEXT,

  FOREIGN KEY(employee_id) REFERENCES employees(id),
  FOREIGN KEY(card_id) REFERENCES cards(id)
);