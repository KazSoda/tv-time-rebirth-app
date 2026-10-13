package handlers

import (
	"database/sql"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"tv-time-rebirth/backend/internal/database"
)

type WatchedHandler struct {
	db *database.DB
}

func NewWatchedHandler(db *database.DB) *WatchedHandler {
	return &WatchedHandler{db: db}
}

// ── Films ─────────────────────────────────────────────────────────────────────

// CheckMovie vérifie si le film est marqué comme vu (200 = oui, 404 = non).
func (h *WatchedHandler) CheckMovie(c *gin.Context) {
	userID := c.GetString("user_id")
	tmdbID := c.Param("tmdb_id")

	var rewatchCount int
	err := h.db.QueryRow(
		"SELECT rewatch_count FROM watched_movies WHERE user_id = ? AND tmdb_id = ?",
		userID, tmdbID,
	).Scan(&rewatchCount)

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"watched": false, "rewatch_count": 0})
		return
	}
	c.JSON(http.StatusOK, gin.H{"watched": true, "rewatch_count": rewatchCount})
}

// MarkMovie marque un film comme vu.
func (h *WatchedHandler) MarkMovie(c *gin.Context) {
	userID := c.GetString("user_id")
	var req struct {
		TmdbID int64 `json:"tmdb_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	_, err := h.db.Exec(
		`INSERT INTO watched_movies (id, user_id, tmdb_id, watched_at, rewatch_count)
		 VALUES (?, ?, ?, ?, 0)
		 ON CONFLICT(user_id, tmdb_id) DO NOTHING`,
		uuid.NewString(), userID, req.TmdbID, time.Now().UTC(),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to mark as watched"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"watched": true})
}

// RewatchMovie incrémente le compteur de revisionnage d'un film.
func (h *WatchedHandler) RewatchMovie(c *gin.Context) {
	userID := c.GetString("user_id")
	var req struct {
		TmdbID int64 `json:"tmdb_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	result, err := h.db.Exec(
		`UPDATE watched_movies SET rewatch_count = rewatch_count + 1, watched_at = ?
		 WHERE user_id = ? AND tmdb_id = ?`,
		time.Now().UTC(), userID, req.TmdbID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update rewatch count"})
		return
	}
	if n, _ := result.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "movie not marked as watched"})
		return
	}

	var rewatchCount int
	h.db.QueryRow(
		"SELECT rewatch_count FROM watched_movies WHERE user_id = ? AND tmdb_id = ?",
		userID, req.TmdbID,
	).Scan(&rewatchCount)
	c.JSON(http.StatusOK, gin.H{"rewatch_count": rewatchCount})
}

// UnmarkMovie retire le film de la liste des vus.
func (h *WatchedHandler) UnmarkMovie(c *gin.Context) {
	userID := c.GetString("user_id")
	tmdbID := c.Param("tmdb_id")

	_, err := h.db.Exec(
		"DELETE FROM watched_movies WHERE user_id = ? AND tmdb_id = ?",
		userID, tmdbID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to unmark"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"watched": false})
}

// GetWatchedMovies retourne tous les tmdb_id des films vus par l'utilisateur.
func (h *WatchedHandler) GetWatchedMovies(c *gin.Context) {
	userID := c.GetString("user_id")

	rows, err := h.db.Query(
		"SELECT tmdb_id FROM watched_movies WHERE user_id = ? ORDER BY watched_at DESC",
		userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch watched movies"})
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

// ── Épisodes ──────────────────────────────────────────────────────────────────

// WatchedEpisodeInfo résume l'état de visionnage d'un épisode.
type WatchedEpisodeInfo struct {
	EpisodeNumber int `json:"episode_number"`
	RewatchCount  int `json:"rewatch_count"`
}

// GetWatchedEpisodes retourne les épisodes vus (numéro + rewatch_count) pour une saison donnée.
func (h *WatchedHandler) GetWatchedEpisodes(c *gin.Context) {
	userID := c.GetString("user_id")
	seriesID := c.Param("series_id")
	seasonNumber := c.Param("season_number")

	rows, err := h.db.Query(
		`SELECT episode_number, rewatch_count FROM watched_episodes
		 WHERE user_id = ? AND series_tmdb_id = ? AND season_number = ?
		 ORDER BY episode_number`,
		userID, seriesID, seasonNumber,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch watched episodes"})
		return
	}
	defer rows.Close()

	infos := []WatchedEpisodeInfo{}
	for rows.Next() {
		var epNum, rewatchCount int
		if err := rows.Scan(&epNum, &rewatchCount); err == nil {
			infos = append(infos, WatchedEpisodeInfo{EpisodeNumber: epNum, RewatchCount: rewatchCount})
		}
	}
	c.JSON(http.StatusOK, infos)
}

// MarkEpisode marque un épisode comme vu.
func (h *WatchedHandler) MarkEpisode(c *gin.Context) {
	userID := c.GetString("user_id")
	var req struct {
		SeriesTmdbID   int64 `json:"series_tmdb_id"   binding:"required"`
		SeasonNumber   int   `json:"season_number"    binding:"required"`
		EpisodeNumber  int   `json:"episode_number"   binding:"required"`
		RuntimeMinutes int   `json:"runtime_minutes"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	res, err := h.db.Exec(
		`INSERT INTO watched_episodes (id, user_id, series_tmdb_id, season_number, episode_number, watched_at, rewatch_count, runtime_minutes)
		 VALUES (?, ?, ?, ?, ?, ?, 0, ?)
		 ON CONFLICT(user_id, series_tmdb_id, season_number, episode_number) DO NOTHING`,
		uuid.NewString(), userID, req.SeriesTmdbID, req.SeasonNumber, req.EpisodeNumber, time.Now().UTC(), req.RuntimeMinutes,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to mark episode"})
		return
	}
	if n, _ := res.RowsAffected(); n > 0 {
		if req.RuntimeMinutes > 0 {
			h.db.Exec(
				`UPDATE users SET total_minutes_watched = total_minutes_watched + ?
				 WHERE id = ? AND total_minutes_watched IS NOT NULL`,
				req.RuntimeMinutes, userID,
			)
		}
		// Remettre le statut à '' si la série était "pas commencée" ou "arrêtée"
		h.db.Exec(
			`UPDATE watchlist SET user_status = ''
			 WHERE user_id = ? AND tmdb_id = ? AND media_type = 'tv'
			   AND user_status IN ('not_started_yet', 'stopped')`,
			userID, req.SeriesTmdbID,
		)
	}
	c.JSON(http.StatusCreated, gin.H{"watched": true})
}

// RewatchEpisode incrémente le compteur de revisionnage d'un épisode.
func (h *WatchedHandler) RewatchEpisode(c *gin.Context) {
	userID := c.GetString("user_id")
	var req struct {
		SeriesTmdbID  int64 `json:"series_tmdb_id"  binding:"required"`
		SeasonNumber  int   `json:"season_number"   binding:"required"`
		EpisodeNumber int   `json:"episode_number"  binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	result, err := h.db.Exec(
		`UPDATE watched_episodes SET rewatch_count = rewatch_count + 1, watched_at = ?
		 WHERE user_id = ? AND series_tmdb_id = ? AND season_number = ? AND episode_number = ?`,
		time.Now().UTC(), userID, req.SeriesTmdbID, req.SeasonNumber, req.EpisodeNumber,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update rewatch count"})
		return
	}
	if n, _ := result.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "episode not marked as watched"})
		return
	}

	var rewatchCount, runtimeMinutes int
	h.db.QueryRow(
		`SELECT rewatch_count, runtime_minutes FROM watched_episodes
		 WHERE user_id = ? AND series_tmdb_id = ? AND season_number = ? AND episode_number = ?`,
		userID, req.SeriesTmdbID, req.SeasonNumber, req.EpisodeNumber,
	).Scan(&rewatchCount, &runtimeMinutes)

	if runtimeMinutes > 0 {
		h.db.Exec(
			`UPDATE users SET total_minutes_watched = total_minutes_watched + ?
			 WHERE id = ? AND total_minutes_watched IS NOT NULL`,
			runtimeMinutes, userID,
		)
	}
	c.JSON(http.StatusOK, gin.H{"rewatch_count": rewatchCount})
}

// UnmarkEpisode retire un épisode de la liste des vus.
func (h *WatchedHandler) UnmarkEpisode(c *gin.Context) {
	userID := c.GetString("user_id")
	seriesID := c.Param("series_id")
	seasonNumber := c.Param("season_number")
	episodeNumber := c.Param("episode_number")

	// Récupérer les minutes (visionnages inclus) avant suppression
	var episodeMinutes int
	h.db.QueryRow(
		`SELECT runtime_minutes * (1 + rewatch_count) FROM watched_episodes
		 WHERE user_id = ? AND series_tmdb_id = ? AND season_number = ? AND episode_number = ?`,
		userID, seriesID, seasonNumber, episodeNumber,
	).Scan(&episodeMinutes)

	_, err := h.db.Exec(
		`DELETE FROM watched_episodes
		 WHERE user_id = ? AND series_tmdb_id = ? AND season_number = ? AND episode_number = ?`,
		userID, seriesID, seasonNumber, episodeNumber,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to unmark episode"})
		return
	}
	if episodeMinutes > 0 {
		h.db.Exec(
			`UPDATE users SET total_minutes_watched = MAX(0, total_minutes_watched - ?)
			 WHERE id = ? AND total_minutes_watched IS NOT NULL`,
			episodeMinutes, userID,
		)
	}
	c.JSON(http.StatusOK, gin.H{"watched": false})
}

// MarkSeason marque une liste d'épisodes comme vus (batch).
func (h *WatchedHandler) MarkSeason(c *gin.Context) {
	userID := c.GetString("user_id")
	var req struct {
		SeriesTmdbID   int64 `json:"series_tmdb_id"   binding:"required"`
		SeasonNumber   int   `json:"season_number"    binding:"required"`
		EpisodeNumbers []int `json:"episode_numbers"  binding:"required"`
		RuntimeMinutes int   `json:"runtime_minutes"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	now := time.Now().UTC()
	inserted := 0
	for _, epNum := range req.EpisodeNumbers {
		res, _ := h.db.Exec(
			`INSERT INTO watched_episodes (id, user_id, series_tmdb_id, season_number, episode_number, watched_at, rewatch_count, runtime_minutes)
			 VALUES (?, ?, ?, ?, ?, ?, 0, ?)
			 ON CONFLICT(user_id, series_tmdb_id, season_number, episode_number) DO NOTHING`,
			uuid.NewString(), userID, req.SeriesTmdbID, req.SeasonNumber, epNum, now, req.RuntimeMinutes,
		)
		if n, _ := res.RowsAffected(); n > 0 {
			inserted++
		}
	}
	if inserted > 0 {
		if req.RuntimeMinutes > 0 {
			h.db.Exec(
				`UPDATE users SET total_minutes_watched = total_minutes_watched + ?
				 WHERE id = ? AND total_minutes_watched IS NOT NULL`,
				inserted*req.RuntimeMinutes, userID,
			)
		}
		// Remettre le statut à '' si la série était "pas commencée" ou "arrêtée"
		h.db.Exec(
			`UPDATE watchlist SET user_status = ''
			 WHERE user_id = ? AND tmdb_id = ? AND media_type = 'tv'
			   AND user_status IN ('not_started_yet', 'stopped')`,
			userID, req.SeriesTmdbID,
		)
	}
	c.JSON(http.StatusCreated, gin.H{"marked": len(req.EpisodeNumbers)})
}

// UnmarkSeason retire une liste d'épisodes des vus (batch).
func (h *WatchedHandler) UnmarkSeason(c *gin.Context) {
	userID := c.GetString("user_id")
	var req struct {
		SeriesTmdbID   int64 `json:"series_tmdb_id"   binding:"required"`
		SeasonNumber   int   `json:"season_number"    binding:"required"`
		EpisodeNumbers []int `json:"episode_numbers"  binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Sommer les minutes à soustraire avant suppression
	minutesToSubtract := 0
	for _, epNum := range req.EpisodeNumbers {
		var epMinutes int
		h.db.QueryRow(
			`SELECT runtime_minutes * (1 + rewatch_count) FROM watched_episodes
			 WHERE user_id = ? AND series_tmdb_id = ? AND season_number = ? AND episode_number = ?`,
			userID, req.SeriesTmdbID, req.SeasonNumber, epNum,
		).Scan(&epMinutes)
		minutesToSubtract += epMinutes
	}

	for _, epNum := range req.EpisodeNumbers {
		h.db.Exec(
			`DELETE FROM watched_episodes
			 WHERE user_id = ? AND series_tmdb_id = ? AND season_number = ? AND episode_number = ?`,
			userID, req.SeriesTmdbID, req.SeasonNumber, epNum,
		)
	}
	if minutesToSubtract > 0 {
		h.db.Exec(
			`UPDATE users SET total_minutes_watched = MAX(0, total_minutes_watched - ?)
			 WHERE id = ? AND total_minutes_watched IS NOT NULL`,
			minutesToSubtract, userID,
		)
	}
	c.JSON(http.StatusOK, gin.H{"unmarked": len(req.EpisodeNumbers)})
}

// SeriesWatchedSummary retourne, pour chaque série dont l'utilisateur a vu au moins un épisode,
// le nombre d'épisodes vus, la date du dernier épisode vu, et le total d'épisodes de la série.
type SeriesWatchedSummary struct {
	SeriesTmdbID       int64  `json:"series_tmdb_id"`
	WatchedCount       int    `json:"watched_count"`
	TotalEpisodes      int    `json:"total_episodes"`
	LastWatchedAt      string `json:"last_watched_at"`
	LastWatchedSeason  int    `json:"last_watched_season"`
	LastWatchedEpisode int    `json:"last_watched_episode"`
}

// normaliseWatchedAt convertit n'importe quel format datetime stocké par le driver SQLite
// en RFC3339, lisible par JS new Date() sans ambiguïté.
func normaliseWatchedAt(raw string) string {
	if raw == "" {
		return ""
	}
	layouts := []string{
		time.RFC3339Nano,                          // "2006-01-02T15:04:05.999999999Z07:00"
		time.RFC3339,                              // "2006-01-02T15:04:05Z07:00"
		"2006-01-02T15:04:05",                     // ISO sans timezone
		"2006-01-02 15:04:05.999999999 +0000 UTC", // format Go time.String()
		"2006-01-02 15:04:05 +0000 UTC",
		"2006-01-02 15:04:05",                     // format SQLite de base
	}
	for _, layout := range layouts {
		if t, err := time.Parse(layout, raw); err == nil {
			return t.UTC().Format(time.RFC3339)
		}
	}
	return raw // fallback brut, JS tentera de le parser
}

// ImportMovieItem représente un film avec sa date de visionnage (pour l'import TV Time).
type ImportMovieItem struct {
	TmdbID       int64  `json:"tmdb_id"       binding:"required"`
	WatchedAt    string `json:"watched_at"`    // format flexible
	RewatchCount int    `json:"rewatch_count"` // nombre de revisionnages
}

// ImportMovies insère en batch des films avec leurs dates réelles de visionnage.
// En cas de conflit, la date watched_at est mise à jour.
func (h *WatchedHandler) ImportMovies(c *gin.Context) {
	userID := c.GetString("user_id")
	var req struct {
		Movies []ImportMovieItem `json:"movies" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	fallback := time.Now().UTC()
	marked := 0

	for _, m := range req.Movies {
		watchedAt := fallback
		if norm := normaliseWatchedAt(m.WatchedAt); norm != "" {
			if t, err := time.Parse(time.RFC3339, norm); err == nil {
				watchedAt = t
			}
		}
		_, err := h.db.Exec(
			`INSERT INTO watched_movies (id, user_id, tmdb_id, watched_at, rewatch_count)
			 VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT(user_id, tmdb_id) DO UPDATE SET watched_at = excluded.watched_at, rewatch_count = excluded.rewatch_count`,
			uuid.NewString(), userID, m.TmdbID, watchedAt, m.RewatchCount,
		)
		if err == nil {
			marked++
		}
	}
	c.JSON(http.StatusCreated, gin.H{"marked": marked})
}

// ImportEpisodeItem représente un épisode avec sa date de visionnage (pour l'import TV Time).
type ImportEpisodeItem struct {
	SeasonNumber   int    `json:"season_number"`
	EpisodeNumber  int    `json:"episode_number"`
	WatchedAt      string `json:"watched_at"`      // format flexible (TV Time: "2006-01-02 15:04:05")
	RewatchCount   int    `json:"rewatch_count"`   // nombre de revisionnages
	RuntimeMinutes int    `json:"runtime_minutes"` // durée de l'épisode en minutes
}

// ImportEpisodes insère en batch des épisodes avec leurs dates réelles de visionnage.
// En cas de conflit, la date watched_at est mise à jour (meilleure précision à chaque ré-import).
func (h *WatchedHandler) ImportEpisodes(c *gin.Context) {
	userID := c.GetString("user_id")
	var req struct {
		SeriesTmdbID int64               `json:"series_tmdb_id" binding:"required"`
		Episodes     []ImportEpisodeItem `json:"episodes"       binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	fallback := time.Now().UTC()
	marked := 0
	totalRuntimeAdded := 0

	for _, ep := range req.Episodes {
		watchedAt := fallback
		if norm := normaliseWatchedAt(ep.WatchedAt); norm != "" {
			if t, err := time.Parse(time.RFC3339, norm); err == nil {
				watchedAt = t
			}
		}

		_, err := h.db.Exec(
			`INSERT INTO watched_episodes (id, user_id, series_tmdb_id, season_number, episode_number, watched_at, rewatch_count, runtime_minutes)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(user_id, series_tmdb_id, season_number, episode_number) DO UPDATE SET
			   watched_at      = excluded.watched_at,
			   rewatch_count   = excluded.rewatch_count,
			   runtime_minutes = CASE WHEN excluded.runtime_minutes > 0 THEN excluded.runtime_minutes ELSE runtime_minutes END`,
			uuid.NewString(), userID, req.SeriesTmdbID, ep.SeasonNumber, ep.EpisodeNumber, watchedAt, ep.RewatchCount, ep.RuntimeMinutes,
		)
		if err == nil {
			marked++
			totalRuntimeAdded += ep.RuntimeMinutes * (1 + ep.RewatchCount)
		}
	}

	// Ajouter les minutes importées au compteur (COALESCE initialise à 0 si pas encore calculé)
	if totalRuntimeAdded > 0 {
		h.db.Exec(
			`UPDATE users SET total_minutes_watched = COALESCE(total_minutes_watched, 0) + ? WHERE id = ?`,
			totalRuntimeAdded, userID,
		)
	}

	c.JSON(http.StatusCreated, gin.H{"marked": marked})
}

// SetSeriesStats stocke directement le total calculé côté client (via TMDB).
func (h *WatchedHandler) SetSeriesStats(c *gin.Context) {
	userID := c.GetString("user_id")
	var req struct {
		TotalMinutes int64 `json:"total_minutes"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	h.db.Exec(`UPDATE users SET total_minutes_watched = ? WHERE id = ?`, req.TotalMinutes, userID)
	c.JSON(http.StatusOK, gin.H{"total_minutes": req.TotalMinutes})
}

// GetSeriesStats retourne le total de minutes regardées (toutes séries confondues)
// et le nombre total d'épisodes vus.
// Si la valeur n'a jamais été calculée (NULL), elle est calculée depuis la DB et stockée.
func (h *WatchedHandler) GetSeriesStats(c *gin.Context) {
	userID := c.GetString("user_id")

	var episodeCount, seriesCount int64
	h.db.QueryRow(`SELECT COUNT(*) FROM watched_episodes WHERE user_id = ?`, userID).Scan(&episodeCount)
	h.db.QueryRow(`SELECT COUNT(*) FROM watchlist WHERE user_id = ? AND media_type = 'tv'`, userID).Scan(&seriesCount)

	var stored sql.NullInt64
	h.db.QueryRow(`SELECT total_minutes_watched FROM users WHERE id = ?`, userID).Scan(&stored)

	if stored.Valid {
		c.JSON(http.StatusOK, gin.H{"total_minutes": stored.Int64, "episode_count": episodeCount, "series_count": seriesCount})
		return
	}

	// Première visite : calculer depuis la DB et persister
	var calculated int64
	h.db.QueryRow(
		`SELECT COALESCE(SUM(runtime_minutes * (1 + rewatch_count)), 0)
		 FROM watched_episodes WHERE user_id = ?`,
		userID,
	).Scan(&calculated)

	h.db.Exec(`UPDATE users SET total_minutes_watched = ? WHERE id = ?`, calculated, userID)
	c.JSON(http.StatusOK, gin.H{"total_minutes": calculated, "episode_count": episodeCount, "series_count": seriesCount})
}

// MovieWatchedSummary résume l'état de visionnage d'un film (pour le calcul côté client).
type MovieWatchedSummary struct {
	TmdbID       int64 `json:"tmdb_id"`
	RewatchCount int   `json:"rewatch_count"`
}

// GetMoviesSummary retourne la liste des films vus avec leur rewatch_count.
func (h *WatchedHandler) GetMoviesSummary(c *gin.Context) {
	userID := c.GetString("user_id")
	rows, err := h.db.Query(
		`SELECT tmdb_id, rewatch_count FROM watched_movies WHERE user_id = ? ORDER BY watched_at DESC`,
		userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch movies summary"})
		return
	}
	defer rows.Close()

	result := []MovieWatchedSummary{}
	for rows.Next() {
		var s MovieWatchedSummary
		if err := rows.Scan(&s.TmdbID, &s.RewatchCount); err == nil {
			result = append(result, s)
		}
	}
	c.JSON(http.StatusOK, result)
}

// GetMovieStats retourne le total de minutes de films regardés et le nombre de films vus.
// Si la valeur n'a jamais été calculée (NULL), retourne 0 et initialise le compteur.
// Les décennies sont calculées côté client lors du recalcul (données TMDB).
func (h *WatchedHandler) GetMovieStats(c *gin.Context) {
	userID := c.GetString("user_id")

	var movieCount int64
	h.db.QueryRow(`SELECT COUNT(*) FROM watched_movies WHERE user_id = ?`, userID).Scan(&movieCount)

	var stored sql.NullInt64
	h.db.QueryRow(`SELECT total_movie_minutes_watched FROM users WHERE id = ?`, userID).Scan(&stored)

	if stored.Valid {
		c.JSON(http.StatusOK, gin.H{"total_minutes": stored.Int64, "movie_count": movieCount})
		return
	}

	// Première visite : initialiser à 0 (pas de runtime stocké pour les films)
	h.db.Exec(`UPDATE users SET total_movie_minutes_watched = 0 WHERE id = ?`, userID)
	c.JSON(http.StatusOK, gin.H{"total_minutes": 0, "movie_count": movieCount})
}

// SetMovieStats stocke directement le total calculé côté client (via TMDB).
func (h *WatchedHandler) SetMovieStats(c *gin.Context) {
	userID := c.GetString("user_id")
	var req struct {
		TotalMinutes int64 `json:"total_minutes"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	h.db.Exec(`UPDATE users SET total_movie_minutes_watched = ? WHERE id = ?`, req.TotalMinutes, userID)
	c.JSON(http.StatusOK, gin.H{"total_minutes": req.TotalMinutes})
}

// DeleteAll supprime tout le contenu de l'utilisateur : watchlist, favoris, films vus et épisodes vus.
func (h *WatchedHandler) DeleteAll(c *gin.Context) {
	userID := c.GetString("user_id")
	h.db.Exec("DELETE FROM watched_episodes WHERE user_id = ?", userID)
	h.db.Exec("DELETE FROM watched_movies WHERE user_id = ?", userID)
	h.db.Exec("DELETE FROM favorites WHERE user_id = ?", userID)
	h.db.Exec("DELETE FROM watchlist WHERE user_id = ?", userID)
	h.db.Exec("UPDATE users SET total_minutes_watched = 0, total_movie_minutes_watched = 0 WHERE id = ?", userID)
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

// GetSeriesWatchedSummary agrège les stats de visionnage par série pour l'utilisateur.
func (h *WatchedHandler) GetSeriesWatchedSummary(c *gin.Context) {
	userID := c.GetString("user_id")

	rows, err := h.db.Query(`
		SELECT we.series_tmdb_id,
		       COUNT(*) AS watched_count,
		       COALESCE(wl.total_episodes, 0) AS total_episodes,
		       COALESCE(
		           strftime('%Y-%m-%dT%H:%M:%SZ', MAX(we.watched_at)),
		           MAX(we.watched_at)
		       ) AS last_watched_at,
		       (SELECT season_number FROM watched_episodes
		        WHERE user_id = we.user_id AND series_tmdb_id = we.series_tmdb_id
		        ORDER BY season_number DESC, episode_number DESC LIMIT 1) AS last_season,
		       (SELECT episode_number FROM watched_episodes
		        WHERE user_id = we.user_id AND series_tmdb_id = we.series_tmdb_id
		        ORDER BY season_number DESC, episode_number DESC LIMIT 1) AS last_episode
		FROM watched_episodes we
		LEFT JOIN watchlist wl
		       ON wl.tmdb_id = we.series_tmdb_id
		      AND wl.user_id  = we.user_id
		      AND wl.media_type = 'tv'
		WHERE we.user_id = ?
		GROUP BY we.series_tmdb_id
	`, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch series summary"})
		return
	}
	defer rows.Close()

	result := []SeriesWatchedSummary{}
	for rows.Next() {
		var (
			seriesTmdbID       int64
			watchedCount       int
			totalEpisodes      int
			rawDate            sql.NullString
			lastWatchedSeason  sql.NullInt64
			lastWatchedEpisode sql.NullInt64
		)
		if err := rows.Scan(&seriesTmdbID, &watchedCount, &totalEpisodes, &rawDate, &lastWatchedSeason, &lastWatchedEpisode); err != nil {
			continue
		}
		result = append(result, SeriesWatchedSummary{
			SeriesTmdbID:       seriesTmdbID,
			WatchedCount:       watchedCount,
			TotalEpisodes:      totalEpisodes,
			LastWatchedAt:      normaliseWatchedAt(rawDate.String),
			LastWatchedSeason:  int(lastWatchedSeason.Int64),
			LastWatchedEpisode: int(lastWatchedEpisode.Int64),
		})
	}
	c.JSON(http.StatusOK, result)
}

// ── Statistiques étendues séries ──────────────────────────────────────────────

type WeekEntry struct {
	Week      int     `json:"week"`
	Hours     float64 `json:"hours"`
	Count     int     `json:"count"`
	IsCurrent bool    `json:"is_current"`
}

type MarathonEntry struct {
	Title        string `json:"title"`
	EpisodeCount int    `json:"episode_count"`
	Hours        int    `json:"hours"`
}

type NameCount struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

type FutureMonthEntry struct {
	Label string  `json:"label"`
	Count int     `json:"count"`
	Hours float64 `json:"hours"`
}

type PastMonthEntry struct {
	Label     string  `json:"label"`
	Hours     float64 `json:"hours"`
	Count     int     `json:"count"`
	IsCurrent bool    `json:"is_current"`
}

// UpdateEpisodeRuntimes met à jour runtime_minutes pour les épisodes qui n'en ont pas encore,
// pour une série donnée. Appelé après un recalcul TMDB afin que les charts par semaine soient exacts.
func (h *WatchedHandler) UpdateEpisodeRuntimes(c *gin.Context) {
	userID := c.GetString("user_id")
	var req struct {
		SeriesTmdbID   int64 `json:"series_tmdb_id"  binding:"required"`
		RuntimeMinutes int   `json:"runtime_minutes"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.RuntimeMinutes <= 0 {
		c.JSON(http.StatusOK, gin.H{"updated": 0})
		return
	}
	result, err := h.db.Exec(
		`UPDATE watched_episodes SET runtime_minutes = ?
		 WHERE user_id = ? AND series_tmdb_id = ? AND runtime_minutes = 0`,
		req.RuntimeMinutes, userID, req.SeriesTmdbID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update runtimes"})
		return
	}
	n, _ := result.RowsAffected()
	c.JSON(http.StatusOK, gin.H{"updated": n})
}

// GetSeriesStatsExtended retourne toutes les statistiques avancées pour l'onglet séries.
func (h *WatchedHandler) GetSeriesStatsExtended(c *gin.Context) {
	userID := c.GetString("user_id")

	// ── Compteurs de base ─────────────────────────────────────────────────────

	var episodeCount, seriesCount, seriesInProduction int64
	h.db.QueryRow(`SELECT COUNT(*) FROM watched_episodes WHERE user_id = ?`, userID).Scan(&episodeCount)
	h.db.QueryRow(`SELECT COUNT(*) FROM watchlist WHERE user_id = ? AND media_type = 'tv'`, userID).Scan(&seriesCount)
	h.db.QueryRow(`SELECT COUNT(*) FROM watchlist WHERE user_id = ? AND media_type = 'tv' AND is_ended = 0`, userID).Scan(&seriesInProduction)

	// ── Temps total ───────────────────────────────────────────────────────────

	var stored sql.NullInt64
	h.db.QueryRow(`SELECT total_minutes_watched FROM users WHERE id = ?`, userID).Scan(&stored)
	totalMinutes := stored.Int64
	if !stored.Valid {
		h.db.QueryRow(
			`SELECT COALESCE(SUM(runtime_minutes * (1 + rewatch_count)), 0) FROM watched_episodes WHERE user_id = ?`,
			userID,
		).Scan(&totalMinutes)
		h.db.Exec(`UPDATE users SET total_minutes_watched = ? WHERE id = ?`, totalMinutes, userID)
	}

	// ── 7 derniers jours ──────────────────────────────────────────────────────

	var minutesLast7Days, episodesLast7Days int64
	h.db.QueryRow(
		`SELECT COALESCE(SUM(runtime_minutes * (1 + rewatch_count)), 0) FROM watched_episodes
		 WHERE user_id = ? AND substr(watched_at, 1, 10) >= date('now', '-7 days')`,
		userID,
	).Scan(&minutesLast7Days)
	h.db.QueryRow(
		`SELECT COUNT(*) FROM watched_episodes WHERE user_id = ? AND substr(watched_at, 1, 10) >= date('now', '-7 days')`,
		userID,
	).Scan(&episodesLast7Days)

	// ── Données hebdomadaires (12 dernières semaines) ─────────────────────────
	// substr(watched_at, 1, 10) extrait YYYY-MM-DD quel que soit le format stocké par le driver Go.

	hoursBuckets := map[int]float64{}
	countBuckets := map[int]int{}

	rowsH, _ := h.db.Query(`
		SELECT
			CAST((julianday('now', 'start of day') - julianday(substr(watched_at, 1, 10))) / 7 AS INTEGER) as bucket,
			SUM(runtime_minutes * (1 + rewatch_count)) / 60.0 as hours,
			COUNT(*) as cnt
		FROM watched_episodes
		WHERE user_id = ? AND substr(watched_at, 1, 10) >= date('now', '-83 days')
		GROUP BY bucket
	`, userID)
	if rowsH != nil {
		defer rowsH.Close()
		for rowsH.Next() {
			var bucket int
			var hours float64
			var cnt int
			if err := rowsH.Scan(&bucket, &hours, &cnt); err == nil {
				hoursBuckets[bucket] = hours
				countBuckets[bucket] = cnt
			}
		}
	}

	now := time.Now()
	weekEntries := make([]WeekEntry, 12)
	for i := 0; i < 12; i++ {
		bucket := 11 - i
		weekDate := now.AddDate(0, 0, -bucket*7)
		_, weekNum := weekDate.ISOWeek()
		weekEntries[i] = WeekEntry{
			Week:      weekNum,
			Hours:     math.Round(hoursBuckets[bucket]*10) / 10,
			Count:     countBuckets[bucket],
			IsCurrent: bucket == 0,
		}
	}

	// ── Données mensuelles historiques (12 derniers mois) ─────────────────────

	type pastMonthData struct {
		hours float64
		count int
	}
	pastMonthMap := map[string]pastMonthData{}

	rowsPM, _ := h.db.Query(`
		SELECT
			substr(watched_at, 1, 7) as month,
			SUM(runtime_minutes * (1 + rewatch_count)) / 60.0 as hours,
			COUNT(*) as cnt
		FROM watched_episodes
		WHERE user_id = ? AND substr(watched_at, 1, 10) >= date('now', '-365 days')
		GROUP BY month
		ORDER BY month
	`, userID)
	if rowsPM != nil {
		defer rowsPM.Close()
		for rowsPM.Next() {
			var month string
			var hours float64
			var cnt int
			if err := rowsPM.Scan(&month, &hours, &cnt); err == nil {
				pastMonthMap[month] = pastMonthData{hours: hours, count: cnt}
			}
		}
	}

	currentYearMonth := now.Format("2006-01")
	frMonthInitialsPast := []string{"J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"}
	pastMonthEntries := make([]PastMonthEntry, 12)
	for i := 0; i < 12; i++ {
		monthDate := now.AddDate(0, -(11 - i), 0) // i=0 → il y a 11 mois, i=11 → mois courant
		yearMonth := monthDate.Format("2006-01")
		d := pastMonthMap[yearMonth]
		pastMonthEntries[i] = PastMonthEntry{
			Label:     frMonthInitialsPast[int(monthDate.Month())-1],
			Hours:     math.Round(d.hours*10) / 10,
			Count:     d.count,
			IsCurrent: yearMonth == currentYearMonth,
		}
	}

	// ── Séries commencées + épisodes restants ─────────────────────────────────

	var startedSeriesCount, remainingEpisodes int64
	rowsSeries, _ := h.db.Query(`
		SELECT
			COUNT(*) as watched_count,
			COALESCE(wl.total_episodes, 0) as total_eps
		FROM watched_episodes we
		LEFT JOIN watchlist wl ON wl.tmdb_id = we.series_tmdb_id AND wl.user_id = we.user_id AND wl.media_type = 'tv'
		WHERE we.user_id = ?
		GROUP BY we.series_tmdb_id
	`, userID)
	if rowsSeries != nil {
		defer rowsSeries.Close()
		for rowsSeries.Next() {
			var watchedCount, totalEps int
			if err := rowsSeries.Scan(&watchedCount, &totalEps); err == nil {
				startedSeriesCount++
				if totalEps > watchedCount {
					remainingEpisodes += int64(totalEps - watchedCount)
				}
			}
		}
	}

	// ── Runtime moyen + temps restant ─────────────────────────────────────────

	var avgRuntime float64
	h.db.QueryRow(
		`SELECT COALESCE(AVG(runtime_minutes), 24) FROM watched_episodes WHERE user_id = ? AND runtime_minutes > 0`,
		userID,
	).Scan(&avgRuntime)
	if avgRuntime < 1 {
		avgRuntime = 24
	}
	remainingMinutes := int64(float64(remainingEpisodes) * avgRuntime)

	// ── Cadence (2 derniers mois) ─────────────────────────────────────────────

	var episodesLast2Months int64
	h.db.QueryRow(
		`SELECT COUNT(*) FROM watched_episodes WHERE user_id = ? AND substr(watched_at, 1, 10) >= date('now', '-60 days')`,
		userID,
	).Scan(&episodesLast2Months)
	pacePerWeek := float64(episodesLast2Months) / (60.0 / 7.0)

	// ── Date de rattrapage ────────────────────────────────────────────────────

	catchUpDate := ""
	if pacePerWeek > 0 && remainingEpisodes > 0 {
		weeksToFinish := float64(remainingEpisodes) / pacePerWeek
		catchUp := now.AddDate(0, 0, int(weeksToFinish*7))
		catchUpDate = catchUp.Format("2006-01-02")
	}

	// ── Top marathons ─────────────────────────────────────────────────────────

	marathons := []MarathonEntry{}
	rowsM, _ := h.db.Query(`
		SELECT
			COALESCE(wl.title, CAST(sub.series_tmdb_id AS TEXT)) as title,
			sub.day_count as episode_count,
			CAST(ROUND(sub.day_hours) AS INTEGER) as hours
		FROM (
			SELECT
				series_tmdb_id,
				COUNT(*) as day_count,
				COALESCE(SUM(runtime_minutes), 0) / 60.0 as day_hours,
				ROW_NUMBER() OVER (PARTITION BY series_tmdb_id ORDER BY COUNT(*) DESC) as rn
			FROM watched_episodes
			WHERE user_id = ?
			GROUP BY series_tmdb_id, substr(watched_at, 1, 10)
		) sub
		LEFT JOIN watchlist wl ON wl.tmdb_id = sub.series_tmdb_id AND wl.user_id = ? AND wl.media_type = 'tv'
		WHERE sub.rn = 1
		ORDER BY sub.day_count DESC
		LIMIT 5
	`, userID, userID)
	if rowsM != nil {
		defer rowsM.Close()
		for rowsM.Next() {
			var m MarathonEntry
			if err := rowsM.Scan(&m.Title, &m.EpisodeCount, &m.Hours); err == nil {
				marathons = append(marathons, m)
			}
		}
	}

	// ── Genres et chaînes ─────────────────────────────────────────────────────

	genreMap := map[string]int{}
	networkMap := map[string]int{}

	rowsWL, _ := h.db.Query(
		`SELECT COALESCE(genres, ''), COALESCE(networks, '') FROM watchlist WHERE user_id = ? AND media_type = 'tv'`,
		userID,
	)
	if rowsWL != nil {
		defer rowsWL.Close()
		for rowsWL.Next() {
			var genres, networks string
			if err := rowsWL.Scan(&genres, &networks); err == nil {
				for _, g := range splitCSV(genres) {
					genreMap[g]++
				}
				for _, n := range splitCSV(networks) {
					networkMap[n]++
				}
			}
		}
	}
	topGenres := topNEntries(genreMap, 5)
	topNetworks := topNEntries(networkMap, 5)

	// ── Mois futurs estimés ───────────────────────────────────────────────────

	frMonthInitial := []string{"J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"}
	futureMonths := make([]FutureMonthEntry, 12)
	hoursPerWeek := pacePerWeek * avgRuntime / 60.0
	remEp := float64(remainingEpisodes)

	for i := 0; i < 12; i++ {
		monthDate := now.AddDate(0, i, 0)
		weeksInMonth := float64(daysInMonth(monthDate.Year(), monthDate.Month())) / 7.0

		epThisMonth := pacePerWeek * weeksInMonth
		hoursThisMonth := hoursPerWeek * weeksInMonth
		if remEp <= 0 {
			epThisMonth = 0
			hoursThisMonth = 0
		} else if epThisMonth > remEp {
			epThisMonth = remEp
		}
		remEp -= epThisMonth

		label := frMonthInitial[int(monthDate.Month())-1]
		futureMonths[i] = FutureMonthEntry{
			Label: label,
			Count: int(math.Round(epThisMonth)),
			Hours: math.Round(hoursThisMonth*10) / 10,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"total_minutes":        totalMinutes,
		"minutes_last_7_days":  minutesLast7Days,
		"episode_count":        episodeCount,
		"episodes_last_7_days": episodesLast7Days,
		"series_count":         seriesCount,
		"series_in_production": seriesInProduction,
		"started_series_count": startedSeriesCount,
		"remaining_episodes":   remainingEpisodes,
		"remaining_minutes":    remainingMinutes,
		"pace_per_week":        math.Round(pacePerWeek*100) / 100,
		"catch_up_date":        catchUpDate,
		"week_data":            weekEntries,
		"past_months":          pastMonthEntries,
		"top_marathons":        marathons,
		"top_genres":           topGenres,
		"top_networks":         topNetworks,
		"future_months":        futureMonths,
	})
}

// ── Statistiques étendues films ───────────────────────────────────────────────

type DecadeEntry struct {
	Decade int `json:"decade"`
	Count  int `json:"count"`
}

// UpdateMovieRuntime persiste le runtime et l'année de sortie d'un film vu (appelé lors du recalcul TMDB).
func (h *WatchedHandler) UpdateMovieRuntime(c *gin.Context) {
	userID := c.GetString("user_id")
	var req struct {
		TmdbID         int64 `json:"tmdb_id"          binding:"required"`
		RuntimeMinutes int   `json:"runtime_minutes"`
		ReleaseYear    int   `json:"release_year"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	result, err := h.db.Exec(
		`UPDATE watched_movies SET runtime_minutes = ?, release_year = ? WHERE user_id = ? AND tmdb_id = ?`,
		req.RuntimeMinutes, req.ReleaseYear, userID, req.TmdbID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update movie info"})
		return
	}
	n, _ := result.RowsAffected()
	c.JSON(http.StatusOK, gin.H{"updated": n})
}

// GetMovieStatsExtended retourne toutes les statistiques avancées pour l'onglet films.
func (h *WatchedHandler) GetMovieStatsExtended(c *gin.Context) {
	userID := c.GetString("user_id")

	// ── Compteurs de base ─────────────────────────────────────────────────────

	var movieCount, moviesAdded, moviesRemaining int64
	h.db.QueryRow(`SELECT COUNT(*) FROM watched_movies WHERE user_id = ?`, userID).Scan(&movieCount)
	h.db.QueryRow(`SELECT COUNT(*) FROM watchlist WHERE user_id = ? AND media_type = 'movie'`, userID).Scan(&moviesAdded)
	h.db.QueryRow(`
		SELECT COUNT(*) FROM watchlist wl
		WHERE wl.user_id = ? AND wl.media_type = 'movie'
		  AND NOT EXISTS (
		      SELECT 1 FROM watched_movies wm
		      WHERE wm.user_id = wl.user_id AND wm.tmdb_id = wl.tmdb_id
		  )
	`, userID).Scan(&moviesRemaining)

	// ── Temps total ───────────────────────────────────────────────────────────

	var stored sql.NullInt64
	h.db.QueryRow(`SELECT total_movie_minutes_watched FROM users WHERE id = ?`, userID).Scan(&stored)
	totalMinutes := stored.Int64
	if !stored.Valid {
		h.db.Exec(`UPDATE users SET total_movie_minutes_watched = 0 WHERE id = ?`, userID)
	}

	// ── 7 derniers jours ──────────────────────────────────────────────────────

	var minutesLast7Days, moviesLast7Days int64
	h.db.QueryRow(
		`SELECT COALESCE(SUM(runtime_minutes * (1 + rewatch_count)), 0) FROM watched_movies
		 WHERE user_id = ? AND substr(watched_at, 1, 10) >= date('now', '-7 days')`,
		userID,
	).Scan(&minutesLast7Days)
	h.db.QueryRow(
		`SELECT COUNT(*) FROM watched_movies WHERE user_id = ? AND substr(watched_at, 1, 10) >= date('now', '-7 days')`,
		userID,
	).Scan(&moviesLast7Days)

	// ── Données hebdomadaires (12 dernières semaines) ─────────────────────────

	hoursBuckets := map[int]float64{}
	countBuckets := map[int]int{}

	rowsH, _ := h.db.Query(`
		SELECT
			CAST((julianday('now', 'start of day') - julianday(substr(watched_at, 1, 10))) / 7 AS INTEGER) as bucket,
			SUM(runtime_minutes * (1 + rewatch_count)) / 60.0 as hours,
			COUNT(*) as cnt
		FROM watched_movies
		WHERE user_id = ? AND substr(watched_at, 1, 10) >= date('now', '-83 days')
		GROUP BY bucket
	`, userID)
	if rowsH != nil {
		defer rowsH.Close()
		for rowsH.Next() {
			var bucket int
			var hours float64
			var cnt int
			if err := rowsH.Scan(&bucket, &hours, &cnt); err == nil {
				hoursBuckets[bucket] = hours
				countBuckets[bucket] = cnt
			}
		}
	}

	now := time.Now()
	weekEntries := make([]WeekEntry, 12)
	for i := 0; i < 12; i++ {
		bucket := 11 - i
		weekDate := now.AddDate(0, 0, -bucket*7)
		_, weekNum := weekDate.ISOWeek()
		weekEntries[i] = WeekEntry{
			Week:      weekNum,
			Hours:     math.Round(hoursBuckets[bucket]*10) / 10,
			Count:     countBuckets[bucket],
			IsCurrent: bucket == 0,
		}
	}

	// ── Données mensuelles historiques (12 derniers mois) ─────────────────────

	type pastMonthData struct {
		hours float64
		count int
	}
	pastMonthMap := map[string]pastMonthData{}

	rowsPM, _ := h.db.Query(`
		SELECT
			substr(watched_at, 1, 7) as month,
			SUM(runtime_minutes * (1 + rewatch_count)) / 60.0 as hours,
			COUNT(*) as cnt
		FROM watched_movies
		WHERE user_id = ? AND substr(watched_at, 1, 10) >= date('now', '-365 days')
		GROUP BY month
		ORDER BY month
	`, userID)
	if rowsPM != nil {
		defer rowsPM.Close()
		for rowsPM.Next() {
			var month string
			var hours float64
			var cnt int
			if err := rowsPM.Scan(&month, &hours, &cnt); err == nil {
				pastMonthMap[month] = pastMonthData{hours: hours, count: cnt}
			}
		}
	}

	currentYearMonth := now.Format("2006-01")
	frMonthInitialsPast := []string{"J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"}
	pastMonthEntries := make([]PastMonthEntry, 12)
	for i := 0; i < 12; i++ {
		monthDate := now.AddDate(0, -(11-i), 0)
		yearMonth := monthDate.Format("2006-01")
		d := pastMonthMap[yearMonth]
		pastMonthEntries[i] = PastMonthEntry{
			Label:     frMonthInitialsPast[int(monthDate.Month())-1],
			Hours:     math.Round(d.hours*10) / 10,
			Count:     d.count,
			IsCurrent: yearMonth == currentYearMonth,
		}
	}

	// ── Cadence (2 derniers mois) ─────────────────────────────────────────────

	var moviesLast2Months int64
	h.db.QueryRow(
		`SELECT COUNT(*) FROM watched_movies WHERE user_id = ? AND substr(watched_at, 1, 10) >= date('now', '-60 days')`,
		userID,
	).Scan(&moviesLast2Months)
	pacePerWeek := float64(moviesLast2Months) / (60.0 / 7.0)

	// ── Runtime moyen + temps restant ─────────────────────────────────────────

	var avgRuntime float64
	h.db.QueryRow(
		`SELECT COALESCE(AVG(runtime_minutes), 90) FROM watched_movies WHERE user_id = ? AND runtime_minutes > 0`,
		userID,
	).Scan(&avgRuntime)
	if avgRuntime < 1 {
		avgRuntime = 90
	}
	remainingMinutes := int64(float64(moviesRemaining) * avgRuntime)

	// ── Date de rattrapage ────────────────────────────────────────────────────

	catchUpDate := ""
	if pacePerWeek > 0 && moviesRemaining > 0 {
		weeksToFinish := float64(moviesRemaining) / pacePerWeek
		catchUp := now.AddDate(0, 0, int(weeksToFinish*7))
		catchUpDate = catchUp.Format("2006-01-02")
	}

	// ── Mois futurs estimés ───────────────────────────────────────────────────

	frMonthInitial := []string{"J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"}
	futureMonths := make([]FutureMonthEntry, 12)
	hoursPerWeek := pacePerWeek * avgRuntime / 60.0
	remMov := float64(moviesRemaining)

	for i := 0; i < 12; i++ {
		monthDate := now.AddDate(0, i, 0)
		weeksInMonth := float64(daysInMonth(monthDate.Year(), monthDate.Month())) / 7.0
		movThisMonth := pacePerWeek * weeksInMonth
		hoursThisMonth := hoursPerWeek * weeksInMonth
		if remMov <= 0 {
			movThisMonth = 0
			hoursThisMonth = 0
		} else if movThisMonth > remMov {
			movThisMonth = remMov
		}
		remMov -= movThisMonth
		futureMonths[i] = FutureMonthEntry{
			Label: frMonthInitial[int(monthDate.Month())-1],
			Count: int(math.Round(movThisMonth)),
			Hours: math.Round(hoursThisMonth*10) / 10,
		}
	}

	// ── Décennies (depuis release_year stocké dans watched_movies) ───────────

	decadeMap := map[int]int{}
	rowsD, _ := h.db.Query(`
		SELECT release_year FROM watched_movies
		WHERE user_id = ? AND release_year > 0
	`, userID)
	if rowsD != nil {
		defer rowsD.Close()
		for rowsD.Next() {
			var year int
			if err := rowsD.Scan(&year); err == nil && year > 0 {
				decadeMap[(year/10)*10]++
			}
		}
	}

	decades := make([]DecadeEntry, 0, len(decadeMap))
	for d, cnt := range decadeMap {
		decades = append(decades, DecadeEntry{Decade: d, Count: cnt})
	}
	sort.Slice(decades, func(i, j int) bool { return decades[i].Decade < decades[j].Decade })

	c.JSON(http.StatusOK, gin.H{
		"total_minutes":       totalMinutes,
		"minutes_last_7_days": minutesLast7Days,
		"movie_count":         movieCount,
		"movies_last_7_days":  moviesLast7Days,
		"movies_added":        moviesAdded,
		"movies_remaining":    moviesRemaining,
		"pace_per_week":       math.Round(pacePerWeek*100) / 100,
		"remaining_minutes":   remainingMinutes,
		"catch_up_date":       catchUpDate,
		"week_data":           weekEntries,
		"past_months":         pastMonthEntries,
		"future_months":       futureMonths,
		"decades":             decades,
	})
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func splitCSV(s string) []string {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		t := strings.TrimSpace(p)
		if t != "" {
			result = append(result, t)
		}
	}
	return result
}

func topNEntries(m map[string]int, n int) []NameCount {
	type kv struct {
		Name  string
		Count int
	}
	sorted := make([]kv, 0, len(m))
	for k, v := range m {
		sorted = append(sorted, kv{k, v})
	}
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].Count > sorted[j].Count
	})
	result := make([]NameCount, 0, n)
	for i, s := range sorted {
		if i >= n {
			break
		}
		result = append(result, NameCount{Name: s.Name, Count: s.Count})
	}
	return result
}

func daysInMonth(year int, m time.Month) int {
	return time.Date(year, m+1, 0, 0, 0, 0, 0, time.UTC).Day()
}
