package main

import (
	"context"
	"log"
	"strings"

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

	// Extract client IP for additional security
	clientIP := getClientIP(request)
	
	// Generate signed CDP URL for secure access
	projectID := request.Headers["x-wc-project-id"]
	userID := request.Headers["x-wc-user-id"] // Optional
	
	signedCDPURL, err := utils.GenerateSignedCDPURL(sessionID, projectID, userID, "debug", clientIP)
	if err != nil {
		log.Printf("Error generating signed CDP URL: %v", err)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to generate secure CDP URL"))
	}

	// Get task IP to construct proper URLs
	var taskIP string
	var wsURL string
	var debuggerURL string
	
	if sessionState.ECSTaskARN != "" {
		taskIP, err = utils.GetECSTaskPublicIP(ctx, sessionState.ECSTaskARN)
		if err == nil && taskIP != "" {
			// Use signed URL with actual task IP
			wsURL = strings.Replace(signedCDPURL, "localhost", taskIP, 1)
			debuggerURL = generateDebuggerURL(taskIP, signedCDPURL)
		} else {
			log.Printf("Failed to get task IP for debug URLs: %v", err)
		}
	}

	// Fallback to signed URL with localhost if we can't get task IP
	if wsURL == "" {
		wsURL = signedCDPURL
		debuggerURL = "https://wallcrawler.com/devtools/inspector.html?ws=" + 
			strings.TrimPrefix(signedCDPURL, "ws://")
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

// getClientIP extracts the client IP address from the request
func getClientIP(request events.APIGatewayProxyRequest) string {
	// Try X-Forwarded-For first (most common in load balancers)
	xForwardedFor := request.Headers["X-Forwarded-For"]
	if xForwardedFor != "" {
		// X-Forwarded-For can contain multiple IPs, take the first one
		ips := strings.Split(xForwardedFor, ",")
		clientIP := strings.TrimSpace(ips[0])
		return clientIP
	}

	// Try X-Real-IP
	xRealIP := request.Headers["X-Real-IP"]
	if xRealIP != "" {
		return xRealIP
	}

	// Fall back to request context source IP
	if request.RequestContext.Identity.SourceIP != "" {
		return request.RequestContext.Identity.SourceIP
	}

	return "unknown"
}

// generateDebuggerURL creates a debugger URL that works with signed CDP URLs
func generateDebuggerURL(taskIP, signedCDPURL string) string {
	// Create a debugger URL that uses our authenticated CDP proxy
	return "https://wallcrawler.com/devtools/inspector.html?ws=" + 
		strings.TrimPrefix(signedCDPURL, "ws://")
}

func main() {
	lambda.Start(Handler)
} 