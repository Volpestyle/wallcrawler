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

// Handler processes the /sessions/{sessionId}/observe request
func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// Extract session ID from path parameters
	sessionID := request.PathParameters["sessionId"]
	if sessionID == "" {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Missing sessionId parameter"))
	}

	// Parse request body
	var req types.ObserveRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		log.Printf("Error parsing request body: %v", err)
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Invalid request body"))
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
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Session is not ready for observation"))
	}

	if !isStreaming {
		// Non-streaming response (legacy support)
		result, err := processObserveRequest(ctx, sessionID, &req, sessionState)
		if err != nil {
			return utils.CreateAPIResponse(500, utils.ErrorResponse(err.Error()))
		}
		return utils.CreateAPIResponse(200, utils.SuccessResponse(result))
	}

	// Streaming response
	streamingBody := processObserveRequestStreaming(ctx, sessionID, &req, sessionState)
	
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

// processObserveRequest handles non-streaming observe requests
func processObserveRequest(ctx context.Context, sessionID string, req *types.ObserveRequest, sessionState *types.SessionState) (*types.ObserveResult, error) {
	// Create observe event for ECS controller
	observeEvent := map[string]interface{}{
		"sessionId":     sessionID,
		"instruction":   req.Instruction,
		"returnAction":  req.ReturnAction,
		"drawOverlay":   req.DrawOverlay,
		"iframes":       req.Iframes,
		"domSettle":     req.DOMSettleTimeoutMs,
		"modelName":     req.ModelName,
	}

	// Publish event to EventBridge for ECS controller
	if err := utils.PublishEvent(ctx, sessionID, "ObserveRequest", observeEvent); err != nil {
		log.Printf("Error publishing observe event: %v", err)
		return nil, err
	}

	// For non-streaming, return immediate response
	// In a real implementation, you'd wait for the result or use polling
	result := &types.ObserveResult{
		Selector:     "placeholder-selector",
		Description:  "Element observation queued for execution",
		Method:       "placeholder",
		Arguments:    []string{},
	}

	log.Printf("Queued observation for session %s", sessionID)
	return result, nil
}

// processObserveRequestStreaming handles streaming observe requests
func processObserveRequestStreaming(ctx context.Context, sessionID string, req *types.ObserveRequest, sessionState *types.SessionState) string {
	var streamingResponse strings.Builder

	// Send initial log event
	logMessage := "Starting DOM observation"
	if req.Instruction != "" {
		logMessage += ": " + req.Instruction
	}
	streamingResponse.WriteString(utils.SendLogEvent("info", logMessage))

	// Create observe event for ECS controller
	observeEvent := map[string]interface{}{
		"sessionId":     sessionID,
		"instruction":   req.Instruction,
		"returnAction":  req.ReturnAction,
		"drawOverlay":   req.DrawOverlay,
		"iframes":       req.Iframes,
		"domSettle":     req.DOMSettleTimeoutMs,
		"modelName":     req.ModelName,
	}

	// Publish event to EventBridge for ECS controller
	if err := utils.PublishEvent(ctx, sessionID, "ObserveRequest", observeEvent); err != nil {
		log.Printf("Error publishing observe event: %v", err)
		
		// Send error event
		streamingResponse.WriteString(utils.SendSystemEvent("error", nil, "Failed to queue observation: "+err.Error()))
		return streamingResponse.String()
	}

	// Send progress log
	streamingResponse.WriteString(utils.SendLogEvent("info", "Observation queued for browser execution"))

	// In a real implementation, you would:
	// 1. Subscribe to Redis pub/sub for real-time updates
	// 2. Wait for the ECS controller to execute the observation
	// 3. Stream the results back in real-time
	// 
	// For now, simulate a successful completion
	streamingResponse.WriteString(utils.SendLogEvent("info", "Analyzing DOM structure..."))
	streamingResponse.WriteString(utils.SendLogEvent("info", "Identifying target elements..."))
	if req.DrawOverlay {
		streamingResponse.WriteString(utils.SendLogEvent("info", "Drawing overlay on identified elements"))
	}
	streamingResponse.WriteString(utils.SendLogEvent("info", "Observation completed successfully"))

	// Send final result
	result := types.ObserveResult{
		Selector:      "#sample-element",
		Description:   "Sample element found - to be replaced with real observation results",
		BackendNodeID: 12345,
	}
	
	if req.ReturnAction {
		result.Method = "click"
		result.Arguments = []string{"left"}
	} else {
		result.Method = ""
		result.Arguments = []string{}
	}

	streamingResponse.WriteString(utils.SendSystemEvent("finished", result, ""))

	log.Printf("Streamed observation for session %s", sessionID)
	return streamingResponse.String()
}

func main() {
	lambda.Start(Handler)
} 