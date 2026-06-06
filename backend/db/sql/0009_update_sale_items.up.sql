ALTER TABLE sale_items ADD COLUMN product_name TEXT;
ALTER TABLE sale_items ADD COLUMN product_cost REAL DEFAULT 0;
ALTER TABLE sale_items ADD COLUMN product_price REAL DEFAULT 0;