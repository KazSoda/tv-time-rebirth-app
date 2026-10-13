package config

import (
	"log"
	"os"
)

type Config struct {
	JWTSecret string
	Port      string
	DBPath    string
	UploadDir string
}

func Load() *Config {
	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		log.Println("WARNING: JWT_SECRET is not set, using the insecure development secret — never do this in production")
		jwtSecret = "dev-secret-change-in-production"
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "./data/tv-time.db"
	}

	uploadDir := os.Getenv("UPLOAD_DIR")
	if uploadDir == "" {
		uploadDir = "./data/uploads"
	}

	return &Config{
		JWTSecret: jwtSecret,
		Port:      port,
		DBPath:    dbPath,
		UploadDir: uploadDir,
	}
}
