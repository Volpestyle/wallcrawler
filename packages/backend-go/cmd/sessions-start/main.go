package main

import (
	"context"
	"encoding/json"
	"fmt"
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

	// Create session state (initially without connectURL)
	sessionState := &types.SessionState{
		ID:          sessionID,
		Status:      "RUNNING",
		ProjectID:   projectID,
		ModelConfig: modelConfig,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

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

	// Store session in Redis
	rdb := utils.GetRedisClient()
	if err := utils.StoreSession(ctx, rdb, sessionState); err != nil {
		log.Printf("Error storing session: %v", err)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to create session"))
	}

	// Create ECS task for browser automation
	taskARN, err := utils.CreateECSTask(ctx, sessionID, sessionState)
	if err != nil {
		log.Printf("Error creating ECS task: %v", err)
		// Clean up session from Redis
		utils.DeleteSession(ctx, rdb, sessionID)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to start browser session"))
	}

	// Wait for task to be running and get its IP
	var taskIP string
	var connectURL string

	// Wait up to 60 seconds for task to get an IP
	for i := 0; i < 60; i++ {
		taskIP, err = utils.GetECSTaskPublicIP(ctx, taskARN)
		if err == nil && taskIP != "" {
			connectURL = utils.CreateCDPURL(taskIP)
			break
		}
		log.Printf("Waiting for task IP... (attempt %d/60)", i+1)
		time.Sleep(1 * time.Second)
	}

	if connectURL == "" {
		log.Printf("Failed to get task IP after 60 seconds")
		// Fallback to a placeholder URL
		connectURL = fmt.Sprintf("ws://task-%s.wallcrawler.internal:9222", sessionID)
	}

	// Update session with task ARN and connect URL
	sessionState.ECSTaskARN = taskARN
	sessionState.ConnectURL = connectURL
	if err := utils.StoreSession(ctx, rdb, sessionState); err != nil {
		log.Printf("Error updating session with task ARN and URL: %v", err)
	}

	// Prepare response
	response := types.StartSessionResponse{
		SessionID: sessionID,
		Available: true,
	}

	log.Printf("Created Stagehand session %s with task %s", sessionID, taskARN)
	return utils.CreateAPIResponse(200, utils.SuccessResponse(response))
}

func main() {
	lambda.Start(Handler)
} 