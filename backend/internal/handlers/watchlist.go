package handlers

import (
	"database/sql"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"tv-time-rebirth/backend/internal/database"
	"tv-time-rebirth/backend/internal/models"
)

type WatchlistHandler struct {
	db *database.DB
}

func NewWatchlistHandler(db *database.DB) *WatchlistHandler {
	return &WatchlistHandler{db: db}
}

type addRequest struct {
	TmdbID        int64  `json:"tmdb_id"      binding:"required"`
	MediaType     string `json:"media_type"   binding:"required,oneof=movie tv"`
	Title         string `json:"title"        binding:"required"`
	PosterPath    string `json:"poster_path"`
	TotalEpisodes int    `json:"total_episodes"`
	IsEnded       bool   `json:"is_ended"`
	UserStatus    string `json:"user_status"`  // '', 'continuing', 'up_to_date', 'stopped', 'watch_later', 'not_started_yet'
	ReleaseDate   string `json:"release_date"` // YYYY-MM-DD, vide pour les séries
	Genres        string `json:"genres"`       // genres séparés par virgule
	Networks      string `json:"networks"`     // chaînes séparées par virgule
}

// List retourne la watchlist de l'utilisateur, filtrée par media_type si précisé.
func (h *WatchlistHandler) List(c *gin.Context) {
	userID    := c.GetString("user_id")
	mediaType := c.Query("media_type")

	query := `SELECT id, user_id, tmdb_id, media_type, title, poster_path, total_episodes, is_ended, user_status, release_date, genres, networks, added_at
	          FROM watchlist WHERE user_id = ?`
	args := []any{userID}

	if mediaType != "" {
		query += " AND media_type = ?"
		args = append(args, mediaType)
	}
	query += " ORDER BY added_at DESC"

	rows, err := h.db.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch watchlist"})
		return
	}
	defer rows.Close()

	items := []models.WatchlistItem{}
	for rows.Next() {
		var item models.WatchlistItem
		if err := rows.Scan(&item.ID, &item.UserID, &item.TmdbID, &item.MediaType,
			&item.Title, &item.PosterPath, &item.TotalEpisodes, &item.IsEnded,
			&item.UserStatus, &item.ReleaseDate, &item.Genres, &item.Networks, &item.AddedAt); err != nil {
			continue
		}
		items = append(items, item)
	}

	c.JSON(http.StatusOK, items)
}

// Add ajoute un film/série à la watchlist.
// En cas de conflit (déjà présent), met à jour les métadonnées.
// user_status n'est mis à jour que s'il est non-vide (pour ne pas écraser un statut existant).
func (h *WatchlistHandler) Add(c *gin.Context) {
	userID := c.GetString("user_id")

	var req addRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	id := uuid.NewString()
	_, err := h.db.Exec(
		`INSERT INTO watchlist (id, user_id, tmdb_id, media_type, title, poster_path, total_episodes, is_ended, user_status, release_date, genres, networks, added_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(user_id, tmdb_id, media_type) DO UPDATE SET
		   title          = excluded.title,
		   poster_path    = CASE WHEN excluded.poster_path != '' THEN excluded.poster_path ELSE poster_path END,
		   total_episodes = CASE WHEN excluded.total_episodes > 0 THEN excluded.total_episodes ELSE total_episodes END,
		   is_ended       = excluded.is_ended,
		   user_status    = CASE WHEN excluded.user_status != '' THEN excluded.user_status ELSE user_status END,
		   release_date   = CASE WHEN excluded.release_date != '' THEN excluded.release_date ELSE release_date END,
		   genres         = CASE WHEN excluded.genres != '' THEN excluded.genres ELSE genres END,
		   networks       = CASE WHEN excluded.networks != '' THEN excluded.networks ELSE networks END`,
		id, userID, req.TmdbID, req.MediaType, req.Title, req.PosterPath,
		req.TotalEpisodes, req.IsEnded, req.UserStatus, req.ReleaseDate, req.Genres, req.Networks, time.Now().UTC(),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to add to watchlist"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": "added to watchlist"})
}

// Remove retire un film/série de la watchlist.
func (h *WatchlistHandler) Remove(c *gin.Context) {
	userID    := c.GetString("user_id")
	tmdbID    := c.Param("tmdb_id")
	mediaType := c.Param("media_type")

	result, err := h.db.Exec(
		"DELETE FROM watchlist WHERE user_id = ? AND tmdb_id = ? AND media_type = ?",
		userID, tmdbID, mediaType,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to remove from watchlist"})
		return
	}

	if n, _ := result.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "item not in watchlist"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "removed from watchlist"})
}

// Check vérifie si un item est dans la watchlist (200 = oui, 404 = non).
// Retourne aussi user_status si l'item est présent.
func (h *WatchlistHandler) Check(c *gin.Context) {
	userID    := c.GetString("user_id")
	tmdbID    := c.Param("tmdb_id")
	mediaType := c.Param("media_type")

	var (
		id         string
		userStatus string
	)
	err := h.db.QueryRow(
		"SELECT id, user_status FROM watchlist WHERE user_id = ? AND tmdb_id = ? AND media_type = ?",
		userID, tmdbID, mediaType,
	).Scan(&id, &userStatus)

	if errors.Is(err, sql.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"in_watchlist": false})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"in_watchlist": true, "user_status": userStatus})
}

// SetStatus met à jour le statut utilisateur d'un élément de la watchlist.
func (h *WatchlistHandler) SetStatus(c *gin.Context) {
	userID    := c.GetString("user_id")
	tmdbID    := c.Param("tmdb_id")
	mediaType := c.Param("media_type")

	var req struct {
		UserStatus string `json:"user_status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	result, err := h.db.Exec(
		"UPDATE watchlist SET user_status = ? WHERE user_id = ? AND tmdb_id = ? AND media_type = ?",
		req.UserStatus, userID, tmdbID, mediaType,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update status"})
		return
	}
	if n, _ := result.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "item not in watchlist"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"user_status": req.UserStatus})
}
