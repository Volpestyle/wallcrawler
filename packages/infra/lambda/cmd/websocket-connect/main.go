package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"
)

// Environment variables
var (
	JWESecretARN  = os.Getenv("JWE_SECRET_ARN")
	RedisEndpoint = os.Getenv("REDIS_ENDPOINT")
)

// JWT Claims structure
type JWTClaims struct {
	SessionID string `json:"sessionId"`
	UserID    string `json:"userId"`
	jwt.RegisteredClaims
}

// Connection mapping structure
type ConnectionMapping struct {
	SessionID    string `json:"sessionId"`
	ConnectedAt  string `json:"connectedAt"`
	LastActivity string `json:"lastActivity"`
}

// Global Redis client
var redisClient *redis.Client

func init() {
	// Initialize Redis client
	redisClient = redis.NewClient(&redis.Options{
		Addr:     fmt.Sprintf("%s:6379", RedisEndpoint),
		Password: os.Getenv("REDIS_PASSWORD"),
		DB:       0,
	})
}

func main() {
	lambda.Start(handler)
}

func handler(ctx context.Context, event events.APIGatewayWebsocketProxyRequest) (events.APIGatewayProxyResponse, error) {
	log.Printf("WebSocket Connect Event: %+v", event)

	connectionID := event.RequestContext.ConnectionID

	// Extract token from query parameters or headers
	token := extractToken(event)
	if token == "" {
		log.Println("No token provided in connection request")
		return events.APIGatewayProxyResponse{
			StatusCode: 401,
			Body:       `{"error": "Authentication token required"}`,
		}, nil
	}

	// Check if client is requesting immediate streaming (for screencast)
	requestStream := false
	if event.QueryStringParameters != nil {
		if streamParam, ok := event.QueryStringParameters["requestStream"]; ok && streamParam == "true" {
			requestStream = true
		}
	}

	// Validate token and extract session ID
	sessionID, err := validateToken(token)
	if err != nil {
		log.Printf("Token validation failed: %v", err)
		return events.APIGatewayProxyResponse{
			StatusCode: 401,
			Body:       fmt.Sprintf(`{"error": "Invalid token: %s"}`, err.Error()),
		}, nil
	}

	log.Printf("Valid token for session: %s", sessionID)

	// Store connection mapping in Redis
	connectionMapping := ConnectionMapping{
		SessionID:    sessionID,
		ConnectedAt:  time.Now().Format(time.RFC3339),
		LastActivity: time.Now().Format(time.RFC3339),
	}

	// Set connection mapping with TTL (1 hour)
	mappingJSON, err := json.Marshal(connectionMapping)
	if err != nil {
		log.Printf("Failed to marshal connection mapping: %v", err)
		return events.APIGatewayProxyResponse{
			StatusCode: 500,
			Body:       `{"error": "Internal server error"}`,
		}, nil
	}

	if err := redisClient.SetEx(ctx, fmt.Sprintf("connection:%s", connectionID), string(mappingJSON), time.Hour).Err(); err != nil {
		log.Printf("Failed to store connection mapping: %v", err)
		return events.APIGatewayProxyResponse{
			StatusCode: 500,
			Body:       `{"error": "Failed to store connection"}`,
		}, nil
	}

	// Add connection to session's connection set
	if err := redisClient.SAdd(ctx, fmt.Sprintf("session:%s:connections", sessionID), connectionID).Err(); err != nil {
		log.Printf("Failed to add connection to session set: %v", err)
	}

	if err := redisClient.Expire(ctx, fmt.Sprintf("session:%s:connections", sessionID), time.Hour).Err(); err != nil {
		log.Printf("Failed to set session connections TTL: %v", err)
	}

	// Update session last activity
	if err := redisClient.HSet(ctx, fmt.Sprintf("session:%s", sessionID), "lastActivity", time.Now().Format(time.RFC3339)).Err(); err != nil {
		log.Printf("Failed to update session activity: %v", err)
	}

	// If immediate streaming requested, set up for screencast
	if requestStream {
		if err := setupScreencastStreaming(ctx, sessionID, connectionID); err != nil {
			log.Printf("Failed to setup screencast streaming: %v", err)
			// Don't fail the connection, just log the error
		}
	}

	log.Printf("WebSocket connection established: %s for session %s", connectionID, sessionID)

	return events.APIGatewayProxyResponse{
		StatusCode: 200,
		Body:       `{"status": "connected"}`,
	}, nil
}

// extractToken extracts JWT token from query parameters or headers
func extractToken(event events.APIGatewayWebsocketProxyRequest) string {
	// Try query parameters first
	if event.QueryStringParameters != nil {
		if token, ok := event.QueryStringParameters["token"]; ok {
			return token
		}
	}

	// Try headers
	if event.Headers != nil {
		// Check Authorization header
		if auth, ok := event.Headers["authorization"]; ok {
			if len(auth) > 7 && auth[:7] == "Bearer " {
				return auth[7:]
			}
		}

		// Check Authorization header with capital A
		if auth, ok := event.Headers["Authorization"]; ok {
			if len(auth) > 7 && auth[:7] == "Bearer " {
				return auth[7:]
			}
		}
	}

	return ""
}

// validateToken validates JWT token and returns session ID
func validateToken(tokenString string) (string, error) {
	token, err := jwt.ParseWithClaims(tokenString, &JWTClaims{}, func(token *jwt.Token) (interface{}, error) {
		// Validate signing method
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}

		// In production, get the secret from AWS Secrets Manager
		secret := getEnvDefault("JWE_SECRET", "development-secret")
		return []byte(secret), nil
	})

	if err != nil {
		return "", fmt.Errorf("failed to parse token: %w", err)
	}

	if claims, ok := token.Claims.(*JWTClaims); ok && token.Valid {
		if claims.SessionID == "" {
			return "", fmt.Errorf("session ID not found in token")
		}
		return claims.SessionID, nil
	}

	return "", fmt.Errorf("invalid token claims")
}

// setupScreencastStreaming sets up immediate screencast streaming
func setupScreencastStreaming(ctx context.Context, sessionID, connectionID string) error {
	// Mark this connection as a screencast stream
	streamingData := map[string]interface{}{
		"type":         "screencast",
		"sessionId":    sessionID,
		"connectionId": connectionID,
		"startedAt":    time.Now().Format(time.RFC3339),
	}

	streamingJSON, err := json.Marshal(streamingData)
	if err != nil {
		return fmt.Errorf("failed to marshal streaming data: %w", err)
	}

	// Store with shorter TTL for streaming connections
	if err := redisClient.SetEx(ctx, fmt.Sprintf("streaming:%s", connectionID), string(streamingJSON), 30*time.Minute).Err(); err != nil {
		return fmt.Errorf("failed to store streaming data: %w", err)
	}

	// Add to session's streaming connections
	if err := redisClient.SAdd(ctx, fmt.Sprintf("session:%s:streaming", sessionID), connectionID).Err(); err != nil {
		return fmt.Errorf("failed to add to streaming set: %w", err)
	}

	if err := redisClient.Expire(ctx, fmt.Sprintf("session:%s:streaming", sessionID), 30*time.Minute).Err(); err != nil {
		log.Printf("Failed to set streaming set TTL: %v", err)
	}

	log.Printf("Set up screencast streaming for session %s, connection %s", sessionID, connectionID)
	return nil
}

// getEnvDefault gets environment variable with default value
func getEnvDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
