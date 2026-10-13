package handlers

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/gin-gonic/gin"

	"tv-time-rebirth/backend/internal/database"
)

type ProfileHandler struct {
	db        *database.DB
	uploadDir string
}

func NewProfileHandler(db *database.DB, uploadDir string) *ProfileHandler {
	return &ProfileHandler{db: db, uploadDir: uploadDir}
}

// GetProfile retourne les métadonnées de l'avatar et de la bannière de l'utilisateur.
func (h *ProfileHandler) GetProfile(c *gin.Context) {
	userID := c.GetString("user_id")

	var avatarUpdatedAt, bannerUpdatedAt *string
	h.db.QueryRow(
		`SELECT avatar_updated_at, banner_updated_at FROM users WHERE id = ?`,
		userID,
	).Scan(&avatarUpdatedAt, &bannerUpdatedAt)

	var avatarPath, bannerPath *string
	if avatarUpdatedAt != nil {
		p := fmt.Sprintf("/uploads/%s/avatar.jpg", userID)
		avatarPath = &p
	}
	if bannerUpdatedAt != nil {
		p := fmt.Sprintf("/uploads/%s/banner.jpg", userID)
		bannerPath = &p
	}

	c.JSON(http.StatusOK, gin.H{
		"avatar_updated_at": avatarUpdatedAt,
		"banner_updated_at": bannerUpdatedAt,
		"avatar_path":       avatarPath,
		"banner_path":       bannerPath,
	})
}

// uploadImage gère l'upload d'un fichier image (avatar ou banner).
func (h *ProfileHandler) uploadImage(c *gin.Context, kind string) {
	userID := c.GetString("user_id")

	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no file provided"})
		return
	}

	dir := filepath.Join(h.uploadDir, userID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create upload directory"})
		return
	}

	dst := filepath.Join(dir, kind+".jpg")
	if err := c.SaveUploadedFile(file, dst); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save file"})
		return
	}

	now := time.Now().UTC().Format(time.RFC3339)
	if kind == "avatar" {
		h.db.Exec(`UPDATE users SET avatar_updated_at = ? WHERE id = ?`, now, userID)
	} else {
		h.db.Exec(`UPDATE users SET banner_updated_at = ? WHERE id = ?`, now, userID)
	}

	c.JSON(http.StatusOK, gin.H{
		"path":       fmt.Sprintf("/uploads/%s/%s.jpg", userID, kind),
		"updated_at": now,
	})
}

func (h *ProfileHandler) UploadAvatar(c *gin.Context) { h.uploadImage(c, "avatar") }
func (h *ProfileHandler) UploadBanner(c *gin.Context) { h.uploadImage(c, "banner") }
