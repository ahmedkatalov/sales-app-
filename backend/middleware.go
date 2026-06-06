package main

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"strings"
)

// tokenFromRequest извлекает Bearer-токен из заголовка Authorization
// или из query-параметра ?token= (удобно для отладки).
func tokenFromRequest(c *gin.Context) string {
	auth := c.GetHeader("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	return c.Query("token")
}

// authRequired — middleware, который проверяет токен и кладёт userID в контекст.
// При ошибке сразу возвращает 401 и прерывает цепочку.
func authRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := tokenFromRequest(c)
		if token == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Требуется авторизация"})
			return
		}

		userID, ok := lookupSession(token)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Сессия устарела, войдите снова"})
			return
		}

		// Кладём userID в контекст Gin — helpers.go читает его через c.GetInt("authedUserID")
		c.Set("authedUserID", userID)
		c.Next()
	}
}
