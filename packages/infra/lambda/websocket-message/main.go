package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/apigatewaymanagementapi"
	"github.com/redis/go-redis/v9"
)

// Environment variables
var (
	RedisEndpoint               = os.Getenv("REDIS_ENDPOINT")
	ECSClusterName             = os.Getenv("ECS_CLUSTER_NAME")
	BrowserTaskDefinitionARN   = os.Getenv("BROWSER_TASK_DEFINITION_ARN")
	Environment                = getEnvDefault("ENVIRONMENT", "dev")
)

// WebSocket message structure
type WebSocketMessage struct {
	Type      string      `json:"type"`
	ID        *int        `json:"id,omitempty"`
	Method    string      `json:"method,omitempty"`
	Params    interface{} `json:"params,omitempty"`
	SessionID string      `json:"sessionId,omitempty"`
	Data      interface{} `json:"data,omitempty"`
	Event     interface{} `json:"event,omitempty"`
}

// Connection mapping structure
type ConnectionMapping struct {
	SessionID    string `json:"sessionId"`
	ConnectedAt  string `json:"connectedAt"`
	LastActivity string `json:"lastActivity"`
}

// Response message structure
type ResponseMessage struct {
	Type      string      `json:"type"`
	ID        *int        `json:"id,omitempty"`
	Result    interface{} `json:"result,omitempty"`
	Error     string      `json:"error,omitempty"`
	Timestamp string      `json:"timestamp,omitempty"`
}

// Global clients
var (
	redisClient *redis.Client
)

func init() {
	// Initialize Redis client
	redisClient = redis.NewClient(&redis.Options{
		Addr:     fmt.Sprintf("%s:6379", RedisEndpoint),
		Password: os.Getenv("REDIS_PASSWORD"),
		DB:       0,
	})
}

func main() {
	lambda.Start(handler)
}

func handler(ctx context.Context, event events.APIGatewayWebsocketProxyRequest) (events.APIGatewayProxyResponse, error) {
	log.Printf("WebSocket Message Event: %+v", event)

	connectionID := event.RequestContext.ConnectionID

	// Get API Gateway Management API client
	apiGatewayClient, err := getAPIGatewayClient(event)
	if err != nil {
		log.Printf("Failed to create API Gateway client: %v", err)
		return events.APIGatewayProxyResponse{StatusCode: 500}, err
	}

	// Parse incoming message
	var message WebSocketMessage
	if err := json.Unmarshal([]byte(event.Body), &message); err != nil {
		log.Printf("Invalid JSON in message body: %v", err)
		sendErrorToConnection(ctx, apiGatewayClient, connectionID, "Invalid JSON in message body")
		return events.APIGatewayProxyResponse{StatusCode: 400}, nil
	}

	// Get session ID from connection
	sessionID, err := getSessionFromConnection(ctx, connectionID)
	if err != nil {
		log.Printf("Failed to get session from connection: %v", err)
		sendErrorToConnection(ctx, apiGatewayClient, connectionID, "Session not found for connection")
		return events.APIGatewayProxyResponse{StatusCode: 404}, nil
	}

	log.Printf("Processing message type: %s for session: %s", message.Type, sessionID)

	// Update connection activity
	if err := updateSessionActivity(ctx, sessionID); err != nil {
		log.Printf("Failed to update session activity: %v", err)
	}

	// Handle different message types
	switch message.Type {
	case "CDP_COMMAND":
		err = handleCDPCommand(ctx, apiGatewayClient, connectionID, sessionID, message)
	case "AI_ACTION":
		err = handleAIAction(ctx, apiGatewayClient, connectionID, sessionID, message)
	case "INPUT_EVENT":
		err = handleInputEvent(ctx, apiGatewayClient, connectionID, sessionID, message)
	case "START_SCREENCAST":
		err = handleStartScreencast(ctx, apiGatewayClient, connectionID, sessionID, message)
	case "STOP_SCREENCAST":
		err = handleStopScreencast(ctx, apiGatewayClient, connectionID, sessionID, message)
	case "PING":
		err = handlePing(ctx, apiGatewayClient, connectionID)
	default:
		log.Printf("Unknown message type: %s", message.Type)
		err = sendErrorToConnection(ctx, apiGatewayClient, connectionID, fmt.Sprintf("Unknown message type: %s", message.Type))
	}

	if err != nil {
		log.Printf("WebSocket message error: %v", err)
		sendErrorToConnection(ctx, apiGatewayClient, connectionID, err.Error())
		return events.APIGatewayProxyResponse{StatusCode: 500}, nil
	}

	return events.APIGatewayProxyResponse{StatusCode: 200}, nil
}

// getAPIGatewayClient creates an API Gateway Management API client
func getAPIGatewayClient(event events.APIGatewayWebsocketProxyRequest) (*apigatewaymanagementapi.Client, error) {
	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		return nil, err
	}

	domainName := event.RequestContext.DomainName
	stage := event.RequestContext.Stage
	endpoint := fmt.Sprintf("https://%s/%s", domainName, stage)

	client := apigatewaymanagementapi.NewFromConfig(cfg, func(o *apigatewaymanagementapi.Options) {
		o.BaseEndpoint = &endpoint
	})

	return client, nil
}

// sendToConnection sends a message to a WebSocket connection
func sendToConnection(ctx context.Context, client *apigatewaymanagementapi.Client, connectionID string, data interface{}) error {
	messageBytes, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("failed to marshal message: %w", err)
	}

	input := &apigatewaymanagementapi.PostToConnectionInput{
		ConnectionId: &connectionID,
		Data:         messageBytes,
	}

	_, err = client.PostToConnection(ctx, input)
	if err != nil {
		return fmt.Errorf("failed to send message to connection %s: %w", connectionID, err)
	}

	return nil
}

// sendErrorToConnection sends an error message to a WebSocket connection
func sendErrorToConnection(ctx context.Context, client *apigatewaymanagementapi.Client, connectionID, errorMsg string) error {
	errorResponse := ResponseMessage{
		Type:      "ERROR",
		Error:     errorMsg,
		Timestamp: time.Now().Format(time.RFC3339),
	}
	return sendToConnection(ctx, client, connectionID, errorResponse)
}

// getSessionFromConnection retrieves session ID from connection mapping
func getSessionFromConnection(ctx context.Context, connectionID string) (string, error) {
	connectionData, err := redisClient.Get(ctx, fmt.Sprintf("connection:%s", connectionID)).Result()
	if err != nil {
		return "", fmt.Errorf("connection not found: %w", err)
	}

	var connectionMapping ConnectionMapping
	if err := json.Unmarshal([]byte(connectionData), &connectionMapping); err != nil {
		return "", fmt.Errorf("failed to parse connection mapping: %w", err)
	}

	return connectionMapping.SessionID, nil
}

// updateSessionActivity updates the last activity timestamp for a session
func updateSessionActivity(ctx context.Context, sessionID string) error {
	return redisClient.HSet(ctx, fmt.Sprintf("session:%s", sessionID), "lastActivity", time.Now().Format(time.RFC3339)).Err()
}

// forwardToFargateTask forwards a message to the Fargate task via Redis queue
func forwardToFargateTask(ctx context.Context, sessionID string, message WebSocketMessage) error {
	messageWithTimestamp := map[string]interface{}{
		"type":      message.Type,
		"id":        message.ID,
		"method":    message.Method,
		"params":    message.Params,
		"data":      message.Data,
		"event":     message.Event,
		"timestamp": time.Now().Format(time.RFC3339),
		"sessionId": sessionID,
	}

	messageJSON, err := json.Marshal(messageWithTimestamp)
	if err != nil {
		return fmt.Errorf("failed to marshal message: %w", err)
	}

	// Store message in Redis queue for the task to process
	if err := redisClient.LPush(ctx, fmt.Sprintf("session:%s:messages", sessionID), string(messageJSON)).Err(); err != nil {
		return fmt.Errorf("failed to push message to queue: %w", err)
	}

	// Set expiration on the queue
	if err := redisClient.Expire(ctx, fmt.Sprintf("session:%s:messages", sessionID), time.Hour).Err(); err != nil {
		log.Printf("Failed to set queue expiration: %v", err)
	}

	log.Printf("Forwarded message to task for session %s: %s", sessionID, message.Type)
	return nil
}

// Message handlers for different types

func handleCDPCommand(ctx context.Context, client *apigatewaymanagementapi.Client, connectionID, sessionID string, message WebSocketMessage) error {
	// Ensure Fargate task is running and forward CDP command
	if err := forwardToFargateTask(ctx, sessionID, message); err != nil {
		return err
	}

	// Send acknowledgment
	response := ResponseMessage{
		Type: "CDP_RESPONSE",
		ID:   message.ID,
		Result: map[string]interface{}{
			"success": true,
			"message": "Command forwarded to browser",
		},
	}
	return sendToConnection(ctx, client, connectionID, response)
}

func handleAIAction(ctx context.Context, client *apigatewaymanagementapi.Client, connectionID, sessionID string, message WebSocketMessage) error {
	// Forward AI action to Fargate task
	if err := forwardToFargateTask(ctx, sessionID, message); err != nil {
		return err
	}

	// Send acknowledgment
	response := ResponseMessage{
		Type: "AI_ACTION_RESPONSE",
		Result: map[string]interface{}{
			"success": true,
			"message": "Action forwarded to browser",
		},
	}
	return sendToConnection(ctx, client, connectionID, response)
}

func handleInputEvent(ctx context.Context, client *apigatewaymanagementapi.Client, connectionID, sessionID string, message WebSocketMessage) error {
	// Forward input event to task
	if err := forwardToFargateTask(ctx, sessionID, message); err != nil {
		return err
	}

	// Send acknowledgment
	response := ResponseMessage{
		Type: "INPUT_RESPONSE",
		Result: map[string]interface{}{
			"success": true,
			"message": "Input forwarded to browser",
		},
	}
	return sendToConnection(ctx, client, connectionID, response)
}

func handleStartScreencast(ctx context.Context, client *apigatewaymanagementapi.Client, connectionID, sessionID string, message WebSocketMessage) error {
	// Forward screencast request to task
	if err := forwardToFargateTask(ctx, sessionID, message); err != nil {
		return err
	}

	// Send acknowledgment
	response := ResponseMessage{
		Type: "SCREENCAST_STARTED",
		Result: map[string]interface{}{
			"success": true,
			"message": "Screencast started",
		},
	}
	return sendToConnection(ctx, client, connectionID, response)
}

func handleStopScreencast(ctx context.Context, client *apigatewaymanagementapi.Client, connectionID, sessionID string, message WebSocketMessage) error {
	// Forward stop request to task
	if err := forwardToFargateTask(ctx, sessionID, message); err != nil {
		return err
	}

	// Send acknowledgment
	response := ResponseMessage{
		Type: "SCREENCAST_STOPPED",
		Result: map[string]interface{}{
			"success": true,
			"message": "Screencast stopped",
		},
	}
	return sendToConnection(ctx, client, connectionID, response)
}

func handlePing(ctx context.Context, client *apigatewaymanagementapi.Client, connectionID string) error {
	// Health check response
	response := ResponseMessage{
		Type:      "PONG",
		Timestamp: time.Now().Format(time.RFC3339),
	}
	return sendToConnection(ctx, client, connectionID, response)
}

// getEnvDefault gets environment variable with default value
func getEnvDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
} 