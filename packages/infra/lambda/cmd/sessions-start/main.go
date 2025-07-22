package main

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/wallcrawler/go-lambda/internal/handlers"
	"github.com/wallcrawler/go-lambda/internal/middleware"
	shared "github.com/wallcrawler/go-shared"
)

// StartSessionRequest represents the request body for starting a session (Stagehand format)
type StartSessionRequest struct {
	ModelName                      string                 `json:"modelName,omitempty"`
	DomSettleTimeoutMs             int                    `json:"domSettleTimeoutMs,omitempty"`
	Verbose                        bool                   `json:"verbose,omitempty"`
	DebugDom                       bool                   `json:"debugDom,omitempty"`
	SystemPrompt                   string                 `json:"systemPrompt,omitempty"`
	SelfHeal                       bool                   `json:"selfHeal,omitempty"`
	WaitForCaptchaSolves           bool                   `json:"waitForCaptchaSolves,omitempty"`
	ActionTimeoutMs                int                    `json:"actionTimeoutMs,omitempty"`
	BrowserbaseSessionCreateParams map[string]interface{} `json:"browserbaseSessionCreateParams,omitempty"`
	BrowserbaseSessionID           string                 `json:"browserbaseSessionID,omitempty"`
}

// StartSessionResponse represents the Stagehand-compatible response
type StartSessionResponse struct {
	SessionID string `json:"sessionId"`
	Available bool   `json:"available"`
}

// StagehandAPIResponse wraps the response in Stagehand's expected format
type StagehandAPIResponse struct {
	Success bool                 `json:"success"`
	Data    StartSessionResponse `json:"data,omitempty"`
	Message string               `json:"message,omitempty"`
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
	middleware.LogRequest(event, "sessions-start")

	// Parse request body
	var req StartSessionRequest
	if err := json.Unmarshal([]byte(event.Body), &req); err != nil {
		return createStagehandErrorResponse(400, "Invalid request body"), nil
	}

	// Extract user ID from Stagehand headers
	userID := event.Headers["x-bb-project-id"]
	if userID == "" {
		userID = "stagehand-user" // Default for Stagehand compatibility
	}

	// Create session options from Stagehand request
	options := shared.SessionOptions{
		Viewport: &shared.Viewport{
			Width:  1280,
			Height: 720,
		},
		UserAgent:    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
		Locale:       "en-US",
		TimezoneID:   "America/New_York",
		ExtraHeaders: make(map[string]string),
	}

	// 🌐 Use go-shared for session generation and storage
	sessionID := shared.GenerateSessionID()

	session := &shared.Session{
		ID:           sessionID,
		UserID:       userID,
		Status:       "initializing",
		CreatedAt:    time.Now(),
		LastActivity: time.Now(),
		Options:      options,
	}

	// Store session in Redis
	if err := redisClient.StoreSession(ctx, sessionID, session); err != nil {
		log.Printf("Failed to store session: %v", err)
		return createStagehandErrorResponse(500, "Failed to create session"), nil
	}

	// Start ECS task (placeholder - would call startECSTask function)
	if err := startECSTask(sessionID, options); err != nil {
		log.Printf("Failed to start ECS task: %v", err)
		// Update session status to failed
		session.Status = "failed"
		redisClient.StoreSession(ctx, sessionID, session)
		return createStagehandErrorResponse(500, "Failed to start browser container"), nil
	}

	// Create Stagehand-compatible response
	response := StagehandAPIResponse{
		Success: true,
		Data: StartSessionResponse{
			SessionID: sessionID,
			Available: true,
		},
	}

	return handlers.LambdaResponse(200, response), nil
}

// createStagehandErrorResponse creates a Stagehand-compatible error response
func createStagehandErrorResponse(statusCode int, message string) events.APIGatewayProxyResponse {
	response := StagehandAPIResponse{
		Success: false,
		Message: message,
	}
	return handlers.LambdaResponse(statusCode, response)
}

// startECSTask placeholder - reuse logic from create-session
func startECSTask(sessionID string, options shared.SessionOptions) error {
	// TODO: Implement ECS task creation logic
	// This should be similar to the startECSTask function in create-session
	log.Printf("Starting ECS task for session: %s", sessionID)
	return nil
}
