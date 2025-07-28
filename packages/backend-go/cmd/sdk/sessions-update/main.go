package main

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/wallcrawler/backend-go/internal/utils"
)

// SDKSessionUpdateParams matches the SDK's SessionUpdateParams interface
type SDKSessionUpdateParams struct {
	ProjectID string `json:"projectId"`
	Status    string `json:"status"` // Should be "REQUEST_RELEASE"
}

// Handler processes POST /v1/sessions/{id} (SDK-compatible session update)
func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// Extract session ID from path parameters
	sessionID := request.PathParameters["id"]
	if sessionID == "" {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Missing session ID parameter"))
	}

	// Parse request body
	var req SDKSessionUpdateParams
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		log.Printf("Error parsing request body: %v", err)
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Invalid request body"))
	}

	// Validate headers
	if err := utils.ValidateHeaders(request.Headers); err != nil {
		return utils.CreateAPIResponse(401, utils.ErrorResponse(err.Error()))
	}

	// Validate that this is a release request
	if req.Status != "REQUEST_RELEASE" {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Only REQUEST_RELEASE status updates are supported"))
	}

	// Get session from Redis
	rdb := utils.GetRedisClient()
	sessionState, err := utils.GetSession(ctx, rdb, sessionID)
	if err != nil {
		log.Printf("Error getting session %s: %v", sessionID, err)
		return utils.CreateAPIResponse(404, utils.ErrorResponse("Session not found"))
	}

	// Check if session is already in a terminal state
	if utils.IsSessionTerminal(sessionState.Status) {
		log.Printf("Session %s is already terminated with status: %s", sessionID, sessionState.Status)
		// Return the current session state without making changes using utility function
		response := utils.ConvertToSDKSession(sessionState)
		return utils.CreateAPIResponse(200, utils.SuccessResponse(response))
	}

	// Check if session belongs to the requesting project
	headerProjectID := request.Headers["x-wc-project-id"]
	if sessionState.ProjectID != headerProjectID {
		log.Printf("Project ID mismatch for session %s: expected %s, got %s", sessionID, sessionState.ProjectID, headerProjectID)
		return utils.CreateAPIResponse(403, utils.ErrorResponse("Session does not belong to the specified project"))
	}

	// Update session status to indicate termination request
	if err := utils.UpdateSessionStatus(ctx, rdb, sessionID, "TERMINATING"); err != nil {
		log.Printf("Error updating session status: %v", err)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to update session"))
	}

	// Publish session termination event
	terminationEvent := map[string]interface{}{
		"sessionId": sessionID,
		"reason":    "user_requested",
		"timestamp": time.Now().Unix(),
	}

	if err := utils.AddSessionEvent(ctx, rdb, sessionID, "SessionTerminationRequested", "wallcrawler.sdk.sessions-update", terminationEvent); err != nil {
		log.Printf("Error publishing termination event: %v", err)
		// Continue anyway - session status was updated
	}

	// Get updated session state for response
	updatedSessionState, err := utils.GetSession(ctx, rdb, sessionID)
	if err != nil {
		log.Printf("Error getting updated session %s: %v", sessionID, err)
		// Fallback to previous state with updated status
		sessionState.Status = "TERMINATING"
		sessionState.UpdatedAt = time.Now()
		updatedSessionState = sessionState
	}

	// Convert to SDK format using utility function
	response := utils.ConvertToSDKSession(updatedSessionState)

	log.Printf("Updated SDK session %s to REQUEST_RELEASE", sessionID)
	return utils.CreateAPIResponse(200, utils.SuccessResponse(response))
}

func main() {
	lambda.Start(Handler)
}
