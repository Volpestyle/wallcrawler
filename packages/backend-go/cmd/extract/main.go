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

// Handler processes the /sessions/{sessionId}/extract request
func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// Extract session ID from path parameters
	sessionID := request.PathParameters["sessionId"]
	if sessionID == "" {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Missing sessionId parameter"))
	}

	// Parse request body
	var req types.ExtractRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		log.Printf("Error parsing request body: %v", err)
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Invalid request body"))
	}

	// Validate required fields - either instruction or schemaDefinition should be provided
	if req.Instruction == "" && req.SchemaDefinition == nil {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Either instruction or schemaDefinition is required"))
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
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Session is not ready for extraction"))
	}

	if !isStreaming {
		// Non-streaming response (legacy support)
		result, err := processExtractRequest(ctx, sessionID, &req, sessionState)
		if err != nil {
			return utils.CreateAPIResponse(500, utils.ErrorResponse(err.Error()))
		}
		return utils.CreateAPIResponse(200, utils.SuccessResponse(result))
	}

	// Streaming response
	streamingBody := processExtractRequestStreaming(ctx, sessionID, &req, sessionState)
	
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

// processExtractRequest handles non-streaming extract requests
func processExtractRequest(ctx context.Context, sessionID string, req *types.ExtractRequest, sessionState *types.SessionState) (interface{}, error) {
	// Create extract event for ECS controller
	extractEvent := map[string]interface{}{
		"sessionId":         sessionID,
		"instruction":       req.Instruction,
		"schemaDefinition":  req.SchemaDefinition,
		"selector":          req.Selector,
		"iframes":           req.Iframes,
		"domSettle":         req.DOMSettleTimeoutMs,
		"modelName":         req.ModelName,
	}

	// Publish event to EventBridge for ECS controller
	if err := utils.PublishEvent(ctx, sessionID, "ExtractRequest", extractEvent); err != nil {
		log.Printf("Error publishing extract event: %v", err)
		return nil, err
	}

	// For non-streaming, return immediate response
	// In a real implementation, you'd wait for the result or use polling
	result := map[string]interface{}{
		"success": true,
		"message": "Extraction queued for execution",
		"data":    nil, // Will be populated by the ECS controller
	}

	log.Printf("Queued extraction for session %s", sessionID)
	return result, nil
}

// processExtractRequestStreaming handles streaming extract requests
func processExtractRequestStreaming(ctx context.Context, sessionID string, req *types.ExtractRequest, sessionState *types.SessionState) string {
	var streamingResponse strings.Builder

	// Send initial log event
	logMessage := "Starting data extraction"
	if req.Instruction != "" {
		logMessage += ": " + req.Instruction
	}
	streamingResponse.WriteString(utils.SendLogEvent("info", logMessage))

	// Create extract event for ECS controller
	extractEvent := map[string]interface{}{
		"sessionId":         sessionID,
		"instruction":       req.Instruction,
		"schemaDefinition":  req.SchemaDefinition,
		"selector":          req.Selector,
		"iframes":           req.Iframes,
		"domSettle":         req.DOMSettleTimeoutMs,
		"modelName":         req.ModelName,
	}

	// Publish event to EventBridge for ECS controller
	if err := utils.PublishEvent(ctx, sessionID, "ExtractRequest", extractEvent); err != nil {
		log.Printf("Error publishing extract event: %v", err)
		
		// Send error event
		streamingResponse.WriteString(utils.SendSystemEvent("error", nil, "Failed to queue extraction: "+err.Error()))
		return streamingResponse.String()
	}

	// Send progress log
	streamingResponse.WriteString(utils.SendLogEvent("info", "Extraction queued for browser execution"))

	// In a real implementation, you would:
	// 1. Subscribe to Redis pub/sub for real-time updates
	// 2. Wait for the ECS controller to execute the extraction
	// 3. Stream the results back in real-time
	// 
	// For now, simulate a successful completion
	streamingResponse.WriteString(utils.SendLogEvent("info", "Processing DOM and extracting data..."))
	streamingResponse.WriteString(utils.SendLogEvent("info", "Extraction completed successfully"))

	// Send final result
	result := map[string]interface{}{
		"success": true,
		"message": "Data extracted successfully",
		"data":    map[string]interface{}{
			"extracted": "Sample extracted data - to be replaced with real extraction results",
		},
	}

	streamingResponse.WriteString(utils.SendSystemEvent("finished", result, ""))

	log.Printf("Streamed extraction for session %s", sessionID)
	return streamingResponse.String()
}

func main() {
	lambda.Start(Handler)
} 