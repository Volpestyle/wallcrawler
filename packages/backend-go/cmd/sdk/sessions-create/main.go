package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/wallcrawler/backend-go/internal/types"
	"github.com/wallcrawler/backend-go/internal/utils"
)

// SessionCreateRequest represents the API Gateway request body
type SessionCreateRequest struct {
	ProjectID       string                 `json:"projectId"`
	BrowserSettings map[string]interface{} `json:"browserSettings,omitempty"`
	ExtensionID     string                 `json:"extensionId,omitempty"`
	KeepAlive       bool                   `json:"keepAlive,omitempty"`
	Proxies         interface{}            `json:"proxies,omitempty"`
	Region          string                 `json:"region,omitempty"`
	Timeout         int                    `json:"timeout,omitempty"`
	UserMetadata    map[string]interface{} `json:"userMetadata,omitempty"`
}

type browserSettingsContext struct {
	ID      string `json:"id"`
	Persist bool   `json:"persist"`
}

type browserSettings struct {
	Context *browserSettingsContext `json:"context,omitempty"`
}

// SessionReadyNotification represents the message from SNS
type SessionReadyNotification struct {
	SessionID         string `json:"sessionId"`
	ProjectID         string `json:"projectId"`
	Status            string `json:"status"`
	ConnectURL        string `json:"connectUrl"`
	SeleniumRemoteURL string `json:"seleniumRemoteUrl"`
	PublicIP          string `json:"publicIp"`
	CreatedAt         string `json:"createdAt"`
	ExpiresAt         string `json:"expiresAt"`
	Region            string `json:"region"`
	KeepAlive         bool   `json:"keepAlive"`
}

// SessionCreateResponse represents the response to the client
type SessionCreateResponse struct {
	ID                string `json:"id"`
	Status            string `json:"status"`
	ConnectURL        string `json:"connectUrl"`
	PublicIP          string `json:"publicIp"`
	SeleniumRemoteURL string `json:"seleniumRemoteUrl"`
	CreatedAt         string `json:"createdAt"`
	ExpiresAt         string `json:"expiresAt"`
	ProjectID         string `json:"projectId"`
	KeepAlive         bool   `json:"keepAlive"`
	Region            string `json:"region"`
	SigningKey        string `json:"signingKey"`
}

// Global variables for session ready notifications
var (
	sessionReadyChannels sync.Map // map[sessionID]chan SessionReadyNotification
)

// Handler processes session creation requests from API Gateway
// This function creates the ECS task and waits synchronously for it to be ready
func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// Parse request body
	var req SessionCreateRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Invalid request body"))
	}

	authorizedProjectID := utils.GetAuthorizedProjectID(request.RequestContext.Authorizer)
	if authorizedProjectID == "" {
		return utils.CreateAPIResponse(403, utils.ErrorResponse("Unauthorized project access"))
	}

	if req.ProjectID == "" {
		req.ProjectID = authorizedProjectID
	}

	if !strings.EqualFold(req.ProjectID, authorizedProjectID) {
		log.Printf("Project mismatch: request %s vs authorized %s", req.ProjectID, authorizedProjectID)
		return utils.CreateAPIResponse(403, utils.ErrorResponse("Project ID does not match API key"))
	}

	log.Printf("Processing session creation request for project %s", req.ProjectID)

	// Validate required fields
	if req.ProjectID == "" {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Missing required field: projectId"))
	}

	var parsedSettings browserSettings
	if req.BrowserSettings != nil {
		if raw, err := json.Marshal(req.BrowserSettings); err == nil {
			_ = json.Unmarshal(raw, &parsedSettings)
		}
	}

	// Generate session ID
	sessionID := utils.GenerateSessionID()

	// Set default timeout if not provided (24 hours)
	req.Timeout = utils.NormalizeSessionTimeout(req.Timeout)

	// Set default region if not provided
	region := req.Region
	if region == "" {
		region = "us-east-1"
	}

	var resolvedContextID *string
	var contextStorageKey *string
	var contextPersist bool

	// Convert to internal session format
	sessionState := utils.CreateSessionWithDefaults(sessionID, req.ProjectID, nil, req.Timeout)

	// Update fields from request
	sessionState.KeepAlive = req.KeepAlive
	sessionState.Region = region

	// Update expiration based on timeout
	expiresAt := time.Now().Add(time.Duration(req.Timeout) * time.Second)
	sessionState.ExpiresAt = expiresAt.Format(time.RFC3339)
	sessionState.ExpiresAtUnix = expiresAt.Unix()

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

	if resolvedContextID != nil {
		sessionState.ContextID = resolvedContextID
		sessionState.ContextPersist = contextPersist
		sessionState.ContextStorageKey = contextStorageKey
		sessionState.UserMetadata["contextPersist"] = contextPersist
	}

	// Create a channel to wait for session ready notification
	readyChan := make(chan SessionReadyNotification, 1)
	sessionReadyChannels.Store(sessionID, readyChan)
	defer sessionReadyChannels.Delete(sessionID)

	// Log session creation
	utils.LogSessionCreated(sessionID, req.ProjectID, map[string]interface{}{
		"timeout":       req.Timeout,
		"user_metadata": req.UserMetadata,
		"synchronous":   true,
	})

	// Get DynamoDB client
	ddbClient, err := utils.GetDynamoDBClient(ctx)
	if err != nil {
		log.Printf("Error getting DynamoDB client: %v", err)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to initialize storage"))
	}

	if parsedSettings.Context != nil && parsedSettings.Context.ID != "" {
		record, err := utils.GetContextForProject(ctx, ddbClient, req.ProjectID, parsedSettings.Context.ID)
		if err != nil {
			return utils.CreateAPIResponse(404, utils.ErrorResponse("Context not found for project"))
		}
		id := record.ID
		resolvedContextID = &id
		key := record.StorageKey
		contextStorageKey = &key
		contextPersist = parsedSettings.Context.Persist
	}

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

	// Update status to PROVISIONING
	if err := utils.UpdateSessionStatus(ctx, ddbClient, sessionID, types.SessionStatusProvisioning); err != nil {
		log.Printf("Error updating session status to provisioning: %v", err)
		utils.DeleteSession(ctx, ddbClient, sessionID)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to update session status"))
	}
	sessionState.InternalStatus = types.SessionStatusProvisioning
	sessionState.Status = utils.MapStatusToSDK(types.SessionStatusProvisioning)

	// Create ECS task
	taskARN, err := utils.CreateECSTask(ctx, sessionID, sessionState)
	if err != nil {
		log.Printf("Error creating ECS task for session %s: %v", sessionID, err)
		utils.UpdateSessionStatus(ctx, ddbClient, sessionID, types.SessionStatusFailed)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to provision browser container"))
	}

	// Update session with task ARN
	sessionState.ECSTaskARN = taskARN
	if err := utils.StoreSession(ctx, ddbClient, sessionState); err != nil {
		log.Printf("Error storing session with task ARN: %v", err)
	}

	log.Printf("Successfully initiated ECS task %s for session %s, waiting for container to be ready", taskARN, sessionID)

	// Wait for session to be ready with timeout
	// 45 seconds should handle most cold starts and network delays
	timeout := time.Duration(45) * time.Second
	select {
	case notification := <-readyChan:
		// Session is ready, return the complete details
		log.Printf("Session %s is ready with connect URL: %s", sessionID, notification.ConnectURL)

		response := SessionCreateResponse{
			ID:                sessionID,
			Status:            "RUNNING",
			ConnectURL:        notification.ConnectURL,
			PublicIP:          notification.PublicIP,
			SeleniumRemoteURL: notification.SeleniumRemoteURL,
			CreatedAt:         sessionState.CreatedAt,
			ExpiresAt:         sessionState.ExpiresAt,
			ProjectID:         req.ProjectID,
			KeepAlive:         req.KeepAlive,
			Region:            region,
			SigningKey:        jwtToken,
		}

		return utils.CreateAPIResponse(200, response)

	case <-time.After(timeout):
		// Timeout waiting for session to be ready
		log.Printf("Timeout waiting for session %s to be ready", sessionID)
		utils.StopECSTask(ctx, taskARN)
		utils.UpdateSessionStatus(ctx, ddbClient, sessionID, types.SessionStatusTimedOut)
		return utils.CreateAPIResponse(504, utils.ErrorResponse("Timeout waiting for browser container to be ready"))
	}
}

// SNSHandler processes SNS messages for session ready notifications
func SNSHandler(ctx context.Context, snsEvent events.SNSEvent) error {
	for _, record := range snsEvent.Records {
		// Parse the notification
		var notification SessionReadyNotification
		if err := json.Unmarshal([]byte(record.SNS.Message), &notification); err != nil {
			log.Printf("Error unmarshaling SNS message: %v", err)
			continue
		}

		// Check if we have a channel waiting for this session
		if ch, ok := sessionReadyChannels.Load(notification.SessionID); ok {
			if readyChan, ok := ch.(chan SessionReadyNotification); ok {
				// Send notification to waiting channel (non-blocking)
				select {
				case readyChan <- notification:
					log.Printf("Delivered ready notification for session %s", notification.SessionID)
				default:
					log.Printf("Channel full or closed for session %s", notification.SessionID)
				}
			}
		}
	}
	return nil
}

func main() {
	// This Lambda handles both API Gateway requests and SNS notifications
	lambda.Start(func(ctx context.Context, event interface{}) (interface{}, error) {
		// Parse the event using the utility function
		parsedEvent, eventType, err := utils.ParseLambdaEvent(event)
		if err != nil {
			return nil, err
		}

		switch eventType {
		case utils.EventTypeAPIGateway:
			apiReq := parsedEvent.(events.APIGatewayProxyRequest)
			return Handler(ctx, apiReq)
		case utils.EventTypeSNS:
			snsEvent := parsedEvent.(events.SNSEvent)
			return nil, SNSHandler(ctx, snsEvent)
		default:
			return nil, fmt.Errorf("unexpected event type")
		}
	})
}
