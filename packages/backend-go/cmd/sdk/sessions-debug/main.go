package main

import (
	"context"
	"fmt"
	"log"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/wallcrawler/backend-go/internal/utils"
)

// SessionLiveURLsResponse represents the debug/live URLs response format
type SessionLiveURLsResponse struct {
	DebuggerFullscreenURL string                `json:"debuggerFullscreenUrl"`
	DebuggerURL           string                `json:"debuggerUrl"`
	WsURL                 string                `json:"wsUrl"`
	Pages                 []SessionLiveURLsPage `json:"pages"`
}

type SessionLiveURLsPage struct {
	ID                    string `json:"id"`
	DebuggerFullscreenURL string `json:"debuggerFullscreenUrl"`
	DebuggerURL           string `json:"debuggerUrl"`
	FaviconURL            string `json:"faviconUrl"`
	Title                 string `json:"title"`
	URL                   string `json:"url"`
}

// Handler processes GET /v1/sessions/{id}/debug (SDK-compatible debug/live URLs)
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

	// Check if session is active and has public IP
	if !utils.IsSessionActive(sessionState.Status) {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Session is not active"))
	}

	if sessionState.PublicIP == "" {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Session browser is not ready yet. Debug URLs not available."))
	}

	// Get JWT token from session state
	jwtToken := sessionState.SigningKey
	if jwtToken == "" {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Session authentication token not available"))
	}

	// Create debug URLs using utility functions for consistency
	debuggerURL := utils.CreateDebuggerURL(sessionState.PublicIP, jwtToken)
	debuggerFullscreenURL := utils.CreateDebuggerFullscreenURL(sessionState.PublicIP, jwtToken)

	// The wsUrl for the response should be the same as connectUrl for WebSocket connections
	responseWSURL := sessionState.ConnectURL

	// Create response with proper debug URLs
	response := SessionLiveURLsResponse{
		DebuggerFullscreenURL: debuggerFullscreenURL,
		DebuggerURL:           debuggerURL,
		WsURL:                 responseWSURL,
		Pages: []SessionLiveURLsPage{
			{
				ID:                    fmt.Sprintf("page_%s", sessionState.ID),
				DebuggerFullscreenURL: debuggerFullscreenURL,
				DebuggerURL:           debuggerURL,
				FaviconURL:            "",
				Title:                 "Browser Session",
				URL:                   "about:blank",
			},
		},
	}

	log.Printf("Generated debug URLs for session %s with IP %s", sessionID, sessionState.PublicIP)
	return utils.CreateAPIResponse(200, utils.SuccessResponse(response))
}

func main() {
	lambda.Start(Handler)
}
