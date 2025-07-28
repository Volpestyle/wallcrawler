package main

import (
	"context"
	"encoding/json"
	"log"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/wallcrawler/backend-go/internal/types"
	"github.com/wallcrawler/backend-go/internal/utils"
)

// SessionUpdateRequest represents the session update request body
type SessionUpdateRequest struct {
	ProjectID string `json:"projectId"`
	Status    string `json:"status"`
}

// Handler processes POST /v1/sessions/{id} (SDK-compatible session updates)
func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// Extract session ID from path parameters
	sessionID := request.PathParameters["id"]
	if sessionID == "" {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Missing session ID parameter"))
	}

	// Validate headers
	if err := utils.ValidateHeaders(request.Headers); err != nil {
		return utils.CreateAPIResponse(401, utils.ErrorResponse(err.Error()))
	}

	// Parse request body
	var req SessionUpdateRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		log.Printf("Error parsing request body: %v", err)
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Invalid request body"))
	}

	// Validate required fields
	if req.ProjectID == "" {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Missing projectId"))
	}

	if req.Status != "REQUEST_RELEASE" {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Only REQUEST_RELEASE status is supported"))
	}

	// Get Redis client
	rdb := utils.GetRedisClient()

	// Get current session state
	sessionState, err := utils.GetSession(ctx, rdb, sessionID)
	if err != nil {
		log.Printf("Error getting session %s: %v", sessionID, err)
		return utils.CreateAPIResponse(404, utils.ErrorResponse("Session not found"))
	}

	// Validate project ID matches
	if sessionState.ProjectID != req.ProjectID {
		return utils.CreateAPIResponse(403, utils.ErrorResponse("Project ID does not match session"))
	}

	// Check if session is already terminated
	if sessionState.Status == types.SessionStatusStopped ||
		sessionState.Status == types.SessionStatusFailed {
		log.Printf("Session %s is already terminated with status: %s", sessionID, sessionState.Status)
		return utils.CreateAPIResponse(200, utils.SuccessResponse(sessionState))
	}

	log.Printf("Processing termination request for session %s", sessionID)

	// Update session status to STOPPED
	if err := utils.UpdateSessionStatus(ctx, rdb, sessionID, types.SessionStatusStopped); err != nil {
		log.Printf("Error updating session status: %v", err)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to update session status"))
	}

	// Stop ECS task if one is running
	if sessionState.ECSTaskARN != "" {
		log.Printf("Stopping ECS task %s for session %s", sessionState.ECSTaskARN, sessionID)
		if err := utils.StopECSTask(ctx, sessionState.ECSTaskARN); err != nil {
			log.Printf("Error stopping ECS task: %v", err)
			// Don't fail the request - task might already be stopped
		}
	}

	// Add termination event to session history
	eventDetail := map[string]interface{}{
		"reason":    "user_requested",
		"status":    "REQUEST_RELEASE",
		"projectId": req.ProjectID,
		"source":    "sessions-update",
	}

	if err := utils.AddSessionEvent(ctx, rdb, sessionID, "SessionTerminated", "wallcrawler.sessions-update", eventDetail); err != nil {
		log.Printf("Error adding session termination event: %v", err)
	}

	// Get updated session state to return
	updatedSession, err := utils.GetSession(ctx, rdb, sessionID)
	if err != nil {
		log.Printf("Error getting updated session: %v", err)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to retrieve updated session"))
	}

	log.Printf("Successfully terminated session %s", sessionID)
	return utils.CreateAPIResponse(200, utils.SuccessResponse(updatedSession))
}

func main() {
	lambda.Start(Handler)
}
