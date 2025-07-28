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

// CDPURLRequest represents the request body for CDP URL generation
type CDPURLRequest struct {
	ExpiresIn int `json:"expiresIn,omitempty"` // Optional: custom expiration in seconds (default: 600)
}

// CDPURLResponse represents the response for CDP URL generation
type CDPURLResponse struct {
	SessionID   string `json:"sessionId"`
	CDPURL      string `json:"cdpUrl"`
	ExpiresIn   int    `json:"expiresIn"`
	ExpiresAt   string `json:"expiresAt"`
	SigningKey  string `json:"signingKey,omitempty"` // Include the raw JWT token for debugging
	DebuggerURL string `json:"debuggerUrl,omitempty"`
}

// Handler processes POST /sessions/{sessionId}/cdp-url (Wallcrawler-specific CDP URL generation)
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

	// Parse request body
	var req CDPURLRequest
	if request.Body != "" {
		if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
			return utils.CreateAPIResponse(400, utils.ErrorResponse("Invalid JSON in request body"))
		}
	}

	// Set default expiration if not provided (10 minutes)
	if req.ExpiresIn == 0 {
		req.ExpiresIn = 600 // 10 minutes
	}

	// Get session from Redis to validate it exists and get public IP
	rdb := utils.GetRedisClient()
	sessionState, err := utils.GetSession(ctx, rdb, sessionID)
	if err != nil {
		log.Printf("Error getting session %s: %v", sessionID, err)
		return utils.CreateAPIResponse(404, utils.ErrorResponse("Session not found"))
	}

	// Check if session is active
	if !utils.IsSessionActive(sessionState.Status) {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Session is not active"))
	}

	// Check if session has a public IP (ECS task must be running)
	if sessionState.PublicIP == "" {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Session browser is not ready yet. Public IP not available."))
	}

	// Extract project ID and user ID from headers
	projectID := request.Headers["x-wc-project-id"]
	userID := request.Headers["x-wc-user-id"] // Optional

	// Get client IP for token binding (optional security)
	clientIP := request.Headers["x-forwarded-for"]
	if clientIP == "" {
		clientIP = request.RequestContext.Identity.SourceIP
	}

	// Create JWT payload - no scope needed, authenticated users get full access
	now := time.Now()
	expiresAt := now.Add(time.Duration(req.ExpiresIn) * time.Second)
	
	payload := utils.CDPSigningPayload{
		SessionID: sessionID,
		ProjectID: projectID,
		UserID:    userID,
		IssuedAt:  now.Unix(),
		ExpiresAt: expiresAt.Unix(),
		Nonce:     utils.GenerateRandomNonce(),
		IPAddress: clientIP,
	}

	// Generate JWT token
	jwtToken, err := utils.CreateCDPToken(payload)
	if err != nil {
		log.Printf("Error creating CDP token for session %s: %v", sessionID, err)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to generate CDP access token"))
	}

	// Generate URLs using utility functions
	cdpURL := utils.CreateAuthenticatedCDPURL(sessionState.PublicIP, jwtToken)
	debuggerURL := utils.CreateDebuggerURL(sessionState.PublicIP, jwtToken)

	// Create response
	response := CDPURLResponse{
		SessionID:   sessionID,
		CDPURL:      cdpURL,
		ExpiresIn:   req.ExpiresIn,
		ExpiresAt:   expiresAt.Format(time.RFC3339),
		SigningKey:  jwtToken,
		DebuggerURL: debuggerURL,
	}

	log.Printf("Generated CDP URL for session %s: %s (expires: %s)", 
		sessionID, cdpURL, expiresAt.Format(time.RFC3339))
	
	return utils.CreateAPIResponse(200, utils.SuccessResponse(response))
}

func main() {
	lambda.Start(Handler)
}
