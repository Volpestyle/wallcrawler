package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/ecs"
	"github.com/wallcrawler/go-lambda/internal/handlers"
	"github.com/wallcrawler/go-lambda/internal/middleware"
	"github.com/wallcrawler/go-lambda/internal/validation"
	shared "github.com/wallcrawler/go-shared"
)

// Request/Response types
type CreateSessionRequest struct {
	BrowserSettings map[string]interface{} `json:"browserSettings,omitempty"`
	Timeout         int                    `json:"timeout,omitempty"`
}

type SessionData struct {
	SessionID  string `json:"sessionId"`
	ConnectURL string `json:"connectUrl"`
	Token      string `json:"token"`
	Available  bool   `json:"available"`
}

// Global clients
var (
	ecsClient   *ecs.Client
	redisClient *shared.RedisClient
)

func init() {
	// Initialize AWS SDK
	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		log.Fatalf("Failed to load AWS config: %v", err)
	}

	ecsClient = ecs.NewFromConfig(cfg)
	redisClient = shared.NewRedisClient()
}

func main() {
	lambda.Start(handler)
}

func handler(ctx context.Context, event events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// 🛡️ Use internal/middleware for Lambda-specific validation
	middleware.LogRequest(event, "create-session")

	// Validate request structure
	if err := validation.ValidateCreateSessionRequest(event); err != nil {
		return handlers.LambdaErrorResponse(400, "Invalid request", err.Error()), nil
	}

	// Validate API key using internal middleware
	apiKey, errResp := middleware.ValidateAPIKey(event)
	if errResp != nil {
		return *errResp, nil
	}

	// Parse request body using internal middleware
	var req CreateSessionRequest
	if errResp := middleware.ParseRequestBody(event, &req); errResp != nil {
		return *errResp, nil
	}

	// 🔧 Use internal/validation for request-specific validation
	if err := validation.ValidateBrowserSettings(req.BrowserSettings); err != nil {
		return handlers.LambdaErrorResponse(400, "Invalid browser settings", err.Error()), nil
	}

	if req.Timeout == 0 {
		req.Timeout = 300 // 5 minutes default
	}
	if err := validation.ValidateTimeout(req.Timeout); err != nil {
		return handlers.LambdaErrorResponse(400, "Invalid timeout", err.Error()), nil
	}

	// 🌐 Use go-shared for cross-module utilities
	userID := fmt.Sprintf("user_%s", apiKey[:8])
	sessionID := shared.GenerateSessionID()

	// Create session using go-shared types
	session := &shared.Session{
		ID:           sessionID,
		UserID:       userID,
		Status:       "initializing",
		CreatedAt:    time.Now(),
		LastActivity: time.Now(),
		Options: shared.SessionOptions{
			Viewport: &shared.Viewport{
				Width:  1920,
				Height: 1080,
			},
		},
	}

	// Store session using go-shared Redis utilities
	if err := redisClient.StoreSession(ctx, sessionID, session); err != nil {
		log.Printf("Failed to store session: %v", err)
		return handlers.LambdaErrorResponse(500, "Failed to create session", err.Error()), nil
	}

	// Create JWT token using go-shared utilities
	token, err := shared.CreateJWTToken(sessionID, userID, req.BrowserSettings, req.Timeout/60)
	if err != nil {
		log.Printf("Failed to create token: %v", err)
		return handlers.LambdaErrorResponse(500, "Failed to create token", err.Error()), nil
	}

	// Start ECS task (implementation details omitted for brevity)
	if err := startECSTask(ctx, sessionID); err != nil {
		log.Printf("Failed to start ECS task: %v", err)
		return handlers.LambdaErrorResponse(500, "Failed to start browser session", err.Error()), nil
	}

	// Build connection URL using go-shared utilities
	connectURL := shared.BuildConnectURL(sessionID, token)

	// Create response data
	responseData := SessionData{
		SessionID:  sessionID,
		ConnectURL: connectURL,
		Token:      token,
		Available:  true,
	}

	// 📦 Use internal/handlers for Lambda-specific response formatting
	return handlers.LambdaSuccessResponse(responseData), nil
}

// startECSTask placeholder - implement ECS task starting logic
func startECSTask(ctx context.Context, sessionID string) error {
	// TODO: Implement ECS task starting logic
	log.Printf("Starting ECS task for session: %s", sessionID)
	return nil
}
