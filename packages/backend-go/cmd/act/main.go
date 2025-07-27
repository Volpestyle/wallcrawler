package main

import (
	"context"
	"encoding/json"
	"log"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/wallcrawler/backend-go/internal/types"
	"github.com/wallcrawler/backend-go/internal/utils"
)

// Handler processes the /sessions/{sessionId}/act request
func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// Extract session ID from path parameters
	sessionID := request.PathParameters["sessionId"]
	if sessionID == "" {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Missing sessionId parameter"))
	}

	// Parse request body
	var req types.ActRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		log.Printf("Error parsing request body: %v", err)
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Invalid request body"))
	}

	// Validate required fields
	if req.Action == "" {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Missing required field: action"))
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
	if sessionState.Status != "RUNNING" {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Session is not in RUNNING state"))
	}

	if !isStreaming {
		// Non-streaming response (legacy support)
		result, err := processActRequest(ctx, sessionID, &req, sessionState)
		if err != nil {
			return utils.CreateAPIResponse(500, utils.ErrorResponse(err.Error()))
		}
		return utils.CreateAPIResponse(200, utils.SuccessResponse(result))
	}

	// Streaming response
	streamingBody := processActRequestStreaming(ctx, sessionID, &req, sessionState)
	
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

// processActRequest handles non-streaming act requests
func processActRequest(ctx context.Context, sessionID string, req *types.ActRequest, sessionState *types.SessionState) (*types.ActResult, error) {
	// Create action event for ECS controller
	actionEvent := map[string]interface{}{
		"sessionId": sessionID,
		"action":    req.Action,
		"variables": req.Variables,
		"iframes":   req.Iframes,
		"timeout":   req.TimeoutMs,
		"domSettle": req.DOMSettleTimeoutMs,
		"modelName": req.ModelName,
	}

	// Publish event to EventBridge for ECS controller
	if err := utils.PublishEvent(ctx, sessionID, "ActRequest", actionEvent); err != nil {
		log.Printf("Error publishing act event: %v", err)
		return nil, err
	}

	// For non-streaming, return immediate response
	// In a real implementation, you'd wait for the result or use polling
	result := &types.ActResult{
		Success: true,
		Message: "Action queued for execution",
		Action:  req.Action,
	}

	log.Printf("Queued action for session %s: %s", sessionID, req.Action)
	return result, nil
}

// processActRequestStreaming handles streaming act requests
func processActRequestStreaming(ctx context.Context, sessionID string, req *types.ActRequest, sessionState *types.SessionState) string {
	var streamingResponse strings.Builder

	// Send initial log event
	streamingResponse.WriteString(utils.SendLogEvent("info", "Starting action execution: "+req.Action))

	// Create action event for ECS controller
	actionEvent := map[string]interface{}{
		"sessionId": sessionID,
		"action":    req.Action,
		"variables": req.Variables,
		"iframes":   req.Iframes,
		"timeout":   req.TimeoutMs,
		"domSettle": req.DOMSettleTimeoutMs,
		"modelName": req.ModelName,
	}

	// Publish event to EventBridge for ECS controller
	if err := utils.PublishEvent(ctx, sessionID, "ActRequest", actionEvent); err != nil {
		log.Printf("Error publishing act event: %v", err)
		
		// Send error event
		streamingResponse.WriteString(utils.SendSystemEvent("error", nil, "Failed to queue action: "+err.Error()))
		return streamingResponse.String()
	}

	// Send progress log
	streamingResponse.WriteString(utils.SendLogEvent("info", "Action queued for browser execution"))

	// In a real implementation, you would:
	// 1. Subscribe to Redis pub/sub for real-time updates
	// 2. Wait for the ECS controller to execute the action
	// 3. Stream the results back in real-time
	// 
	// For now, simulate a successful completion
	streamingResponse.WriteString(utils.SendLogEvent("info", "Action completed successfully"))

	// Send final result
	result := types.ActResult{
		Success: true,
		Message: "Action completed",
		Action:  req.Action,
	}

	streamingResponse.WriteString(utils.SendSystemEvent("finished", result, ""))

	log.Printf("Streamed action for session %s: %s", sessionID, req.Action)
	return streamingResponse.String()
}

func main() {
	lambda.Start(Handler)
} 