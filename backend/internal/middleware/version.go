package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// RequiredAppVersion est la version minimale que le client doit avoir.
// Mettez à jour cette valeur à chaque release pour forcer la mise à jour.
const RequiredAppVersion = "1.6.3"

// VersionCheck vérifie que le client envoie bien le header X-App-Version
// et que la version correspond à RequiredAppVersion.
// Retourne 426 Upgrade Required si ce n'est pas le cas.
func VersionCheck() gin.HandlerFunc {
	return func(c *gin.Context) {
		version := c.GetHeader("X-App-Version")
		if version != RequiredAppVersion {
			c.JSON(http.StatusUpgradeRequired, gin.H{"error": "update_required"})
			c.Abort()
			return
		}
		c.Next()
	}
}
