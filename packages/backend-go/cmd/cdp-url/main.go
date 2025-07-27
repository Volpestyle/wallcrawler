package main

import (
	"context"
	"encoding/json"
	"log"
	"net"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/wallcrawler/backend-go/internal/utils"
)

// CDPURLRequest represents the request for generating a signed CDP URL
type CDPURLRequest struct {
	SessionID string `json:"sessionId"`
	Scope     string `json:"scope,omitempty"` // "cdp-direct", "debug", "screencast"
}

// CDPURLResponse represents the response with signed URLs
type CDPURLResponse struct {
	SessionID   string                   `json:"sessionId"`
	CDPUrl      string                   `json:"cdpUrl"`
	ExpiresIn   int64                    `json:"expiresIn"`
	DebuggerUrl string                   `json:"debuggerUrl,omitempty"`
	Pages       []CDPPageInfo            `json:"pages,omitempty"`
}

type CDPPageInfo struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	URL         string `json:"url"`
	FaviconURL  string `json:"faviconUrl"`
	CDPUrl      string `json:"cdpUrl"`
	DebuggerUrl string `json:"debuggerUrl"`
}

// Handler processes the /sessions/{sessionId}/cdp-url request
func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// Extract session ID from path parameters
	sessionID := request.PathParameters["sessionId"]
	if sessionID == "" {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Missing sessionId parameter"))
	}

	// Validate headers (API key and project ID)
	if err := utils.ValidateHeaders(request.Headers); err != nil {
		return utils.CreateAPIResponse(401, utils.ErrorResponse(err.Error()))
	}

	// Parse request body if provided (for scope specification)
	var req CDPURLRequest
	if request.Body != "" {
		if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
			log.Printf("Error parsing request body: %v", err)
			// Continue with default values if body parsing fails
		}
	}

	// Set defaults
	if req.SessionID == "" {
		req.SessionID = sessionID
	}
	if req.Scope == "" {
		req.Scope = "cdp-direct" // Default scope
	}

	// Validate scope
	validScopes := map[string]bool{
		"cdp-direct": true,
		"debug":      true,
		"screencast": true,
	}
	if !validScopes[req.Scope] {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Invalid scope. Must be one of: cdp-direct, debug, screencast"))
	}

	// Get session from Redis to verify it exists and is accessible
	rdb := utils.GetRedisClient()
	sessionState, err := utils.GetSession(ctx, rdb, sessionID)
	if err != nil {
		log.Printf("Error getting session %s: %v", sessionID, err)
		return utils.CreateAPIResponse(404, utils.ErrorResponse("Session not found"))
	}

	// Validate session status
	if !utils.IsSessionActive(sessionState.Status) {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Session is not in an active state"))
	}

	// Extract client IP for additional security
	clientIP := getClientIP(request)

	// Generate signed CDP URL
	projectID := request.Headers["x-wc-project-id"]
	userID := request.Headers["x-wc-user-id"] // Optional
	
	signedCDPURL, err := utils.GenerateSignedCDPURL(sessionID, projectID, userID, req.Scope, clientIP)
	if err != nil {
		log.Printf("Error generating signed CDP URL: %v", err)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to generate secure CDP URL"))
	}

	// Get ECS task IP for constructing URLs
	var taskIP string
	if sessionState.ECSTaskARN != "" {
		taskIP, err = utils.GetECSTaskPublicIP(ctx, sessionState.ECSTaskARN)
		if err != nil {
			log.Printf("Failed to get task IP for session %s: %v", sessionID, err)
		}
	}

	// Construct the final CDP URL (points to our authenticated proxy)
	cdpProxyURL := signedCDPURL
	if taskIP != "" {
		// Replace localhost with actual task IP
		cdpProxyURL = strings.Replace(signedCDPURL, "localhost", taskIP, 1)
	}

	// Prepare response
	response := CDPURLResponse{
		SessionID: sessionID,
		CDPUrl:    cdpProxyURL,
		ExpiresIn: 600, // 10 minutes
	}

	// Add additional URLs based on scope
	if taskIP != "" {
		switch req.Scope {
		case "debug":
			// Generate debugger URL that uses our signed CDP URL
			response.DebuggerUrl = generateDebuggerURL(taskIP, signedCDPURL)
			
			// Add page information (mock for now, could be enhanced)
			response.Pages = []CDPPageInfo{
				{
					ID:          "page_" + sessionID,
					Title:       "Browser Session",
					URL:         "about:blank",
					FaviconURL:  "",
					CDPUrl:      cdpProxyURL,
					DebuggerUrl: response.DebuggerUrl,
				},
			}
		case "screencast":
			// For screencast, we provide URLs that connect directly to Chrome's DevTools screencast
			response.DebuggerUrl = generateScreencastURL(taskIP, signedCDPURL)
			
			// Add page information for screencast
			response.Pages = []CDPPageInfo{
				{
					ID:          "page_" + sessionID,
					Title:       "Browser Screencast",
					URL:         "about:blank",
					FaviconURL:  "",
					CDPUrl:      cdpProxyURL,
					DebuggerUrl: response.DebuggerUrl,
				},
			}
		}
	}

	log.Printf("Generated signed CDP URL for session %s, scope %s, expires in %d seconds", 
		sessionID, req.Scope, response.ExpiresIn)

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
		if net.ParseIP(clientIP) != nil {
			return clientIP
		}
	}

	// Try X-Real-IP
	xRealIP := request.Headers["X-Real-IP"]
	if xRealIP != "" && net.ParseIP(xRealIP) != nil {
		return xRealIP
	}

	// Fall back to request context source IP
	if request.RequestContext.Identity.SourceIP != "" {
		return request.RequestContext.Identity.SourceIP
	}

	return "unknown"
}

// generateDebuggerURL creates a debugger URL that works with our signed CDP URLs
func generateDebuggerURL(taskIP, signedCDPURL string) string {
	// For now, return a simple debugger URL
	// In a full implementation, this could be a custom debugger interface
	// that accepts the signed CDP URL as a parameter
	return "https://wallcrawler.com/devtools/inspector.html?ws=" + 
		strings.TrimPrefix(signedCDPURL, "ws://")
}

// generateScreencastURL creates a screencast URL that connects to Chrome's native screencast
func generateScreencastURL(taskIP, signedCDPURL string) string {
	// Return a screencast-specific URL that can connect to Chrome's DevTools screencast
	// This could be a custom viewer interface or direct DevTools screencast
	return "https://wallcrawler.com/screencast?ws=" + 
		strings.TrimPrefix(signedCDPURL, "ws://")
}

func main() {
	lambda.Start(Handler)
} 