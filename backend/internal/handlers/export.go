package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"tv-time-rebirth/backend/internal/database"
)

type ExportHandler struct {
	db *database.DB
}

func NewExportHandler(db *database.DB) *ExportHandler {
	return &ExportHandler{db: db}
}

// ─── Types export ─────────────────────────────────────────────────────────────

type ExportEpisode struct {
	Season         int    `json:"season"`
	Episode        int    `json:"episode"`
	WatchedAt      string `json:"watched_at"`
	RewatchCount   int    `json:"rewatch_count"`
	RuntimeMinutes int    `json:"runtime_minutes"`
}

type ExportSeries struct {
	TmdbID          int             `json:"tmdb_id"`
	Title           string          `json:"title"`
	PosterPath      string          `json:"poster_path"`
	TotalEpisodes   int             `json:"total_episodes"`
	IsEnded         bool            `json:"is_ended"`
	UserStatus      string          `json:"user_status"`
	AddedAt         string          `json:"added_at"`
	IsFavorite      bool            `json:"is_favorite"`
	WatchedEpisodes []ExportEpisode `json:"watched_episodes"`
}

type ExportMovie struct {
	TmdbID       int    `json:"tmdb_id"`
	Title        string `json:"title"`
	PosterPath   string `json:"poster_path"`
	UserStatus   string `json:"user_status"`
	AddedAt      string `json:"added_at"`
	IsFavorite   bool   `json:"is_favorite"`
	Watched      bool   `json:"watched"`
	WatchedAt    string `json:"watched_at,omitempty"`
	RewatchCount int    `json:"rewatch_count"`
}

type ExportData struct {
	Version    int            `json:"version"`
	App        string         `json:"app"`
	ExportedAt string         `json:"exported_at"`
	Series     []ExportSeries `json:"series"`
	Movies     []ExportMovie  `json:"movies"`
}

// ─── Handler ──────────────────────────────────────────────────────────────────

// Export génère un snapshot complet des données utilisateur.
func (h *ExportHandler) Export(c *gin.Context) {
	userID := c.GetString("user_id")

	// ── 1. Watchlist ──────────────────────────────────────────────────────────
	type watchlistRow struct {
		tmdbID        int64
		mediaType     string
		title         string
		posterPath    string
		totalEpisodes int
		isEnded       bool
		userStatus    string
		addedAt       string
	}

	wlRows, err := h.db.Query(
		`SELECT tmdb_id, media_type, title, poster_path, total_episodes, is_ended, user_status,
		        COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', added_at), added_at) AS added_at
		 FROM watchlist WHERE user_id = ? ORDER BY added_at DESC`,
		userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch watchlist"})
		return
	}
	defer wlRows.Close()

	var wlList []watchlistRow
	for wlRows.Next() {
		var r watchlistRow
		var isEndedInt int
		if err := wlRows.Scan(&r.tmdbID, &r.mediaType, &r.title, &r.posterPath,
			&r.totalEpisodes, &isEndedInt, &r.userStatus, &r.addedAt); err == nil {
			r.isEnded = isEndedInt == 1
			wlList = append(wlList, r)
		}
	}
	wlRows.Close()

	// ── 2. Favoris ────────────────────────────────────────────────────────────
	favSet := map[string]bool{} // "tmdbID/mediaType" → true

	favRows, _ := h.db.Query(
		`SELECT tmdb_id, media_type FROM favorites WHERE user_id = ?`, userID,
	)
	if favRows != nil {
		defer favRows.Close()
		for favRows.Next() {
			var tid int64
			var mt string
			if err := favRows.Scan(&tid, &mt); err == nil {
				favSet[formatKey(tid, mt)] = true
			}
		}
		favRows.Close()
	}

	// ── 3. Épisodes vus ───────────────────────────────────────────────────────
	// Map : series_tmdb_id → []ExportEpisode
	episodesBySeriesID := map[int64][]ExportEpisode{}

	epRows, _ := h.db.Query(
		`SELECT series_tmdb_id, season_number, episode_number,
		        COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', watched_at), watched_at) AS watched_at,
		        rewatch_count, runtime_minutes
		 FROM watched_episodes WHERE user_id = ?
		 ORDER BY series_tmdb_id, season_number, episode_number`,
		userID,
	)
	if epRows != nil {
		defer epRows.Close()
		for epRows.Next() {
			var seriesID int64
			var season, episode, rewatchCount, runtimeMinutes int
			var watchedAt string
			if err := epRows.Scan(&seriesID, &season, &episode, &watchedAt, &rewatchCount, &runtimeMinutes); err == nil {
				episodesBySeriesID[seriesID] = append(episodesBySeriesID[seriesID], ExportEpisode{
					Season:         season,
					Episode:        episode,
					WatchedAt:      watchedAt,
					RewatchCount:   rewatchCount,
					RuntimeMinutes: runtimeMinutes,
				})
			}
		}
		epRows.Close()
	}

	// ── 4. Films vus ──────────────────────────────────────────────────────────
	type movieWatchedRow struct {
		tmdbID       int64
		watchedAt    string
		rewatchCount int
	}
	watchedMovies := map[int64]movieWatchedRow{}

	mwRows, _ := h.db.Query(
		`SELECT tmdb_id, COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', watched_at), watched_at), rewatch_count
		 FROM watched_movies WHERE user_id = ?`,
		userID,
	)
	if mwRows != nil {
		defer mwRows.Close()
		for mwRows.Next() {
			var r movieWatchedRow
			if err := mwRows.Scan(&r.tmdbID, &r.watchedAt, &r.rewatchCount); err == nil {
				watchedMovies[r.tmdbID] = r
			}
		}
		mwRows.Close()
	}

	// ── 5. Construction du résultat ───────────────────────────────────────────
	var seriesList []ExportSeries
	var movieList  []ExportMovie

	for _, r := range wlList {
		key := formatKey(r.tmdbID, r.mediaType)
		isFav := favSet[key]

		if r.mediaType == "tv" {
			eps := episodesBySeriesID[r.tmdbID]
			if eps == nil {
				eps = []ExportEpisode{}
			}
			seriesList = append(seriesList, ExportSeries{
				TmdbID:          int(r.tmdbID),
				Title:           r.title,
				PosterPath:      r.posterPath,
				TotalEpisodes:   r.totalEpisodes,
				IsEnded:         r.isEnded,
				UserStatus:      r.userStatus,
				AddedAt:         r.addedAt,
				IsFavorite:      isFav,
				WatchedEpisodes: eps,
			})
		} else {
			mw, watched := watchedMovies[r.tmdbID]
			m := ExportMovie{
				TmdbID:     int(r.tmdbID),
				Title:      r.title,
				PosterPath: r.posterPath,
				UserStatus: r.userStatus,
				AddedAt:    r.addedAt,
				IsFavorite: isFav,
				Watched:    watched,
			}
			if watched {
				m.WatchedAt    = mw.watchedAt
				m.RewatchCount = mw.rewatchCount
			}
			movieList = append(movieList, m)
		}
	}

	if seriesList == nil {
		seriesList = []ExportSeries{}
	}
	if movieList == nil {
		movieList = []ExportMovie{}
	}

	c.JSON(http.StatusOK, ExportData{
		Version:    1,
		App:        "tv-time-rebirth",
		ExportedAt: time.Now().UTC().Format(time.RFC3339),
		Series:     seriesList,
		Movies:     movieList,
	})
}

func formatKey(tmdbID int64, mediaType string) string {
	return mediaType + "/" + itoa(tmdbID)
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	buf := [20]byte{}
	pos := len(buf)
	neg := n < 0
	if neg {
		n = -n
	}
	for n > 0 {
		pos--
		buf[pos] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		pos--
		buf[pos] = '-'
	}
	return string(buf[pos:])
}
