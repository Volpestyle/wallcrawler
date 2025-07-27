package main

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/wallcrawler/backend-go/internal/types"
	"github.com/wallcrawler/backend-go/internal/utils"
)

// Handler processes the /sessions/start request (Stagehand-compatible)
func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// Parse request body
	var req types.StartSessionRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		log.Printf("Error parsing request body: %v", err)
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Invalid request body"))
	}

	// Validate required fields
	if req.ModelName == "" {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Missing required field: modelName"))
	}
	if req.ModelAPIKey == "" {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Missing required field: modelApiKey"))
	}

	// Validate headers
	if err := utils.ValidateHeaders(request.Headers); err != nil {
		return utils.CreateAPIResponse(401, utils.ErrorResponse(err.Error()))
	}

	// Get project ID from headers (Stagehand sends this)
	projectID := request.Headers["x-wc-project-id"]
	if projectID == "" {
		// Default project ID if not provided
		projectID = "default"
	}

	// Check for regional restrictions (Stagehand compatibility)
	if params := req.BrowserbaseSessionCreateParams; params != nil {
		if region, ok := params["region"].(string); ok && region != "us-west-2" {
			// Return unavailable for non-supported regions
			response := types.StartSessionResponse{
				SessionID: "",
				Available: false,
			}
			return utils.CreateAPIResponse(200, utils.SuccessResponse(response))
		}
	}

	// Generate session ID
	sessionID := utils.GenerateSessionID()

	// Set default values for optional fields
	if req.DOMSettleTimeoutMs == 0 {
		req.DOMSettleTimeoutMs = 10000
	}
	if req.ActionTimeoutMs == 0 {
		req.ActionTimeoutMs = 30000
	}

	// Create model configuration
	modelConfig := &types.ModelConfig{
		ModelName:              req.ModelName,
		ModelAPIKey:            req.ModelAPIKey,
		DOMSettleTimeoutMs:     req.DOMSettleTimeoutMs,
		Verbose:                req.Verbose,
		DebugDOM:               req.DebugDOM,
		SystemPrompt:           req.SystemPrompt,
		SelfHeal:               req.SelfHeal,
		WaitForCaptchaSolves:   req.WaitForCaptchaSolves,
		ActionTimeoutMs:        req.ActionTimeoutMs,
	}

	// Create session state with proper initial status and enhanced fields
	sessionState := utils.CreateSessionWithDefaults(sessionID, projectID, modelConfig)

	// Handle existing session ID (session resume)
	if req.BrowserbaseSessionID != "" {
		// Check if session exists
		rdb := utils.GetRedisClient()
		existingSession, err := utils.GetSession(ctx, rdb, req.BrowserbaseSessionID)
		if err == nil && existingSession != nil {
			// Update existing session with new model config
			existingSession.ModelConfig = modelConfig
			existingSession.UpdatedAt = time.Now()
			
			if err := utils.StoreSession(ctx, rdb, existingSession); err != nil {
				log.Printf("Error updating existing session: %v", err)
				return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to update session"))
			}

			response := types.StartSessionResponse{
				SessionID: existingSession.ID,
				Available: true,
			}
			return utils.CreateAPIResponse(200, utils.SuccessResponse(response))
		}
	}

	// Store session in Redis with initial CREATING status
	rdb := utils.GetRedisClient()
	if err := utils.StoreSession(ctx, rdb, sessionState); err != nil {
		log.Printf("Error storing session: %v", err)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to create session"))
	}

	// Publish SessionCreateRequested event to EventBridge for async processing
	createEvent := map[string]interface{}{
		"sessionId":    sessionID,
		"projectId":    projectID,
		"modelConfig":  modelConfig,
		"userMetadata": sessionState.UserMetadata,
		"timestamp":    time.Now().Unix(),
	}

	if err := utils.AddSessionEvent(ctx, rdb, sessionID, "SessionCreateRequested", "wallcrawler.sessions-start", createEvent); err != nil {
		log.Printf("Error publishing session create event: %v", err)
		// Clean up session from Redis
		utils.DeleteSession(ctx, rdb, sessionID)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to initiate session creation"))
	}

	// Return immediate response - EventBridge will handle async provisioning
	response := types.StartSessionResponse{
		SessionID: sessionID,
		Available: true, // Indicates the session is being provisioned
	}

	log.Printf("Created Stagehand session %s (async provisioning initiated)", sessionID)
	return utils.CreateAPIResponse(200, utils.SuccessResponse(response))
}

func main() {
	lambda.Start(Handler)
} 