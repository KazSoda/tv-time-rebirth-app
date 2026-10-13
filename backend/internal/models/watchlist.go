package models

import "time"

type WatchlistItem struct {
	ID            string    `json:"id"`
	UserID        string    `json:"-"`
	TmdbID        int64     `json:"tmdb_id"`
	MediaType     string    `json:"media_type"`
	Title         string    `json:"title"`
	PosterPath    string    `json:"poster_path"`
	TotalEpisodes int       `json:"total_episodes"`
	IsEnded       bool      `json:"is_ended"`
	UserStatus    string    `json:"user_status"` // '', 'continuing', 'up_to_date', 'stopped', 'watch_later', 'not_started_yet'
	ReleaseDate   string    `json:"release_date"` // YYYY-MM-DD, vide pour les séries
	Genres        string    `json:"genres"`        // genres séparés par virgule
	Networks      string    `json:"networks"`      // chaînes séparées par virgule
	AddedAt       time.Time `json:"added_at"`
}
