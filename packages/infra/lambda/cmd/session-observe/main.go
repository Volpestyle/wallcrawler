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

// ObserveRequest represents the request body for observe operations
type ObserveRequest struct {
	Instruction string `json:"instruction,omitempty"`
	UseVision   bool   `json:"useVision,omitempty"`
	FullPage    bool   `json:"fullPage,omitempty"`
}

// ObserveResult represents the result of an observe operation
type ObserveResult struct {
	Selector    string                 `json:"selector"`
	Description string                 `json:"description"`
	Element     map[string]interface{} `json:"element,omitempty"`
	Confidence  float64                `json:"confidence,omitempty"`
	BoundingBox map[string]interface{} `json:"boundingBox,omitempty"`
}

// ObserveResponse represents the response containing multiple observe results
type ObserveResponse struct {
	Success    bool            `json:"success"`
	Results    []ObserveResult `json:"results,omitempty"`
	Screenshot string          `json:"screenshot,omitempty"`
	Logs       []string        `json:"logs,omitempty"`
	Error      string          `json:"error,omitempty"`
	Duration   float64         `json:"duration,omitempty"`
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
	middleware.LogRequest(event, "session-observe")

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
	var req ObserveRequest
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

	// Execute the observation
	startTime := time.Now()
	result, err := executeObserve(ctx, sessionID, &req)
	duration := time.Since(startTime).Seconds()

	if err != nil {
		log.Printf("Failed to execute observe for session %s: %v", sessionID, err)
		result = &ObserveResponse{
			Success:  false,
			Error:    err.Error(),
			Duration: duration,
			Logs:     []string{fmt.Sprintf("Error: %v", err)},
		}
	} else {
		result.Duration = duration
	}

	// For now, return a simple response instead of streaming
	// TODO: Implement proper Server-Sent Events streaming when API Gateway supports it
	return handlers.LambdaSuccessResponse(result.Results), nil // Stagehand expects array of results
}

// executeObserve executes the observe operation
func executeObserve(ctx context.Context, sessionID string, req *ObserveRequest) (*ObserveResponse, error) {
	// TODO: Implement actual browser observation logic
	// This should:
	// 1. Get the browser container endpoint from Redis
	// 2. Send CDP commands to analyze the page
	// 3. Identify interactive elements and their properties
	// 4. Return structured observation results

	log.Printf("Executing observe for session %s: instruction=%s, useVision=%t",
		sessionID, req.Instruction, req.UseVision)

	// Simulate processing time
	time.Sleep(200 * time.Millisecond)

	// Return mock observation results
	results := []ObserveResult{
		{
			Selector:    "#search-input",
			Description: "Search input field",
			Element: map[string]interface{}{
				"tagName":     "input",
				"type":        "text",
				"placeholder": "Search...",
				"visible":     true,
			},
			Confidence: 0.95,
			BoundingBox: map[string]interface{}{
				"x":      100,
				"y":      50,
				"width":  300,
				"height": 40,
			},
		},
		{
			Selector:    "#submit-btn",
			Description: "Submit button",
			Element: map[string]interface{}{
				"tagName": "button",
				"text":    "Submit",
				"visible": true,
			},
			Confidence: 0.90,
			BoundingBox: map[string]interface{}{
				"x":      420,
				"y":      50,
				"width":  80,
				"height": 40,
			},
		},
		{
			Selector:    ".nav-link",
			Description: "Navigation links",
			Element: map[string]interface{}{
				"tagName": "a",
				"count":   5,
				"visible": true,
			},
			Confidence: 0.85,
			BoundingBox: map[string]interface{}{
				"x":      0,
				"y":      0,
				"width":  800,
				"height": 30,
			},
		},
	}

	response := &ObserveResponse{
		Success:    true,
		Results:    results,
		Screenshot: "", // Base64 encoded screenshot would go here
		Logs: []string{
			"Starting page observation",
			"Analyzing DOM structure",
			"Identifying interactive elements",
			fmt.Sprintf("Found %d observable elements", len(results)),
			"Observation completed successfully",
		},
	}

	return response, nil
}
