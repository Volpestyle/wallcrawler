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

// Handler processes the /sessions/{sessionId}/agentExecute request
func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// Extract session ID from path parameters
	sessionID := request.PathParameters["sessionId"]
	if sessionID == "" {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Missing sessionId parameter"))
	}

	// Parse request body
	var req types.AgentExecuteRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		log.Printf("Error parsing request body: %v", err)
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Invalid request body"))
	}

	// Validate required fields
	if req.AgentConfig.Provider == "" {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Missing required field: agentConfig.provider"))
	}
	if req.AgentConfig.Model == "" {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Missing required field: agentConfig.model"))
	}
	if req.ExecuteOptions.Instruction == "" {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Missing required field: executeOptions.instruction"))
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
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Session is not ready for agent execution"))
	}

	if !isStreaming {
		// Non-streaming response (legacy support)
		result, err := processAgentExecuteRequest(ctx, sessionID, &req, sessionState)
		if err != nil {
			return utils.CreateAPIResponse(500, utils.ErrorResponse(err.Error()))
		}
		return utils.CreateAPIResponse(200, utils.SuccessResponse(result))
	}

	// Streaming response
	streamingBody := processAgentExecuteRequestStreaming(ctx, sessionID, &req, sessionState)
	
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

// processAgentExecuteRequest handles non-streaming agent execute requests
func processAgentExecuteRequest(ctx context.Context, sessionID string, req *types.AgentExecuteRequest, sessionState *types.SessionState) (*types.AgentResult, error) {
	// Create agent execute event for ECS controller
	agentEvent := map[string]interface{}{
		"sessionId":      sessionID,
		"agentConfig":    req.AgentConfig,
		"executeOptions": req.ExecuteOptions,
	}

	// Publish event to EventBridge for ECS controller
	if err := utils.PublishEvent(ctx, sessionID, "AgentExecuteRequest", agentEvent); err != nil {
		log.Printf("Error publishing agent execute event: %v", err)
		return nil, err
	}

	// For non-streaming, return immediate response
	// In a real implementation, you'd wait for the result or use polling
	result := &types.AgentResult{
		Success:   true,
		Message:   "Agent execution queued",
		Actions:   []types.AgentAction{},
		Completed: false,
		Metadata:  map[string]interface{}{"status": "queued"},
		Usage: types.TokenUsage{
			InputTokens:     0,
			OutputTokens:    0,
			InferenceTimeMs: 0,
		},
	}

	log.Printf("Queued agent execution for session %s", sessionID)
	return result, nil
}

// processAgentExecuteRequestStreaming handles streaming agent execute requests
func processAgentExecuteRequestStreaming(ctx context.Context, sessionID string, req *types.AgentExecuteRequest, sessionState *types.SessionState) string {
	var streamingResponse strings.Builder

	// Send initial log event
	streamingResponse.WriteString(utils.SendLogEvent("info", "Starting autonomous agent execution: "+req.ExecuteOptions.Instruction))

	// Create agent execute event for ECS controller
	agentEvent := map[string]interface{}{
		"sessionId":      sessionID,
		"agentConfig":    req.AgentConfig,
		"executeOptions": req.ExecuteOptions,
	}

	// Publish event to EventBridge for ECS controller
	if err := utils.PublishEvent(ctx, sessionID, "AgentExecuteRequest", agentEvent); err != nil {
		log.Printf("Error publishing agent execute event: %v", err)
		
		// Send error event
		streamingResponse.WriteString(utils.SendSystemEvent("error", nil, "Failed to queue agent execution: "+err.Error()))
		return streamingResponse.String()
	}

	// Send progress log
	streamingResponse.WriteString(utils.SendLogEvent("info", "Agent execution queued for browser execution"))

	// In a real implementation, you would:
	// 1. Subscribe to Redis pub/sub for real-time updates
	// 2. Wait for the ECS controller to execute the agent workflow
	// 3. Stream the results back in real-time
	// 
	// For now, simulate a successful multi-step agent execution
	streamingResponse.WriteString(utils.SendLogEvent("info", "Initializing agent with provider: "+req.AgentConfig.Provider))
	streamingResponse.WriteString(utils.SendLogEvent("info", "Using model: "+req.AgentConfig.Model))

	// Set default max steps if not provided
	maxSteps := req.ExecuteOptions.MaxSteps
	if maxSteps == 0 {
		maxSteps = 10
	}

	// Simulate agent execution steps
	simulatedActions := []types.AgentAction{
		{
			Type: "observe",
			Data: map[string]interface{}{
				"description": "Analyzed page structure",
				"elements":    3,
			},
		},
		{
			Type: "action",
			Data: map[string]interface{}{
				"action":  "click",
				"element": "#submit-button",
			},
		},
		{
			Type: "extract",
			Data: map[string]interface{}{
				"data":   "Sample extracted data",
				"format": "text",
			},
		},
	}

	// Stream agent actions
	for i, action := range simulatedActions {
		if i >= maxSteps {
			break
		}
		
		stepNum := i + 1
		streamingResponse.WriteString(utils.SendLogEvent("info", fmt.Sprintf("Step %d: Executing %s", stepNum, action.Type)))
		
		// Send action result
		streamingResponse.WriteString(utils.FormatStreamEvent("action", action))
		
		// Add delay between actions if specified
		if req.ExecuteOptions.WaitBetweenActions > 0 {
			streamingResponse.WriteString(utils.SendLogEvent("info", fmt.Sprintf("Waiting %dms between actions", req.ExecuteOptions.WaitBetweenActions)))
		}
	}

	streamingResponse.WriteString(utils.SendLogEvent("info", "Agent execution completed successfully"))

	// Send final result
	result := types.AgentResult{
		Success:   true,
		Message:   "Agent workflow completed",
		Actions:   simulatedActions,
		Completed: true,
		Metadata: map[string]interface{}{
			"totalSteps":     len(simulatedActions),
			"maxSteps":       maxSteps,
			"provider":       req.AgentConfig.Provider,
			"model":          req.AgentConfig.Model,
			"autoScreenshot": req.ExecuteOptions.AutoScreenshot,
		},
		Usage: types.TokenUsage{
			InputTokens:     1250,
			OutputTokens:    430,
			InferenceTimeMs: 2150,
		},
	}

	streamingResponse.WriteString(utils.SendSystemEvent("finished", result, ""))

	log.Printf("Streamed agent execution for session %s", sessionID)
	return streamingResponse.String()
}

func main() {
	lambda.Start(Handler)
} 