package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/wallcrawler/backend-go/internal/utils"
)

// SessionCreateParams matches the SDK's SessionCreateParams interface
type SessionCreateParams struct {
	ProjectID       string                 `json:"projectId"`
	BrowserSettings map[string]interface{} `json:"browserSettings,omitempty"`
	ExtensionID     string                 `json:"extensionId,omitempty"`
	KeepAlive       bool                   `json:"keepAlive,omitempty"`
	Proxies         interface{}            `json:"proxies,omitempty"`
	Region          string                 `json:"region,omitempty"`
	Timeout         int                    `json:"timeout,omitempty"`
	UserMetadata    map[string]interface{} `json:"userMetadata,omitempty"`
}

// Handler processes POST /v1/sessions (SDK-compatible basic browser session creation)
func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// Parse request body
	var req SessionCreateParams
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		log.Printf("Error parsing request body: %v", err)
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Invalid request body"))
	}

	// Validate required fields
	if req.ProjectID == "" {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Missing required field: projectId"))
	}

	// Validate API key header only
	if request.Headers["x-wc-api-key"] == "" {
		return utils.CreateAPIResponse(401, utils.ErrorResponse("Missing required header: x-wc-api-key"))
	}

	// Generate session ID
	sessionID := utils.GenerateSessionID()

	// Set default timeout if not provided (24 hours)
	if req.Timeout == 0 {
		req.Timeout = 86400 // 24 hours in seconds
	}

	// Set default region if not provided
	region := req.Region
	if region == "" {
		region = "us-east-1"
	}

	// Convert SDK format to internal session format
	// For basic sessions, we don't need AI model configuration
	sessionState := utils.CreateSessionWithDefaults(sessionID, req.ProjectID, nil)

	// Update fields from request
	sessionState.KeepAlive = req.KeepAlive
	sessionState.Region = region

	// Update expiration based on timeout
	expiresAt := time.Now().Add(time.Duration(req.Timeout) * time.Second)
	sessionState.ExpiresAt = expiresAt.Format(time.RFC3339)

	// Store SDK-specific metadata
	if sessionState.UserMetadata == nil {
		sessionState.UserMetadata = make(map[string]interface{})
	}

	// Add SDK-specific fields to metadata
	sessionState.UserMetadata["sessionType"] = "basic"
	sessionState.UserMetadata["timeout"] = req.Timeout

	if req.UserMetadata != nil {
		for k, v := range req.UserMetadata {
			sessionState.UserMetadata[k] = v
		}
	}

	// Log session creation
	utils.LogSessionCreated(sessionID, req.ProjectID, map[string]interface{}{
		"timeout":       req.Timeout,
		"user_metadata": req.UserMetadata,
		"api_key":       request.Headers["X-Wc-Api-Key"],
	})

	// Get DynamoDB and Redis clients
	ddbClient, err := utils.GetDynamoDBClient(ctx)
	if err != nil {
		log.Printf("Error getting DynamoDB client: %v", err)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to initialize storage"))
	}

	rdb, err := utils.GetRedisClient(ctx)
	if err != nil {
		log.Printf("Error getting Redis client: %v", err)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to initialize pub/sub"))
	}
	defer rdb.Close()

	// Store session in DynamoDB with initial CREATING status
	if err := utils.StoreSession(ctx, ddbClient, sessionState); err != nil {
		log.Printf("Error storing session: %v", err)
		utils.LogSessionError(sessionID, req.ProjectID, err, "store_session", nil)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to create session"))
	}

	// Generate JWT token for this session with proper expiration
	now := time.Now()
	jwtExpiresAt := now.Add(time.Duration(req.Timeout) * time.Second)

	payload := utils.CDPSigningPayload{
		SessionID: sessionID,
		ProjectID: req.ProjectID,
		IssuedAt:  now.Unix(),
		ExpiresAt: jwtExpiresAt.Unix(),
		Nonce:     utils.GenerateRandomNonce(),
	}

	jwtToken, err := utils.CreateCDPToken(payload)
	if err != nil {
		log.Printf("Error creating JWT token for session %s: %v", sessionID, err)
		utils.LogSessionError(sessionID, req.ProjectID, err, "create_jwt", nil)
		// Clean up session from Redis
		utils.DeleteSession(ctx, ddbClient, sessionID)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to generate session authentication token"))
	}

	// Store the JWT token in session state
	sessionState.SigningKey = &jwtToken
	if err := utils.StoreSession(ctx, ddbClient, sessionState); err != nil {
		log.Printf("Error storing session with JWT token: %v", err)
		utils.DeleteSession(ctx, ddbClient, sessionID)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to store session"))
	}

	// Synchronously provision ECS task and wait for it to be ready
	log.Printf("Starting synchronous ECS task provisioning for session %s", sessionID)
	provisioningStart := time.Now()

	// Update status to PROVISIONING
	if err := utils.UpdateSessionStatus(ctx, ddbClient, sessionID, "PROVISIONING"); err != nil {
		log.Printf("Error updating session status to provisioning: %v", err)
		utils.DeleteSession(ctx, ddbClient, sessionID)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to update session status"))
	}

	// Create ECS task
	taskARN, err := utils.CreateECSTask(ctx, sessionID, sessionState)
	if err != nil {
		log.Printf("Error creating ECS task for session %s: %v", sessionID, err)
		utils.UpdateSessionStatus(ctx, ddbClient, sessionID, "FAILED")
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to provision browser container"))
	}

	// Update session with task ARN
	sessionState.ECSTaskARN = taskARN
	if err := utils.StoreSession(ctx, ddbClient, sessionState); err != nil {
		log.Printf("Error storing session with task ARN: %v", err)
	}

	// Wait for session to become READY via EventBridge (much more efficient than ECS API polling)
	log.Printf("Waiting for session %s to become READY via EventBridge events...", sessionID)
	finalSessionState, err := utils.WaitForSessionReady(ctx, ddbClient, rdb, sessionID, 150) // 2.5 minute timeout
	if err != nil {
		log.Printf("Error waiting for session to become ready: %v", err)
		utils.LogSessionError(sessionID, req.ProjectID, err, "wait_for_ready", map[string]interface{}{
			"task_arn":        taskARN,
			"timeout_seconds": 150,
		})
		utils.StopECSTask(ctx, taskARN)
		utils.UpdateSessionStatus(ctx, ddbClient, sessionID, "FAILED")
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Browser container failed to start within timeout"))
	}

	// Extract final URLs from ready session state
	taskIP := finalSessionState.PublicIP
	seleniumURL := fmt.Sprintf("http://%s:4444/wd/hub", taskIP)

	// Log successful session creation
	provisioningTime := time.Since(provisioningStart)
	utils.LogSessionReady(sessionID, req.ProjectID, taskIP, provisioningTime.Milliseconds())

	// Update session with final URLs
	finalSessionState.SeleniumRemoteURL = &seleniumURL
	finalSessionState.SigningKey = &jwtToken

	// Validate required fields for SessionCreateResponse
	if finalSessionState.ConnectURL == nil || *finalSessionState.ConnectURL == "" {
		log.Printf("Error: ConnectURL is missing for session %s", sessionID)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Session created but connectUrl is missing"))
	}

	log.Printf("Successfully created and provisioned SDK session %s with IP %s via EventBridge", sessionID, taskIP)
	return utils.CreateAPIResponse(200, utils.SuccessResponse(finalSessionState))
}

func main() {
	lambda.Start(Handler)
}
