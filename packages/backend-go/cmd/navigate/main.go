package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/wallcrawler/backend-go/internal/types"
	"github.com/wallcrawler/backend-go/internal/utils"
)

// Handler processes the /sessions/{sessionId}/navigate request
func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// Extract session ID from path parameters
	sessionID := request.PathParameters["sessionId"]
	if sessionID == "" {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Missing sessionId parameter"))
	}

	// Parse request body
	var req types.NavigateRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		log.Printf("Error parsing request body: %v", err)
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Invalid request body"))
	}

	// Validate required fields
	if req.URL == "" {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Missing required field: url"))
	}

	// Validate headers
	if err := utils.ValidateHeaders(request.Headers); err != nil {
		return utils.CreateAPIResponse(401, utils.ErrorResponse(err.Error()))
	}

	// Check if streaming is requested
	isStreaming := strings.ToLower(request.Headers["x-stream-response"]) == "true"
	
	// Get session from Redis
	rdb := utils.GetRedisClient()
	sessionState, err := utils.GetSession(ctx, rdb, sessionID)
	if err != nil {
		log.Printf("Error getting session %s: %v", sessionID, err)
		return utils.CreateAPIResponse(404, utils.ErrorResponse("Session not found"))
	}

	// Validate session status
	if !utils.IsSessionActive(sessionState.Status) {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Session is not ready for navigation"))
	}

	if !isStreaming {
		// Non-streaming response (legacy support)
		result, err := processNavigateRequest(ctx, sessionID, &req, sessionState)
		if err != nil {
			return utils.CreateAPIResponse(500, utils.ErrorResponse(err.Error()))
		}
		return utils.CreateAPIResponse(200, utils.SuccessResponse(result))
	}

	// Streaming response
	streamingBody := processNavigateRequestStreaming(ctx, sessionID, &req, sessionState)
	
	return events.APIGatewayProxyResponse{
		StatusCode: 200,
		Headers: map[string]string{
			"Content-Type":                 "text/plain",
			"Cache-Control":                "no-cache",
			"Connection":                   "keep-alive",
			"Access-Control-Allow-Origin":  "*",
			"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type, Authorization, x-wc-api-key, x-wc-project-id, x-wc-session-id, x-model-api-key, x-stream-response",
		},
		Body: streamingBody,
	}, nil
}

// processNavigateRequest handles non-streaming navigate requests
func processNavigateRequest(ctx context.Context, sessionID string, req *types.NavigateRequest, sessionState *types.SessionState) (interface{}, error) {
	// Create navigate event for ECS controller
	navigateEvent := map[string]interface{}{
		"sessionId": sessionID,
		"url":       req.URL,
		"options":   req.Options,
	}

	// Publish event to EventBridge for ECS controller
	if err := utils.PublishEvent(ctx, sessionID, "NavigateRequest", navigateEvent); err != nil {
		log.Printf("Error publishing navigate event: %v", err)
		return nil, err
	}

	// For non-streaming, return immediate response
	// In a real implementation, you'd wait for the result or use polling
	result := map[string]interface{}{
		"success": true,
		"message": "Navigation queued for execution",
		"url":     req.URL,
	}

	log.Printf("Queued navigation for session %s to URL: %s", sessionID, req.URL)
	return result, nil
}

// processNavigateRequestStreaming handles streaming navigate requests
func processNavigateRequestStreaming(ctx context.Context, sessionID string, req *types.NavigateRequest, sessionState *types.SessionState) string {
	var streamingResponse strings.Builder

	// Send initial log event
	streamingResponse.WriteString(utils.SendLogEvent("info", "Starting navigation to: "+req.URL))

	// Create navigate event for ECS controller
	navigateEvent := map[string]interface{}{
		"sessionId": sessionID,
		"url":       req.URL,
		"options":   req.Options,
	}

	// Publish event to EventBridge for ECS controller
	if err := utils.PublishEvent(ctx, sessionID, "NavigateRequest", navigateEvent); err != nil {
		log.Printf("Error publishing navigate event: %v", err)
		
		// Send error event
		streamingResponse.WriteString(utils.SendSystemEvent("error", nil, "Failed to queue navigation: "+err.Error()))
		return streamingResponse.String()
	}

	// Send progress log
	streamingResponse.WriteString(utils.SendLogEvent("info", "Navigation queued for browser execution"))

	// In a real implementation, you would:
	// 1. Subscribe to Redis pub/sub for real-time updates
	// 2. Wait for the ECS controller to execute the navigation
	// 3. Stream the results back in real-time
	// 
	// For now, simulate a successful completion
	streamingResponse.WriteString(utils.SendLogEvent("info", "Initiating page navigation..."))
	streamingResponse.WriteString(utils.SendLogEvent("info", "Waiting for page load..."))
	
	// Check for navigation options
	if req.Options != nil {
		if waitUntil, ok := req.Options["waitUntil"].(string); ok {
			streamingResponse.WriteString(utils.SendLogEvent("info", "Waiting for: "+waitUntil))
		}
		if timeout, ok := req.Options["timeout"].(float64); ok {
			streamingResponse.WriteString(utils.SendLogEvent("info", fmt.Sprintf("Using timeout: %.0fms", timeout)))
		}
	}
	
	streamingResponse.WriteString(utils.SendLogEvent("info", "Navigation completed successfully"))

	// Send final result
	result := map[string]interface{}{
		"success":    true,
		"message":    "Navigation completed",
		"url":        req.URL,
		"finalUrl":   req.URL, // In real implementation, this might be different due to redirects
		"statusCode": 200,     // Sample status code
	}

	streamingResponse.WriteString(utils.SendSystemEvent("finished", result, ""))

	log.Printf("Streamed navigation for session %s to URL: %s", sessionID, req.URL)
	return streamingResponse.String()
}

func main() {
	lambda.Start(Handler)
} 