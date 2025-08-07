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

	// Validate API key header only
	if request.Headers["x-wc-api-key"] == "" {
		return utils.CreateAPIResponse(401, utils.ErrorResponse("Missing required header: x-wc-api-key"))
	}

	// Get DynamoDB client
	ddbClient, err := utils.GetDynamoDBClient(ctx)
	if err != nil {
		log.Printf("Error getting DynamoDB client: %v", err)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to initialize storage"))
	}

	// Get session from DynamoDB
	sessionState, err := utils.GetSession(ctx, ddbClient, sessionID)
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
	if sessionState.SigningKey == nil || *sessionState.SigningKey == "" {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Session authentication token not available"))
	}
	jwtToken := *sessionState.SigningKey

	// Create debug URLs using utility functions for consistency
	debuggerURL := utils.CreateDebuggerURL(sessionState.PublicIP, jwtToken)
	debuggerFullscreenURL := utils.CreateDebuggerFullscreenURL(sessionState.PublicIP, jwtToken)

	// The wsUrl for the response should be the same as connectUrl for WebSocket connections
	responseWSURL := ""
	if sessionState.ConnectURL != nil {
		responseWSURL = *sessionState.ConnectURL
	}

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
	lambda.Start(func(ctx context.Context, event interface{}) (interface{}, error) {
		// Parse the event using the utility function
		parsedEvent, eventType, err := utils.ParseLambdaEvent(event)
		if err != nil {
			return nil, err
		}
		
		if eventType != utils.EventTypeAPIGateway {
			return nil, fmt.Errorf("expected API Gateway event, got %v", eventType)
		}
		
		apiReq := parsedEvent.(events.APIGatewayProxyRequest)
		return Handler(ctx, apiReq)
	})
}
