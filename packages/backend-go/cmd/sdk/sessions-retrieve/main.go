package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/wallcrawler/backend-go/internal/utils"
)

// Handler processes GET /v1/sessions/{id} (SDK-compatible session retrieval)
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

	// Get session from Redis
	rdb := utils.GetRedisClient()
	sessionState, err := utils.GetSession(ctx, rdb, sessionID)
	if err != nil {
		log.Printf("Error getting session %s: %v", sessionID, err)
		return utils.CreateAPIResponse(404, utils.ErrorResponse("Session not found"))
	}

	// Get connect URL base from environment (set by CDK)
	connectURLBase := os.Getenv("CONNECT_URL_BASE")
	if connectURLBase == "" {
		connectURLBase = "https://api.wallcrawler.dev" // Fallback to default
	}

	// Check the request path to determine response format
	path := request.Path
	
	switch {
	case path == fmt.Sprintf("/v1/sessions/%s/debug", sessionID):
		// Return debug/live URLs format
		response := map[string]interface{}{
			"debuggerFullscreenUrl": fmt.Sprintf("%s/debug/%s/fullscreen", connectURLBase, sessionState.ID),
			"debuggerUrl":           fmt.Sprintf("%s/debug/%s", connectURLBase, sessionState.ID),
			"wsUrl":                 sessionState.ConnectURL,
			"pages": []map[string]interface{}{
				{
					"id":                    fmt.Sprintf("page_%s", sessionState.ID),
					"debuggerFullscreenUrl": fmt.Sprintf("%s/debug/%s/page/1/fullscreen", connectURLBase, sessionState.ID),
					"debuggerUrl":           fmt.Sprintf("%s/debug/%s/page/1", connectURLBase, sessionState.ID),
					"faviconUrl":            "",
					"title":                 "Browser Session",
					"url":                   "about:blank",
				},
			},
		}
		return utils.CreateAPIResponse(200, utils.SuccessResponse(response))
		
	case path == fmt.Sprintf("/v1/sessions/%s", sessionID):
		// Return full session details
		response := utils.ConvertToSDKRetrieveResponse(sessionState)
		return utils.CreateAPIResponse(200, utils.SuccessResponse(response))
		
	default:
		// Handle other SDK endpoints with placeholder response
		response := map[string]interface{}{
			"message": "Endpoint temporarily returns placeholder data",
			"sessionId": sessionID,
			"status": sessionState.Status,
		}
		return utils.CreateAPIResponse(200, utils.SuccessResponse(response))
	}
}

func main() {
	lambda.Start(Handler)
}
