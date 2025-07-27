package main

import (
	"context"
	"fmt"
	"log"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/wallcrawler/backend-go/internal/utils"
)

// Handler processes the /sessions/{sessionId}/debug request
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

	var debuggerURL string
	var wsURL string

	// Get task IP to construct proper URLs
	if sessionState.ECSTaskARN != "" {
		taskIP, err := utils.GetECSTaskPublicIP(ctx, sessionState.ECSTaskARN)
		if err == nil && taskIP != "" {
			debuggerURL = utils.CreateDebugURL(taskIP)
			wsURL = utils.CreateCDPURL(taskIP)
		} else {
			log.Printf("Failed to get task IP for debug URLs: %v", err)
		}
	}

	// Fallback URLs if we can't get task IP
	if debuggerURL == "" {
		debuggerURL = fmt.Sprintf("%s/debug/%s", utils.ConnectURL, sessionID)
		wsURL = sessionState.ConnectURL
	}

	// Prepare response in SessionLiveURLs format
	response := map[string]interface{}{
		"debuggerUrl":            debuggerURL,
		"debuggerFullscreenUrl":  debuggerURL + "?embedded=true",
		"wsUrl":                  wsURL,
		"pages": []map[string]interface{}{
			{
				"id":                    "page_" + sessionID,
				"debuggerUrl":           debuggerURL,
				"debuggerFullscreenUrl": debuggerURL + "?embedded=true",
				"faviconUrl":            "",
				"title":                 "Browser Session",
				"url":                   "about:blank",
			},
		},
	}

	log.Printf("Provided debug URL for session %s: %s", sessionID, debuggerURL)
	return utils.CreateAPIResponse(200, utils.SuccessResponse(response))
}

func main() {
	lambda.Start(Handler)
} 