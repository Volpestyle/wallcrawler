package main

import (
	"context"
	"log"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/wallcrawler/go-lambda/internal/handlers"
	"github.com/wallcrawler/go-lambda/internal/middleware"
	"github.com/wallcrawler/go-lambda/internal/validation"
	shared "github.com/wallcrawler/go-shared"
)

// SessionResponse represents the session data response
type SessionResponse struct {
	ID           string                 `json:"id"`
	UserID       string                 `json:"userId"`
	Status       string                 `json:"status"`
	CreatedAt    string                 `json:"createdAt"`
	LastActivity string                 `json:"lastActivity"`
	ConnectURL   string                 `json:"connectUrl,omitempty"`
	Available    bool                   `json:"available"`
	Options      map[string]interface{} `json:"options,omitempty"`
}

// Global clients
var (
	redisClient *shared.RedisClient
)

func init() {
	redisClient = shared.NewRedisClient()
}

func main() {
	lambda.Start(handler)
}

func handler(ctx context.Context, event events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// 🛡️ Use internal/middleware for Lambda-specific validation
	middleware.LogRequest(event, "get-session")

	// Validate API key using internal middleware
	_, errResp := middleware.ValidateAPIKey(event)
	if errResp != nil {
		return *errResp, nil
	}

	// Extract session ID from path parameters
	sessionID := event.PathParameters["sessionId"]
	if err := validation.ValidateSessionID(sessionID); err != nil {
		return handlers.LambdaErrorResponse(400, "Invalid session ID", err.Error()), nil
	}

	// 🌐 Use go-shared for Redis operations
	session, err := redisClient.GetSession(ctx, sessionID)
	if err != nil {
		log.Printf("Failed to get session %s: %v", sessionID, err)
		return handlers.LambdaErrorResponse(404, "Session not found"), nil
	}

	// Check if session exists
	if session == nil {
		return handlers.LambdaErrorResponse(404, "Session not found"), nil
	}

	// Build connect URL if session is active
	var connectURL string
	if session.Status == "active" || session.Status == "initializing" {
		// Generate a new JWT token for connection
		token, err := shared.CreateJWTToken(sessionID, session.UserID, nil, 60)
		if err != nil {
			log.Printf("Failed to create token for session %s: %v", sessionID, err)
		} else {
			connectURL = shared.BuildConnectURL(sessionID, token)
		}
	}

	// Create response
	response := SessionResponse{
		ID:           session.ID,
		UserID:       session.UserID,
		Status:       session.Status,
		CreatedAt:    shared.FormatTime(session.CreatedAt),
		LastActivity: shared.FormatTime(session.LastActivity),
		ConnectURL:   connectURL,
		Available:    session.Status == "active",
		Options:      map[string]interface{}{}, // Convert from SessionOptions if needed
	}

	// 📦 Use internal/handlers for Lambda-specific response formatting
	return handlers.LambdaSuccessResponse(response), nil
}
