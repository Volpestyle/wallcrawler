package main

import (
	"context"
	"log"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/wallcrawler/backend-go/internal/types"
	"github.com/wallcrawler/backend-go/internal/utils"
)

// Handler processes the /sessions/{sessionId}/end request
func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// Extract session ID from path parameters
	sessionID := request.PathParameters["sessionId"]
	if sessionID == "" {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Missing sessionId parameter"))
	}

	// Validate headers
	if err := utils.ValidateHeaders(request.Headers); err != nil {
		return utils.CreateAPIResponse(401, utils.ErrorResponse(err.Error()))
	}

	// Get session from Redis
	rdb := utils.GetRedisClient()
	sessionState, err := utils.GetSession(ctx, rdb, sessionID)
	if err != nil {
		log.Printf("Error getting session %s: %v", sessionID, err)
		return utils.CreateAPIResponse(404, utils.ErrorResponse("Session not found"))
	}

	// Stop ECS task if it exists
	if sessionState.ECSTaskARN != "" {
		if err := utils.StopECSTask(ctx, sessionState.ECSTaskARN); err != nil {
			log.Printf("Error stopping ECS task %s: %v", sessionState.ECSTaskARN, err)
			// Continue with session cleanup even if task stop fails
		} else {
			log.Printf("Stopped ECS task %s for session %s", sessionState.ECSTaskARN, sessionID)
		}
	}

	// Update session status to STOPPED
	if err := utils.UpdateSessionStatus(ctx, rdb, sessionID, "STOPPED"); err != nil {
		log.Printf("Error updating session status: %v", err)
	}

	// Publish termination event
	terminationEvent := map[string]interface{}{
		"sessionId": sessionID,
		"reason":    "Session ended by user",
	}
	
	if err := utils.PublishEvent(ctx, sessionID, "SessionTerminated", terminationEvent); err != nil {
		log.Printf("Error publishing termination event: %v", err)
	}

	// Clean up session from Redis after a delay (allow ECS to finish cleanup)
	// In production, you might want to use a delayed job or DLQ
	go func() {
		// Give ECS controller time to clean up
		// time.Sleep(30 * time.Second)
		// utils.DeleteSession(context.Background(), rdb, sessionID)
	}()

	// Prepare success response
	response := types.SuccessResponse{
		Success: true,
		Data:    map[string]string{"message": "Session ended successfully"},
	}

	log.Printf("Ended session %s", sessionID)
	return utils.CreateAPIResponse(200, response)
}

func main() {
	lambda.Start(Handler)
} 