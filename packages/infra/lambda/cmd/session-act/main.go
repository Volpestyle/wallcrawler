package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/wallcrawler/go-lambda/internal/handlers"
	"github.com/wallcrawler/go-lambda/internal/middleware"
	"github.com/wallcrawler/go-lambda/internal/validation"
	shared "github.com/wallcrawler/go-shared"
)

// ActRequest represents the request body for act operations
type ActRequest struct {
	Action      string                 `json:"action,omitempty"`
	Text        string                 `json:"text,omitempty"`
	Selector    string                 `json:"selector,omitempty"`
	URL         string                 `json:"url,omitempty"`
	Options     map[string]interface{} `json:"options,omitempty"`
	UseVision   bool                   `json:"useVision,omitempty"`
	DomSnapshot bool                   `json:"domSnapshot,omitempty"`
}

// ActResult represents the result of an act operation
type ActResult struct {
	Success    bool                   `json:"success"`
	Action     string                 `json:"action,omitempty"`
	Selector   string                 `json:"selector,omitempty"`
	Element    map[string]interface{} `json:"element,omitempty"`
	Screenshot string                 `json:"screenshot,omitempty"`
	Logs       []string               `json:"logs,omitempty"`
	Error      string                 `json:"error,omitempty"`
	Duration   float64                `json:"duration,omitempty"`
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
	middleware.LogRequest(event, "session-act")

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

	// Parse request body
	var req ActRequest
	if err := json.Unmarshal([]byte(event.Body), &req); err != nil {
		return handlers.LambdaErrorResponse(400, "Invalid request body", err.Error()), nil
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

	if session.Status != "active" {
		return handlers.LambdaErrorResponse(400, "Session is not active"), nil
	}

	// Update session activity
	redisClient.UpdateSessionActivity(ctx, sessionID)

	// Execute the action
	startTime := time.Now()
	result, err := executeAct(ctx, sessionID, &req)
	duration := time.Since(startTime).Seconds()

	if err != nil {
		log.Printf("Failed to execute act for session %s: %v", sessionID, err)
		result = &ActResult{
			Success:  false,
			Action:   req.Action,
			Error:    err.Error(),
			Duration: duration,
			Logs:     []string{fmt.Sprintf("Error: %v", err)},
		}
	} else {
		result.Duration = duration
	}

	// For now, return a simple response instead of streaming
	// TODO: Implement proper Server-Sent Events streaming when API Gateway supports it
	return handlers.LambdaSuccessResponse(result), nil
}

// executeAct executes the act operation
func executeAct(ctx context.Context, sessionID string, req *ActRequest) (*ActResult, error) {
	// TODO: Implement actual browser interaction logic
	// This should:
	// 1. Get the browser container endpoint from Redis
	// 2. Send CDP commands to perform the action
	// 3. Return the result with screenshots, logs, etc.

	log.Printf("Executing act for session %s: action=%s, text=%s, selector=%s",
		sessionID, req.Action, req.Text, req.Selector)

	// Simulate processing time
	time.Sleep(100 * time.Millisecond)

	// Return a mock result for now
	result := &ActResult{
		Success:  true,
		Action:   req.Action,
		Selector: req.Selector,
		Element: map[string]interface{}{
			"tagName": "div",
			"id":      "mock-element",
			"text":    req.Text,
		},
		Screenshot: "", // Base64 encoded screenshot would go here
		Logs: []string{
			"Starting action execution",
			fmt.Sprintf("Performing %s action", req.Action),
			"Action completed successfully",
		},
	}

	return result, nil
}
