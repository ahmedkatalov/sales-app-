ALTER TABLE sales ADD COLUMN status TEXT DEFAULT 'completed';
ALTER TABLE sales ADD COLUMN seller_name TEXT;
ALTER TABLE sales ADD COLUMN created_date TEXT;
ALTER TABLE sales ADD COLUMN created_time TEXT;