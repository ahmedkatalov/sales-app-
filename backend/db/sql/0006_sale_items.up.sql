CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  sale_id INTEGER,
  product_id INTEGER,

  product_name TEXT,
  product_cost REAL DEFAULT 0,
  product_price REAL DEFAULT 0,

  qty REAL DEFAULT 1,
  price REAL DEFAULT 0,
  total REAL DEFAULT 0,

  FOREIGN KEY(sale_id) REFERENCES sales(id),
  FOREIGN KEY(product_id) REFERENCES products(id)
);