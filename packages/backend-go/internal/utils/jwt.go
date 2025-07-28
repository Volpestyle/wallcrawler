package utils

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
	"github.com/golang-jwt/jwt/v5"
)

// CDPSigningPayload represents the data structure for CDP access tokens
type CDPSigningPayload struct {
	SessionID string `json:"sessionId"`
	ProjectID string `json:"projectId"`
	UserID    string `json:"userId,omitempty"`
	IssuedAt  int64  `json:"iat"`
	ExpiresAt int64  `json:"exp"`
	Nonce     string `json:"nonce"`
	IPAddress string `json:"ipAddress,omitempty"`
}

// CDPTokenClaims extends jwt.RegisteredClaims with our custom fields
type CDPTokenClaims struct {
	jwt.RegisteredClaims
	SessionID string `json:"sessionId"`
	ProjectID string `json:"projectId"`
	UserID    string `json:"userId,omitempty"`
	Nonce     string `json:"nonce"`
	IPAddress string `json:"ipAddress,omitempty"`
}

// SecretValue represents the structure of our JWT secret in Secrets Manager
type SecretValue struct {
	Algorithm  string `json:"algorithm"`
	SigningKey string `json:"signingKey"`
}

var (
	// Cache for the JWT signing key to avoid repeated Secrets Manager calls
	jwtSigningKey  []byte
	keyCache       sync.RWMutex
	keyLastFetched time.Time
	keyTTL         = 5 * time.Minute // Cache key for 5 minutes
	secretsClient  *secretsmanager.Client
	initOnce       sync.Once
)

// initSecretsManager initializes the AWS Secrets Manager client
func initSecretsManager() {
	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		fmt.Printf("Error loading AWS config: %v\n", err)
		return
	}
	secretsClient = secretsmanager.NewFromConfig(cfg)
}

// GetJWTSecretKey retrieves the JWT signing secret key with caching
func GetJWTSecretKey() ([]byte, error) {
	initOnce.Do(initSecretsManager)

	keyCache.RLock()
	if jwtSigningKey != nil && time.Since(keyLastFetched) < keyTTL {
		key := make([]byte, len(jwtSigningKey))
		copy(key, jwtSigningKey)
		keyCache.RUnlock()
		return key, nil
	}
	keyCache.RUnlock()

	// Try environment variable first (for development override)
	if envKey := os.Getenv("WALLCRAWLER_JWT_SIGNING_KEY"); envKey != "" {
		keyCache.Lock()
		jwtSigningKey = []byte(envKey)
		keyLastFetched = time.Now()
		keyCache.Unlock()
		return []byte(envKey), nil
	}

	// Get secret ARN from environment
	secretArn := os.Getenv("WALLCRAWLER_JWT_SIGNING_SECRET_ARN")
	if secretArn == "" {
		return nil, fmt.Errorf("WALLCRAWLER_JWT_SIGNING_SECRET_ARN environment variable not set")
	}

	if secretsClient == nil {
		return nil, fmt.Errorf("secrets manager client not initialized")
	}

	// Fetch from Secrets Manager
	input := &secretsmanager.GetSecretValueInput{
		SecretId: aws.String(secretArn),
	}

	result, err := secretsClient.GetSecretValue(context.TODO(), input)
	if err != nil {
		return nil, fmt.Errorf("error fetching JWT signing key from Secrets Manager: %v", err)
	}

	// Parse the secret value
	var secretValue SecretValue
	if err := json.Unmarshal([]byte(*result.SecretString), &secretValue); err != nil {
		return nil, fmt.Errorf("error parsing secret value: %v", err)
	}

	if secretValue.SigningKey == "" {
		return nil, fmt.Errorf("signing key not found in secret")
	}

	// Cache the key
	keyCache.Lock()
	jwtSigningKey = []byte(secretValue.SigningKey)
	keyLastFetched = time.Now()
	keyCache.Unlock()

	return []byte(secretValue.SigningKey), nil
}

// GenerateRandomNonce creates a cryptographically secure random nonce
func GenerateRandomNonce() string {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		// Fallback to timestamp-based nonce if crypto rand fails
		return fmt.Sprintf("nonce_%d", time.Now().UnixNano())
	}
	return fmt.Sprintf("%x", bytes)
}

// CreateCDPToken generates a signed JWT token for CDP access
func CreateCDPToken(payload CDPSigningPayload) (string, error) {
	signingKey, err := GetJWTSecretKey()
	if err != nil {
		return "", fmt.Errorf("error getting JWT signing key: %v", err)
	}

	// Set token expiration if not provided (default 10 minutes)
	if payload.ExpiresAt == 0 {
		payload.ExpiresAt = time.Now().Add(10 * time.Minute).Unix()
	}

	// Set issued at time if not provided
	if payload.IssuedAt == 0 {
		payload.IssuedAt = time.Now().Unix()
	}

	// Generate nonce if not provided
	if payload.Nonce == "" {
		payload.Nonce = GenerateRandomNonce()
	}

	// Create the claims
	claims := CDPTokenClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "wallcrawler",
			Subject:   payload.SessionID,
			Audience:  []string{"cdp-access"},
			ExpiresAt: jwt.NewNumericDate(time.Unix(payload.ExpiresAt, 0)),
			IssuedAt:  jwt.NewNumericDate(time.Unix(payload.IssuedAt, 0)),
			NotBefore: jwt.NewNumericDate(time.Now()),
			ID:        payload.Nonce,
		},
		SessionID: payload.SessionID,
		ProjectID: payload.ProjectID,
		UserID:    payload.UserID,
		Nonce:     payload.Nonce,
		IPAddress: payload.IPAddress,
	}

	// Create token with claims
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)

	// Sign and get the complete encoded token as a string
	tokenString, err := token.SignedString(signingKey)
	if err != nil {
		return "", fmt.Errorf("error signing token: %v", err)
	}

	return tokenString, nil
}

// ValidateCDPToken validates and parses a CDP access token
func ValidateCDPToken(tokenString string) (*CDPSigningPayload, error) {
	signingKey, err := GetJWTSecretKey()
	if err != nil {
		return nil, fmt.Errorf("error getting JWT signing key: %v", err)
	}

	// Parse the token
	token, err := jwt.ParseWithClaims(tokenString, &CDPTokenClaims{}, func(token *jwt.Token) (interface{}, error) {
		// Validate the signing method
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return signingKey, nil
	})

	if err != nil {
		return nil, fmt.Errorf("error parsing token: %v", err)
	}

	// Validate token and extract claims
	if claims, ok := token.Claims.(*CDPTokenClaims); ok && token.Valid {
		// Additional validations
		now := time.Now()

		// Check expiration
		if claims.ExpiresAt != nil && claims.ExpiresAt.Before(now) {
			return nil, fmt.Errorf("token has expired")
		}

		// Check not before
		if claims.NotBefore != nil && claims.NotBefore.After(now) {
			return nil, fmt.Errorf("token not yet valid")
		}

		// Check required fields
		if claims.SessionID == "" {
			return nil, fmt.Errorf("missing session ID in token")
		}

		if claims.ProjectID == "" {
			return nil, fmt.Errorf("missing project ID in token")
		}

		// Convert back to CDPSigningPayload
		payload := &CDPSigningPayload{
			SessionID: claims.SessionID,
			ProjectID: claims.ProjectID,
			UserID:    claims.UserID,
			IssuedAt:  claims.IssuedAt.Unix(),
			ExpiresAt: claims.ExpiresAt.Unix(),
			Nonce:     claims.Nonce,
			IPAddress: claims.IPAddress,
		}

		return payload, nil
	}

	return nil, fmt.Errorf("invalid token claims")
}

// GenerateSignedCDPURL creates a signed CDP WebSocket URL
func GenerateSignedCDPURL(sessionID, projectID, userID, clientIP string) (string, error) {
	payload := CDPSigningPayload{
		SessionID: sessionID,
		ProjectID: projectID,
		UserID:    userID,
		IssuedAt:  time.Now().Unix(),
		ExpiresAt: time.Now().Add(10 * time.Minute).Unix(),
		Nonce:     GenerateRandomNonce(),
		IPAddress: clientIP,
	}

	token, err := CreateCDPToken(payload)
	if err != nil {
		return "", err
	}

	// For now, return the WebSocket URL with the token
	// Later this will point to our authenticated CDP proxy
	return fmt.Sprintf("ws://localhost:9223/cdp?signingKey=%s", token), nil
}

// ParseSigningKeyFromURL extracts and validates the signing key from a URL
func ParseSigningKeyFromURL(url string) (*CDPSigningPayload, error) {
	// Simple extraction - in a real implementation you'd parse the URL properly
	// For now, assume format: ws://host:port/path?signingKey=TOKEN

	// This is a placeholder - implement proper URL parsing
	return nil, fmt.Errorf("URL parsing not yet implemented")
}
