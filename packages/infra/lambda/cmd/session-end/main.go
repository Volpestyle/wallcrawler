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
	middleware.LogRequest(event, "session-end")

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

	if session == nil {
		return handlers.LambdaErrorResponse(404, "Session not found"), nil
	}

	// Update session status to ending
	session.Status = "ending"
	if err := redisClient.StoreSession(ctx, sessionID, session); err != nil {
		log.Printf("Failed to update session status: %v", err)
	}

	// Stop ECS task if running
	if err := stopECSTask(sessionID); err != nil {
		log.Printf("Failed to stop ECS task for session %s: %v", sessionID, err)
		// Continue with cleanup even if ECS task stop fails
	}

	// Clean up Redis data
	if err := redisClient.DeleteSession(ctx, sessionID); err != nil {
		log.Printf("Failed to delete session from Redis: %v", err)
		return handlers.LambdaErrorResponse(500, "Failed to clean up session"), nil
	}

	// Clean up any remaining connections
	connections, _ := redisClient.GetSessionConnections(ctx, sessionID)
	for _, connectionID := range connections {
		redisClient.DeleteConnection(ctx, connectionID)
		redisClient.RemoveConnectionFromSession(ctx, sessionID, connectionID)
	}

	log.Printf("Session %s ended successfully", sessionID)

	// 📦 Use internal/handlers for Lambda-specific response formatting
	return handlers.LambdaSuccessResponse(map[string]interface{}{
		"sessionId": sessionID,
		"status":    "ended",
		"message":   "Session ended successfully",
	}), nil
}

// stopECSTask stops the ECS task for a session
func stopECSTask(sessionID string) error {
	// TODO: Implement ECS task stopping logic
	// This should:
	// 1. Get the task ARN from Redis or environment
	// 2. Call ECS StopTask API
	// 3. Wait for task to stop (optional)
	log.Printf("Stopping ECS task for session: %s", sessionID)
	return nil
}
