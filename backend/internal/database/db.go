package database

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

type DB struct {
	*sql.DB
}

func New(dbPath string) (*DB, error) {
	// Ensure the directory exists
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create database directory: %w", err)
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	// Enable WAL mode for better concurrent performance
	if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		return nil, fmt.Errorf("failed to enable WAL mode: %w", err)
	}

	wrapped := &DB{db}
	if err := wrapped.migrate(); err != nil {
		return nil, fmt.Errorf("failed to run migrations: %w", err)
	}

	return wrapped, nil
}

func (db *DB) migrate() error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id            TEXT PRIMARY KEY,
			username      TEXT NOT NULL UNIQUE,
			email         TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
	`)
	if err != nil {
		return fmt.Errorf("failed to create users table: %w", err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS watched_movies (
			id         TEXT PRIMARY KEY,
			user_id    TEXT NOT NULL,
			tmdb_id    INTEGER NOT NULL,
			watched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			UNIQUE(user_id, tmdb_id)
		);
	`)
	if err != nil {
		return fmt.Errorf("failed to create watched_movies table: %w", err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS watched_episodes (
			id             TEXT PRIMARY KEY,
			user_id        TEXT NOT NULL,
			series_tmdb_id INTEGER NOT NULL,
			season_number  INTEGER NOT NULL,
			episode_number INTEGER NOT NULL,
			watched_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			UNIQUE(user_id, series_tmdb_id, season_number, episode_number)
		);
	`)
	if err != nil {
		return fmt.Errorf("failed to create watched_episodes table: %w", err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS watchlist (
			id             TEXT PRIMARY KEY,
			user_id        TEXT NOT NULL,
			tmdb_id        INTEGER NOT NULL,
			media_type     TEXT NOT NULL CHECK(media_type IN ('movie', 'tv')),
			title          TEXT NOT NULL,
			poster_path    TEXT NOT NULL DEFAULT '',
			total_episodes INTEGER NOT NULL DEFAULT 0,
			is_ended       INTEGER NOT NULL DEFAULT 0,
			added_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			UNIQUE(user_id, tmdb_id, media_type)
		);
	`)
	if err != nil {
		return fmt.Errorf("failed to create watchlist table: %w", err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS favorites (
			id         TEXT PRIMARY KEY,
			user_id    TEXT NOT NULL,
			tmdb_id    INTEGER NOT NULL,
			media_type TEXT NOT NULL CHECK(media_type IN ('movie', 'tv')),
			added_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			UNIQUE(user_id, tmdb_id, media_type)
		);
	`)
	if err != nil {
		return fmt.Errorf("failed to create favorites table: %w", err)
	}

	// Migrations incrémentales (ignorées si la colonne existe déjà)
	db.Exec(`ALTER TABLE watchlist ADD COLUMN total_episodes INTEGER NOT NULL DEFAULT 0`)
	db.Exec(`ALTER TABLE watchlist ADD COLUMN is_ended INTEGER NOT NULL DEFAULT 0`)
	db.Exec(`ALTER TABLE watchlist ADD COLUMN user_status TEXT NOT NULL DEFAULT ''`)
	db.Exec(`ALTER TABLE watchlist ADD COLUMN release_date TEXT NOT NULL DEFAULT ''`)
	db.Exec(`ALTER TABLE watched_episodes ADD COLUMN rewatch_count INTEGER NOT NULL DEFAULT 0`)
	db.Exec(`ALTER TABLE watched_episodes ADD COLUMN runtime_minutes INTEGER NOT NULL DEFAULT 0`)
	db.Exec(`ALTER TABLE watched_movies ADD COLUMN rewatch_count INTEGER NOT NULL DEFAULT 0`)
	// NULL = pas encore calculé → déclenche le calcul au premier accès à la page stats
	db.Exec(`ALTER TABLE users ADD COLUMN total_minutes_watched INTEGER`)
	db.Exec(`ALTER TABLE users ADD COLUMN total_movie_minutes_watched INTEGER`)
	db.Exec(`ALTER TABLE users ADD COLUMN avatar_updated_at DATETIME`)
	db.Exec(`ALTER TABLE users ADD COLUMN banner_updated_at DATETIME`)
	db.Exec(`ALTER TABLE watchlist ADD COLUMN genres TEXT NOT NULL DEFAULT ''`)
	db.Exec(`ALTER TABLE watchlist ADD COLUMN networks TEXT NOT NULL DEFAULT ''`)
	db.Exec(`ALTER TABLE watched_movies ADD COLUMN runtime_minutes INTEGER NOT NULL DEFAULT 0`)
	db.Exec(`ALTER TABLE watched_movies ADD COLUMN release_year INTEGER NOT NULL DEFAULT 0`)

	// Table de suivi des migrations one-shot (données, pas schéma)
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS data_migrations (
			name         TEXT NOT NULL PRIMARY KEY,
			completed_at DATETIME NOT NULL
		)
	`)
	if err != nil {
		return fmt.Errorf("failed to create data_migrations table: %w", err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS follows (
			id           TEXT PRIMARY KEY,
			follower_id  TEXT NOT NULL,
			following_id TEXT NOT NULL,
			followed_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (follower_id)  REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE,
			UNIQUE(follower_id, following_id)
		)
	`)
	if err != nil {
		return fmt.Errorf("failed to create follows table: %w", err)
	}

	return nil
}
