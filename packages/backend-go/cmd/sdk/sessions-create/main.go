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

// SDKSessionCreateParams matches the SDK's SessionCreateParams interface
type SDKSessionCreateParams struct {
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
	var req SDKSessionCreateParams
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		log.Printf("Error parsing request body: %v", err)
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Invalid request body"))
	}

	// Validate required fields
	if req.ProjectID == "" {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Missing required field: projectId"))
	}

	// Validate headers
	if err := utils.ValidateHeaders(request.Headers); err != nil {
		return utils.CreateAPIResponse(401, utils.ErrorResponse(err.Error()))
	}

	// Validate that project ID in body matches header
	headerProjectID := request.Headers["x-wc-project-id"]
	if req.ProjectID != headerProjectID {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Project ID in body must match x-wc-project-id header"))
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

	// Store SDK-specific metadata
	if sessionState.UserMetadata == nil {
		sessionState.UserMetadata = make(map[string]string)
	}

	// Add SDK-specific fields to metadata (convert to strings)
	sessionState.UserMetadata["sessionType"] = "basic"
	sessionState.UserMetadata["keepAlive"] = fmt.Sprintf("%t", req.KeepAlive)
	sessionState.UserMetadata["timeout"] = fmt.Sprintf("%d", req.Timeout)
	sessionState.UserMetadata["region"] = region

	if req.UserMetadata != nil {
		for k, v := range req.UserMetadata {
			sessionState.UserMetadata[k] = fmt.Sprintf("%v", v)
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
		"sessionId":       sessionID,
		"projectId":       req.ProjectID,
		"sessionType":     "basic", // Not AI-powered
		"userMetadata":    sessionState.UserMetadata,
		"browserSettings": req.BrowserSettings,
		"timeout":         req.Timeout,
		"timestamp":       time.Now().Unix(),
	}

	if err := utils.AddSessionEvent(ctx, rdb, sessionID, "SessionCreateRequested", "wallcrawler.sdk.sessions-create", createEvent); err != nil {
		log.Printf("Error publishing session create event: %v", err)
		// Clean up session from Redis
		utils.DeleteSession(ctx, rdb, sessionID)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to initiate session creation"))
	}

	// Create URLs
	baseURL := "wss://api.wallcrawler.dev"
	if customBase := request.Headers["host"]; customBase != "" {
		baseURL = "wss://" + customBase
	}
	connectURL := baseURL + "/sessions/" + sessionID + "/connect"
	seleniumRemoteURL := "https://api.wallcrawler.dev/v1/sessions/" + sessionID + "/selenium"

	// Get the actual JWT signing key for session authentication
	signingKeyBytes, err := utils.GetJWTSigningKey()
	if err != nil {
		log.Printf("Error getting JWT signing key: %v", err)
		// For now, continue without signing key - this could be made non-fatal
	}
	signingKey := string(signingKeyBytes)

	// Return SDK-compatible response format using utility function
	response := utils.ConvertToSDKCreateResponse(sessionState, connectURL, seleniumRemoteURL, signingKey, req.UserMetadata)

	log.Printf("Created basic SDK session %s (async provisioning initiated)", sessionID)
	return utils.CreateAPIResponse(200, utils.SuccessResponse(response))
}

func main() {
	lambda.Start(Handler)
}
