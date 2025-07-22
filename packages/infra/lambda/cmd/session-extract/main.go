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

// ExtractRequest represents the request body for extract operations
type ExtractRequest struct {
	Selector         string                 `json:"selector,omitempty"`
	SchemaDefinition map[string]interface{} `json:"schemaDefinition,omitempty"`
	Instruction      string                 `json:"instruction,omitempty"`
	UseVision        bool                   `json:"useVision,omitempty"`
}

// ExtractResult represents the result of an extract operation
type ExtractResult struct {
	Success    bool                   `json:"success"`
	Data       map[string]interface{} `json:"data,omitempty"`
	RawData    interface{}            `json:"rawData,omitempty"`
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
	middleware.LogRequest(event, "session-extract")

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
	var req ExtractRequest
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

	// Execute the extraction
	startTime := time.Now()
	result, err := executeExtract(ctx, sessionID, &req)
	duration := time.Since(startTime).Seconds()

	if err != nil {
		log.Printf("Failed to execute extract for session %s: %v", sessionID, err)
		result = &ExtractResult{
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
	return handlers.LambdaSuccessResponse(result), nil
}

// executeExtract executes the extract operation
func executeExtract(ctx context.Context, sessionID string, req *ExtractRequest) (*ExtractResult, error) {
	// TODO: Implement actual browser extraction logic
	// This should:
	// 1. Get the browser container endpoint from Redis
	// 2. Send CDP commands to extract data from the page
	// 3. Parse the data according to the schema
	// 4. Return the structured result

	log.Printf("Executing extract for session %s: selector=%s, instruction=%s",
		sessionID, req.Selector, req.Instruction)

	// Simulate processing time
	time.Sleep(150 * time.Millisecond)

	// Return a mock result for now
	result := &ExtractResult{
		Success: true,
		Data: map[string]interface{}{
			"title":       "Mock Page Title",
			"description": "Mock page description extracted from the page",
			"links":       []string{"https://example.com/link1", "https://example.com/link2"},
			"images":      []string{"https://example.com/image1.jpg"},
		},
		RawData:    "Mock raw HTML content or text",
		Screenshot: "", // Base64 encoded screenshot would go here
		Logs: []string{
			"Starting data extraction",
			"Analyzing page structure",
			"Extracting data using schema",
			"Data extraction completed successfully",
		},
	}

	return result, nil
}
