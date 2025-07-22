package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/aws/aws-lambda-go/events"
)

// LambdaResponse creates a standardized API Gateway response
func LambdaResponse(statusCode int, body interface{}) events.APIGatewayProxyResponse {
	jsonBody, _ := json.Marshal(body)

	return events.APIGatewayProxyResponse{
		StatusCode: statusCode,
		Headers: map[string]string{
			"Content-Type":                 "application/json",
			"Access-Control-Allow-Origin":  "*",
			"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type, Authorization",
		},
		Body: string(jsonBody),
	}
}

// LambdaErrorResponse creates an error response for Lambda functions
func LambdaErrorResponse(statusCode int, message string, details ...string) events.APIGatewayProxyResponse {
	errorBody := map[string]interface{}{
		"success": false,
		"error":   message,
	}

	if len(details) > 0 {
		errorBody["details"] = details[0]
	}

	return LambdaResponse(statusCode, errorBody)
}

// LambdaSuccessResponse creates a success response for Lambda functions
func LambdaSuccessResponse(data interface{}) events.APIGatewayProxyResponse {
	successBody := map[string]interface{}{
		"success": true,
		"data":    data,
	}

	return LambdaResponse(http.StatusOK, successBody)
}

// WebSocketResponse creates a WebSocket API response
func WebSocketResponse(statusCode int) events.APIGatewayProxyResponse {
	return events.APIGatewayProxyResponse{
		StatusCode: statusCode,
		Headers: map[string]string{
			"Content-Type": "application/json",
		},
	}
}

// WebSocketErrorResponse creates an error response for WebSocket functions
func WebSocketErrorResponse(statusCode int, message string) events.APIGatewayProxyResponse {
	return WebSocketResponse(statusCode)
}
