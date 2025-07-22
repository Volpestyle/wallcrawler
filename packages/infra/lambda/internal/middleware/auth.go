package middleware

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/wallcrawler/go-lambda/internal/handlers"
	shared "github.com/wallcrawler/go-shared"
)

// ValidateAPIKey validates API key from Lambda event headers
func ValidateAPIKey(event events.APIGatewayProxyRequest) (string, *events.APIGatewayProxyResponse) {
	// Extract API key from Authorization header
	authHeader := event.Headers["Authorization"]
	if authHeader == "" {
		authHeader = event.Headers["authorization"] // Try lowercase
	}

	if authHeader == "" {
		errorResp := handlers.LambdaErrorResponse(401, "Missing Authorization header")
		return "", &errorResp
	}

	// Remove "Bearer " prefix if present
	apiKey := strings.TrimPrefix(authHeader, "Bearer ")
	if apiKey == authHeader && strings.HasPrefix(authHeader, "bearer ") {
		apiKey = strings.TrimPrefix(authHeader, "bearer ")
	}

	if apiKey == "" {
		errorResp := handlers.LambdaErrorResponse(401, "Invalid API key format")
		return "", &errorResp
	}

	// TODO: Add actual API key validation logic here
	// For now, just check it's not empty
	if len(apiKey) < 10 {
		errorResp := handlers.LambdaErrorResponse(401, "Invalid API key")
		return "", &errorResp
	}

	return apiKey, nil
}

// ValidateWebSocketToken validates JWT token from WebSocket query parameters
func ValidateWebSocketToken(event events.APIGatewayWebsocketProxyRequest) (string, *events.APIGatewayProxyResponse) {
	token := event.QueryStringParameters["token"]
	if token == "" {
		errorResp := handlers.WebSocketErrorResponse(401, "Missing token parameter")
		return "", &errorResp
	}

	sessionID, err := shared.ValidateJWTTokenSimple(token)
	if err != nil {
		errorResp := handlers.WebSocketErrorResponse(401, "Invalid token")
		return "", &errorResp
	}

	return sessionID, nil
}

// ParseRequestBody parses JSON request body with error handling
func ParseRequestBody(event events.APIGatewayProxyRequest, target interface{}) *events.APIGatewayProxyResponse {
	if event.Body == "" {
		errorResp := handlers.LambdaErrorResponse(400, "Missing request body")
		return &errorResp
	}

	if err := json.Unmarshal([]byte(event.Body), target); err != nil {
		errorResp := handlers.LambdaErrorResponse(400, "Invalid JSON in request body", err.Error())
		return &errorResp
	}

	return nil
}

// LogRequest logs incoming Lambda requests for debugging
func LogRequest(event events.APIGatewayProxyRequest, functionName string) {
	fmt.Printf("[%s] %s %s\n", functionName, event.HTTPMethod, event.Path)
	fmt.Printf("[%s] Headers: %+v\n", functionName, event.Headers)
	if event.Body != "" && len(event.Body) < 1000 {
		fmt.Printf("[%s] Body: %s\n", functionName, event.Body)
	}
}
