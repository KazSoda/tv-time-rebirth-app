package handlers

import (
	"database/sql"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"tv-time-rebirth/backend/internal/database"
)

type FavoritesHandler struct {
	db *database.DB
}

func NewFavoritesHandler(db *database.DB) *FavoritesHandler {
	return &FavoritesHandler{db: db}
}

// List retourne tous les tmdb_id des favoris de l'utilisateur, filtrés par media_type si précisé.
func (h *FavoritesHandler) List(c *gin.Context) {
	userID    := c.GetString("user_id")
	mediaType := c.Query("media_type")

	query := "SELECT tmdb_id FROM favorites WHERE user_id = ?"
	args  := []any{userID}
	if mediaType != "" {
		query += " AND media_type = ?"
		args = append(args, mediaType)
	}
	query += " ORDER BY added_at DESC"

	rows, err := h.db.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch favorites"})
		return
	}
	defer rows.Close()

	ids := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err == nil {
			ids = append(ids, id)
		}
	}
	c.JSON(http.StatusOK, ids)
}

// Check vérifie si un item est dans les favoris.
func (h *FavoritesHandler) Check(c *gin.Context) {
	userID    := c.GetString("user_id")
	tmdbID    := c.Param("tmdb_id")
	mediaType := c.Param("media_type")

	var id string
	err := h.db.QueryRow(
		"SELECT id FROM favorites WHERE user_id = ? AND tmdb_id = ? AND media_type = ?",
		userID, tmdbID, mediaType,
	).Scan(&id)

	if errors.Is(err, sql.ErrNoRows) {
		c.JSON(http.StatusOK, gin.H{"is_favorite": false})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"is_favorite": true})
}

// Add ajoute un item aux favoris.
func (h *FavoritesHandler) Add(c *gin.Context) {
	userID := c.GetString("user_id")

	var req struct {
		TmdbID    int64  `json:"tmdb_id"    binding:"required"`
		MediaType string `json:"media_type" binding:"required,oneof=movie tv"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	_, err := h.db.Exec(
		`INSERT INTO favorites (id, user_id, tmdb_id, media_type, added_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(user_id, tmdb_id, media_type) DO NOTHING`,
		uuid.NewString(), userID, req.TmdbID, req.MediaType, time.Now().UTC(),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to add to favorites"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"is_favorite": true})
}

// Remove retire un item des favoris.
func (h *FavoritesHandler) Remove(c *gin.Context) {
	userID    := c.GetString("user_id")
	tmdbID    := c.Param("tmdb_id")
	mediaType := c.Param("media_type")

	_, err := h.db.Exec(
		"DELETE FROM favorites WHERE user_id = ? AND tmdb_id = ? AND media_type = ?",
		userID, tmdbID, mediaType,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to remove from favorites"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"is_favorite": false})
}
