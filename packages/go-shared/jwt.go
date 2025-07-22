package shared

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// CreateJWTToken creates a JWT token for a session
func CreateJWTToken(sessionID, userID string, browserSettings map[string]interface{}, timeoutMinutes int) (string, error) {
	now := time.Now()
	claims := JWTClaims{
		SessionID:       sessionID,
		UserID:          userID,
		BrowserSettings: browserSettings,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Duration(timeoutMinutes) * time.Minute)),
			Subject:   userID,
			Audience:  []string{"wallcrawler"},
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	secret := GetJWESecret()
	return token.SignedString([]byte(secret))
}

// ValidateJWTToken validates a JWT token and returns the claims
func ValidateJWTToken(tokenString string) (*JWTClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &JWTClaims{}, func(token *jwt.Token) (interface{}, error) {
		// Validate signing method
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}

		secret := GetJWESecret()
		return []byte(secret), nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to parse token: %w", err)
	}

	if claims, ok := token.Claims.(*JWTClaims); ok && token.Valid {
		if claims.SessionID == "" {
			return nil, fmt.Errorf("session ID not found in token")
		}
		return claims, nil
	}

	return nil, fmt.Errorf("invalid token claims")
}

// ValidateJWTTokenSimple validates a JWT token and returns just the session ID
func ValidateJWTTokenSimple(tokenString string) (string, error) {
	claims, err := ValidateJWTToken(tokenString)
	if err != nil {
		return "", err
	}
	return claims.SessionID, nil
}

// ExtractTokenFromQuery extracts JWT token from query parameters
func ExtractTokenFromQuery(query string) string {
	if query == "" {
		return ""
	}
	
	pairs := SplitString(query, "&")
	for _, pair := range pairs {
		kv := SplitString(pair, "=")
		if len(kv) == 2 && kv[0] == "token" {
			return kv[1]
		}
	}
	
	return ""
}

// ExtractTokenFromAuthHeader extracts JWT token from Authorization header
func ExtractTokenFromAuthHeader(authHeader string) string {
	if authHeader == "" {
		return ""
	}
	
	if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
		return authHeader[7:]
	}
	
	return ""
}

// ExtractTokenFromHeaders extracts JWT token from headers map
func ExtractTokenFromHeaders(headers map[string]string) string {
	// Check Authorization header (lowercase)
	if auth, ok := headers["authorization"]; ok {
		return ExtractTokenFromAuthHeader(auth)
	}
	
	// Check Authorization header (capitalized)
	if auth, ok := headers["Authorization"]; ok {
		return ExtractTokenFromAuthHeader(auth)
	}
	
	return ""
}

// IsTokenExpired checks if a JWT token is expired
func IsTokenExpired(claims *JWTClaims) bool {
	if claims.ExpiresAt == nil {
		return false
	}
	return time.Now().After(claims.ExpiresAt.Time)
}

// GetTokenRemainingTime returns the remaining time until token expiration
func GetTokenRemainingTime(claims *JWTClaims) time.Duration {
	if claims.ExpiresAt == nil {
		return 0
	}
	remaining := time.Until(claims.ExpiresAt.Time)
	if remaining < 0 {
		return 0
	}
	return remaining
}

// RefreshToken creates a new token with extended expiration
func RefreshToken(oldClaims *JWTClaims, newTimeoutMinutes int) (string, error) {
	return CreateJWTToken(
		oldClaims.SessionID,
		oldClaims.UserID,
		oldClaims.BrowserSettings,
		newTimeoutMinutes,
	)
} 