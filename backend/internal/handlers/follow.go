package handlers

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"tv-time-rebirth/backend/internal/database"
	"tv-time-rebirth/backend/internal/models"
)

type FollowHandler struct {
	db *database.DB
}

func NewFollowHandler(db *database.DB) *FollowHandler {
	return &FollowHandler{db: db}
}

// PublicUser représente un utilisateur visible par les autres.
type PublicUser struct {
	ID              string  `json:"id"`
	Username        string  `json:"username"`
	AvatarPath      *string `json:"avatar_path"`
	AvatarUpdatedAt *string `json:"avatar_updated_at"`
	FollowersCount  int     `json:"followers_count"`
	FollowingCount  int     `json:"following_count"`
	IsFollowing     bool    `json:"is_following"` // l'utilisateur courant suit-il cet utilisateur ?
}

// userIDByUsername résout un username en ID. Retourne ("", nil) si introuvable.
func (h *FollowHandler) userIDByUsername(username string) (string, error) {
	var id string
	err := h.db.QueryRow("SELECT id FROM users WHERE username = ?", username).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return id, err
}

// buildPublicUser construit un PublicUser à partir d'un ID cible et de l'utilisateur courant.
func (h *FollowHandler) buildPublicUser(targetID, currentUserID string) (PublicUser, error) {
	var u PublicUser
	var avatarUpdatedAt *string

	err := h.db.QueryRow(
		"SELECT id, username, avatar_updated_at FROM users WHERE id = ?",
		targetID,
	).Scan(&u.ID, &u.Username, &avatarUpdatedAt)
	if err != nil {
		return u, err
	}

	u.AvatarUpdatedAt = avatarUpdatedAt
	if avatarUpdatedAt != nil {
		p := fmt.Sprintf("/uploads/%s/avatar.jpg", targetID)
		u.AvatarPath = &p
	}

	h.db.QueryRow("SELECT COUNT(*) FROM follows WHERE following_id = ?", targetID).Scan(&u.FollowersCount)
	h.db.QueryRow("SELECT COUNT(*) FROM follows WHERE follower_id  = ?", targetID).Scan(&u.FollowingCount)

	if currentUserID != "" && currentUserID != targetID {
		var count int
		h.db.QueryRow(
			"SELECT COUNT(*) FROM follows WHERE follower_id = ? AND following_id = ?",
			currentUserID, targetID,
		).Scan(&count)
		u.IsFollowing = count > 0
	}

	return u, nil
}

// ─── Follow / Unfollow ────────────────────────────────────────────────────────

// Follow - POST /users/:username/follow
func (h *FollowHandler) Follow(c *gin.Context) {
	currentUserID := c.GetString("user_id")
	username := c.Param("username")

	targetID, err := h.userIDByUsername(username)
	if err != nil || targetID == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	if targetID == currentUserID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot follow yourself"})
		return
	}

	_, err = h.db.Exec(
		`INSERT INTO follows (id, follower_id, following_id, followed_at)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(follower_id, following_id) DO NOTHING`,
		uuid.NewString(), currentUserID, targetID, time.Now().UTC(),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to follow user"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "followed"})
}

// Unfollow - DELETE /users/:username/follow
func (h *FollowHandler) Unfollow(c *gin.Context) {
	currentUserID := c.GetString("user_id")
	username := c.Param("username")

	targetID, err := h.userIDByUsername(username)
	if err != nil || targetID == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	h.db.Exec(
		"DELETE FROM follows WHERE follower_id = ? AND following_id = ?",
		currentUserID, targetID,
	)

	c.JSON(http.StatusOK, gin.H{"message": "unfollowed"})
}

// ─── Listes ───────────────────────────────────────────────────────────────────

// MyFollowing - GET /me/following
func (h *FollowHandler) MyFollowing(c *gin.Context) {
	currentUserID := c.GetString("user_id")

	rows, err := h.db.Query(
		`SELECT following_id FROM follows WHERE follower_id = ? ORDER BY followed_at DESC`,
		currentUserID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch following"})
		return
	}
	defer rows.Close()

	users := []PublicUser{}
	for rows.Next() {
		var id string
		rows.Scan(&id)
		if u, err := h.buildPublicUser(id, currentUserID); err == nil {
			users = append(users, u)
		}
	}

	c.JSON(http.StatusOK, users)
}

// MyFollowers - GET /me/followers
func (h *FollowHandler) MyFollowers(c *gin.Context) {
	currentUserID := c.GetString("user_id")

	rows, err := h.db.Query(
		`SELECT follower_id FROM follows WHERE following_id = ? ORDER BY followed_at DESC`,
		currentUserID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch followers"})
		return
	}
	defer rows.Close()

	users := []PublicUser{}
	for rows.Next() {
		var id string
		rows.Scan(&id)
		if u, err := h.buildPublicUser(id, currentUserID); err == nil {
			users = append(users, u)
		}
	}

	c.JSON(http.StatusOK, users)
}

// FollowCounts - GET /me/follow-counts
func (h *FollowHandler) FollowCounts(c *gin.Context) {
	userID := c.GetString("user_id")

	var following, followers int
	h.db.QueryRow("SELECT COUNT(*) FROM follows WHERE follower_id  = ?", userID).Scan(&following)
	h.db.QueryRow("SELECT COUNT(*) FROM follows WHERE following_id = ?", userID).Scan(&followers)

	c.JSON(http.StatusOK, gin.H{"following": following, "followers": followers})
}

// SearchUsers - GET /search/users?q=
func (h *FollowHandler) SearchUsers(c *gin.Context) {
	currentUserID := c.GetString("user_id")
	q := c.Query("q")
	if len(q) < 2 {
		c.JSON(http.StatusOK, []PublicUser{})
		return
	}

	rows, err := h.db.Query(
		`SELECT id FROM users WHERE username LIKE ? AND id != ? LIMIT 20`,
		"%"+q+"%", currentUserID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "search failed"})
		return
	}
	defer rows.Close()

	users := []PublicUser{}
	for rows.Next() {
		var id string
		rows.Scan(&id)
		if u, err := h.buildPublicUser(id, currentUserID); err == nil {
			users = append(users, u)
		}
	}

	c.JSON(http.StatusOK, users)
}

// ─── Profil public d'un utilisateur ──────────────────────────────────────────

// GetPublicProfile - GET /users/:username/profile
func (h *FollowHandler) GetPublicProfile(c *gin.Context) {
	currentUserID := c.GetString("user_id")
	username := c.Param("username")

	targetID, err := h.userIDByUsername(username)
	if err != nil || targetID == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	u, err := h.buildPublicUser(targetID, currentUserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch profile"})
		return
	}

	var bannerUpdatedAt *string
	h.db.QueryRow("SELECT banner_updated_at FROM users WHERE id = ?", targetID).Scan(&bannerUpdatedAt)

	var bannerPath *string
	if bannerUpdatedAt != nil {
		p := fmt.Sprintf("/uploads/%s/banner.jpg", targetID)
		bannerPath = &p
	}

	c.JSON(http.StatusOK, gin.H{
		"id":                u.ID,
		"username":          u.Username,
		"avatar_path":       u.AvatarPath,
		"avatar_updated_at": u.AvatarUpdatedAt,
		"banner_path":       bannerPath,
		"banner_updated_at": bannerUpdatedAt,
		"followers_count":   u.FollowersCount,
		"following_count":   u.FollowingCount,
		"is_following":      u.IsFollowing,
	})
}

// GetUserWatchlist - GET /users/:username/watchlist?media_type=
func (h *FollowHandler) GetUserWatchlist(c *gin.Context) {
	username := c.Param("username")
	mediaType := c.Query("media_type")

	targetID, err := h.userIDByUsername(username)
	if err != nil || targetID == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	query := `SELECT id, user_id, tmdb_id, media_type, title, poster_path,
	                 total_episodes, is_ended, user_status, release_date, genres, networks, added_at
	          FROM watchlist WHERE user_id = ?`
	args := []any{targetID}

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
		if err := rows.Scan(
			&item.ID, &item.UserID, &item.TmdbID, &item.MediaType,
			&item.Title, &item.PosterPath, &item.TotalEpisodes, &item.IsEnded,
			&item.UserStatus, &item.ReleaseDate, &item.Genres, &item.Networks, &item.AddedAt,
		); err != nil {
			continue
		}
		items = append(items, item)
	}

	c.JSON(http.StatusOK, items)
}

// GetUserFavorites - GET /users/:username/favorites?media_type=
func (h *FollowHandler) GetUserFavorites(c *gin.Context) {
	username := c.Param("username")
	mediaType := c.Query("media_type")

	targetID, err := h.userIDByUsername(username)
	if err != nil || targetID == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	query := "SELECT tmdb_id FROM favorites WHERE user_id = ?"
	args := []any{targetID}

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
		rows.Scan(&id)
		ids = append(ids, id)
	}

	c.JSON(http.StatusOK, ids)
}

// GetUserWatchedMovies - GET /users/:username/watched/movies
func (h *FollowHandler) GetUserWatchedMovies(c *gin.Context) {
	username := c.Param("username")

	targetID, err := h.userIDByUsername(username)
	if err != nil || targetID == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	rows, err := h.db.Query(
		"SELECT tmdb_id FROM watched_movies WHERE user_id = ? ORDER BY watched_at DESC",
		targetID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch watched movies"})
		return
	}
	defer rows.Close()

	ids := []int64{}
	for rows.Next() {
		var id int64
		rows.Scan(&id)
		ids = append(ids, id)
	}

	c.JSON(http.StatusOK, ids)
}

// GetUserSeriesSummary - GET /users/:username/watched/series-summary
func (h *FollowHandler) GetUserSeriesSummary(c *gin.Context) {
	username := c.Param("username")

	targetID, err := h.userIDByUsername(username)
	if err != nil || targetID == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	rows, err := h.db.Query(`
		SELECT we.series_tmdb_id,
		       COUNT(*) AS watched_count,
		       COALESCE(w.total_episodes, 0) AS total_episodes,
		       MAX(we.watched_at) AS last_watched_at
		FROM watched_episodes we
		LEFT JOIN watchlist w ON w.user_id = we.user_id
		    AND w.tmdb_id = we.series_tmdb_id
		    AND w.media_type = 'tv'
		WHERE we.user_id = ?
		GROUP BY we.series_tmdb_id
		ORDER BY last_watched_at DESC`,
		targetID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch series summary"})
		return
	}
	defer rows.Close()

	type summary struct {
		SeriesTmdbID  int64  `json:"series_tmdb_id"`
		WatchedCount  int    `json:"watched_count"`
		TotalEpisodes int    `json:"total_episodes"`
		LastWatchedAt string `json:"last_watched_at"`
	}

	items := []summary{}
	for rows.Next() {
		var s summary
		rows.Scan(&s.SeriesTmdbID, &s.WatchedCount, &s.TotalEpisodes, &s.LastWatchedAt)
		items = append(items, s)
	}

	c.JSON(http.StatusOK, items)
}
