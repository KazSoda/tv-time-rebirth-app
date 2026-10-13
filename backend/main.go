package main

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"

	"tv-time-rebirth/backend/internal/config"
	"tv-time-rebirth/backend/internal/database"
	"tv-time-rebirth/backend/internal/handlers"
	"tv-time-rebirth/backend/internal/middleware"
)

func main() {
	cfg := config.Load()

	db, err := database.New(cfg.DBPath)
	if err != nil {
		log.Fatalf("failed to initialize database: %v", err)
	}
	defer db.Close()

	router := gin.Default()

	// CORS middleware — allow all origins for dev
	router.Use(corsMiddleware())

	authHandler      := handlers.NewAuthHandler(db, cfg.JWTSecret)
	watchlistHandler  := handlers.NewWatchlistHandler(db)
	watchedHandler    := handlers.NewWatchedHandler(db)
	favoritesHandler  := handlers.NewFavoritesHandler(db)
	exportHandler     := handlers.NewExportHandler(db)
	profileHandler    := handlers.NewProfileHandler(db, cfg.UploadDir)
	followHandler     := handlers.NewFollowHandler(db)

	// Servir les uploads (avatars, bannières) sans authentification
	router.Static("/uploads", cfg.UploadDir)

	api := router.Group("/api")
	api.Use(middleware.VersionCheck())
	{
		auth := api.Group("/auth")
		{
			auth.POST("/register", authHandler.Register)
			auth.POST("/login", authHandler.Login)
		}

		protected := api.Group("/")
		protected.Use(middleware.AuthRequired(cfg.JWTSecret))
		{
			protected.GET("/me", func(c *gin.Context) {
				c.JSON(http.StatusOK, gin.H{
					"user_id":  c.GetString("user_id"),
					"username": c.GetString("username"),
					"email":    c.GetString("email"),
				})
			})

			protected.PATCH("/me/password", authHandler.ChangePassword)

			protected.GET("/watchlist", watchlistHandler.List)
			protected.POST("/watchlist", watchlistHandler.Add)
			protected.GET("/watchlist/:tmdb_id/:media_type", watchlistHandler.Check)
			protected.DELETE("/watchlist/:tmdb_id/:media_type", watchlistHandler.Remove)
			protected.PATCH("/watchlist/:tmdb_id/:media_type/status", watchlistHandler.SetStatus)

			// Films vus
			protected.GET("/watched/movies", watchedHandler.GetWatchedMovies)
			protected.GET("/watched/movies-summary", watchedHandler.GetMoviesSummary)
			protected.GET("/watched/movie-stats", watchedHandler.GetMovieStats)
			protected.GET("/watched/movie-stats-extended", watchedHandler.GetMovieStatsExtended)
			protected.PUT("/watched/movie-stats", watchedHandler.SetMovieStats)
			protected.PUT("/watched/movie-runtime", watchedHandler.UpdateMovieRuntime)
			protected.GET("/watched/movie/:tmdb_id", watchedHandler.CheckMovie)
			protected.POST("/watched/movie", watchedHandler.MarkMovie)
			protected.POST("/watched/movie/rewatch", watchedHandler.RewatchMovie)
			protected.DELETE("/watched/movie/:tmdb_id", watchedHandler.UnmarkMovie)

			// Épisodes vus
			protected.GET("/watched/series-summary", watchedHandler.GetSeriesWatchedSummary)
			protected.GET("/watched/series-stats", watchedHandler.GetSeriesStats)
			protected.GET("/watched/series-stats-extended", watchedHandler.GetSeriesStatsExtended)
			protected.PUT("/watched/series-stats", watchedHandler.SetSeriesStats)
			protected.PUT("/watched/episode-runtimes", watchedHandler.UpdateEpisodeRuntimes)
				protected.GET("/watched/episodes/:series_id/:season_number", watchedHandler.GetWatchedEpisodes)
			protected.POST("/watched/episode", watchedHandler.MarkEpisode)
			protected.POST("/watched/episode/rewatch", watchedHandler.RewatchEpisode)
			protected.DELETE("/watched/episode/:series_id/:season_number/:episode_number", watchedHandler.UnmarkEpisode)
			protected.POST("/watched/season", watchedHandler.MarkSeason)
			protected.DELETE("/watched/season", watchedHandler.UnmarkSeason)
			protected.DELETE("/watched/all", watchedHandler.DeleteAll)
			protected.POST("/watched/import-episodes", watchedHandler.ImportEpisodes)
			protected.POST("/watched/import-movies", watchedHandler.ImportMovies)

			// Profil (avatar + bannière)
			protected.GET("/profile", profileHandler.GetProfile)
			protected.PUT("/profile/avatar", profileHandler.UploadAvatar)
			protected.PUT("/profile/banner", profileHandler.UploadBanner)

			// Export
			protected.GET("/export", exportHandler.Export)

			// Abonnements
			protected.GET("/me/following",      followHandler.MyFollowing)
			protected.GET("/me/followers",      followHandler.MyFollowers)
			protected.GET("/me/follow-counts",  followHandler.FollowCounts)
			protected.GET("/search/users",      followHandler.SearchUsers)
			protected.POST("/users/:username/follow",   followHandler.Follow)
			protected.DELETE("/users/:username/follow", followHandler.Unfollow)

			// Profil public d'un autre utilisateur
			protected.GET("/users/:username/profile",                followHandler.GetPublicProfile)
			protected.GET("/users/:username/watchlist",              followHandler.GetUserWatchlist)
			protected.GET("/users/:username/favorites",              followHandler.GetUserFavorites)
			protected.GET("/users/:username/watched/movies",         followHandler.GetUserWatchedMovies)
			protected.GET("/users/:username/watched/series-summary", followHandler.GetUserSeriesSummary)

			// Favoris
			protected.GET("/favorites", favoritesHandler.List)
			protected.GET("/favorites/:tmdb_id/:media_type", favoritesHandler.Check)
			protected.POST("/favorites", favoritesHandler.Add)
			protected.DELETE("/favorites/:tmdb_id/:media_type", favoritesHandler.Remove)
		}
	}

	addr := ":" + cfg.Port
	log.Printf("server starting on %s", addr)
	if err := router.Run(addr); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Authorization, X-App-Version")
		c.Header("Access-Control-Max-Age", "86400")

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}
