package main

import (
	"database/sql"
	"log"
	"os"
	"path/filepath"
	"sort"
)

func runMigrations(db *sql.DB) {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS migrations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL UNIQUE,
			executed_at TEXT DEFAULT CURRENT_TIMESTAMP
		);
	`)
	if err != nil {
		log.Fatal(err)
	}

	files, err := filepath.Glob("./db/sql/*.up.sql")
	if err != nil {
		log.Fatal(err)
	}

	sort.Strings(files)

	for _, file := range files {
		name := filepath.Base(file)

		var exists int
		err := db.QueryRow(
			"SELECT COUNT(*) FROM migrations WHERE name = ?",
			name,
		).Scan(&exists)

		if err != nil {
			log.Fatal(err)
		}

		if exists > 0 {
			continue
		}

		content, err := os.ReadFile(file)
		if err != nil {
			log.Fatal(err)
		}

		_, err = db.Exec(string(content))
		if err != nil {
			log.Fatalf("migration failed %s: %v", name, err)
		}

		_, err = db.Exec(
			"INSERT INTO migrations(name) VALUES(?)",
			name,
		)
		if err != nil {
			log.Fatal(err)
		}

		log.Println("migration applied:", name)
	}
}
