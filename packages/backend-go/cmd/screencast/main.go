package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/apigatewaymanagementapi"
	"github.com/redis/go-redis/v9"
	"github.com/wallcrawler/backend-go/internal/utils"
)

type ScreencastMessage struct {
	Action    string `json:"action"`
	FrameRate int    `json:"frameRate,omitempty"`
}

type FrameData struct {
	Type      string `json:"type"`
	Data      string `json:"data"`
	Timestamp int64  `json:"timestamp"`
}

func Handler(ctx context.Context, request events.APIGatewayWebsocketProxyRequest) (events.APIGatewayProxyResponse, error) {
	log.Printf("Screencast WebSocket event: %s for connection %s", request.RequestContext.RouteKey, request.RequestContext.ConnectionID)

	// Get Redis client
	rdb := utils.GetRedisClient()

	switch request.RequestContext.RouteKey {
	case "$connect":
		return handleConnect(ctx, request, rdb)
	case "$disconnect":
		return handleDisconnect(ctx, request, rdb)
	case "screencast":
		return handleScreencastMessage(ctx, request, rdb)
	default:
		log.Printf("Unknown route: %s", request.RequestContext.RouteKey)
		return events.APIGatewayProxyResponse{StatusCode: 400}, nil
	}
}

func handleConnect(ctx context.Context, request events.APIGatewayWebsocketProxyRequest, rdb *redis.Client) (events.APIGatewayProxyResponse, error) {
	// Extract session ID from query string parameters
	sessionID := request.QueryStringParameters["sessionId"]
	if sessionID == "" {
		log.Printf("Missing sessionId in WebSocket connection")
		return events.APIGatewayProxyResponse{StatusCode: 400}, nil
	}

	// Validate API key from query parameters (WebSocket auth)
	apiKey := request.QueryStringParameters["apiKey"]
	if apiKey == "" {
		log.Printf("Missing apiKey in WebSocket connection")
		return events.APIGatewayProxyResponse{StatusCode: 401}, nil
	}

	// Verify session exists and is active
	sessionState, err := utils.GetSession(ctx, rdb, sessionID)
	if err != nil {
		log.Printf("Session %s not found: %v", sessionID, err)
		return events.APIGatewayProxyResponse{StatusCode: 404}, nil
	}

	if sessionState.Status != "running" {
		log.Printf("Session %s is not running (status: %s)", sessionID, sessionState.Status)
		return events.APIGatewayProxyResponse{StatusCode: 400}, nil
	}

	// Store connection in Redis for this session
	connectionKey := fmt.Sprintf("session:%s:viewers", sessionID)
	err = rdb.SAdd(ctx, connectionKey, request.RequestContext.ConnectionID).Err()
	if err != nil {
		log.Printf("Error storing connection for session %s: %v", sessionID, err)
		return events.APIGatewayProxyResponse{StatusCode: 500}, nil
	}

	// Set expiration for connection tracking (1 hour)
	rdb.Expire(ctx, connectionKey, 3600)

	// Check if this is the first viewer - if so, start frame capture
	viewerCount, err := rdb.SCard(ctx, connectionKey).Result()
	if err == nil && viewerCount == 1 {
		// Publish event directly to Redis for ECS controller
		captureEvent := map[string]interface{}{
			"sessionId": sessionID,
			"action":    "start_capture",
			"frameRate": 30,
		}
		
		// Publish to Redis channel that ECS controller is listening to
		eventChannel := fmt.Sprintf("session:%s:events", sessionID)
		eventJSON, _ := json.Marshal(captureEvent)
		if err := rdb.Publish(ctx, eventChannel, string(eventJSON)).Err(); err != nil {
			log.Printf("Error publishing frame capture start event to Redis: %v", err)
		} else {
			log.Printf("Published start_capture event to Redis channel: %s", eventChannel)
		}
	}

	log.Printf("WebSocket connection established for session %s, connection %s", sessionID, request.RequestContext.ConnectionID)
	
	return events.APIGatewayProxyResponse{StatusCode: 200}, nil
}

func handleDisconnect(ctx context.Context, request events.APIGatewayWebsocketProxyRequest, rdb *redis.Client) (events.APIGatewayProxyResponse, error) {
	connectionID := request.RequestContext.ConnectionID

	// Find which session this connection belongs to
	// We'll need to scan through active sessions (could be optimized with a reverse lookup)
	sessionPattern := "session:*:viewers"
	sessions, err := rdb.Keys(ctx, sessionPattern).Result()
	if err != nil {
		log.Printf("Error scanning for sessions: %v", err)
		return events.APIGatewayProxyResponse{StatusCode: 200}, nil // Return 200 anyway
	}

	var sessionID string
	for _, sessionKey := range sessions {
		isMember, err := rdb.SIsMember(ctx, sessionKey, connectionID).Result()
		if err == nil && isMember {
			// Extract session ID from key format: session:{id}:viewers
			sessionID = sessionKey[8 : len(sessionKey)-8] // Remove "session:" prefix and ":viewers" suffix
			
			// Remove connection from this session
			rdb.SRem(ctx, sessionKey, connectionID)
			
			// Check if this was the last viewer
			viewerCount, err := rdb.SCard(ctx, sessionKey).Result()
			if err == nil && viewerCount == 0 {
				// Stop frame capture if no more viewers - publish directly to Redis
				captureEvent := map[string]interface{}{
					"sessionId": sessionID,
					"action":    "stop_capture",
				}
				
				// Publish to Redis channel that ECS controller is listening to
				eventChannel := fmt.Sprintf("session:%s:events", sessionID)
				eventJSON, _ := json.Marshal(captureEvent)
				if err := rdb.Publish(ctx, eventChannel, string(eventJSON)).Err(); err != nil {
					log.Printf("Error publishing frame capture stop event to Redis: %v", err)
				} else {
					log.Printf("Published stop_capture event to Redis channel: %s", eventChannel)
				}
			}
			break
		}
	}

	if sessionID != "" {
		log.Printf("WebSocket disconnected for session %s, connection %s", sessionID, connectionID)
	} else {
		log.Printf("WebSocket disconnected for unknown session, connection %s", connectionID)
	}

	return events.APIGatewayProxyResponse{StatusCode: 200}, nil
}

func handleScreencastMessage(ctx context.Context, request events.APIGatewayWebsocketProxyRequest, rdb *redis.Client) (events.APIGatewayProxyResponse, error) {
	var message ScreencastMessage
	if err := json.Unmarshal([]byte(request.Body), &message); err != nil {
		log.Printf("Error parsing screencast message: %v", err)
		return events.APIGatewayProxyResponse{StatusCode: 400}, nil
	}

	log.Printf("Received screencast message: %+v from connection %s", message, request.RequestContext.ConnectionID)

	// Handle different message types
	switch message.Action {
	case "ping":
		// Send pong response
		return sendMessageToConnection(ctx, request.RequestContext, map[string]string{
			"type": "pong",
		})
	case "adjust_framerate":
		// Could implement frame rate adjustment here
		log.Printf("Frame rate adjustment not yet implemented: %d FPS", message.FrameRate)
	default:
		log.Printf("Unknown screencast action: %s", message.Action)
	}

	return events.APIGatewayProxyResponse{StatusCode: 200}, nil
}

func sendMessageToConnection(ctx context.Context, requestContext events.APIGatewayWebsocketProxyRequestContext, message interface{}) (events.APIGatewayProxyResponse, error) {
	// Get AWS config for API Gateway Management API
	cfg, err := utils.GetAWSConfig()
	if err != nil {
		log.Printf("Error getting AWS config: %v", err)
		return events.APIGatewayProxyResponse{StatusCode: 500}, nil
	}

	// Create API Gateway Management API client
	endpoint := fmt.Sprintf("https://%s/%s", requestContext.DomainName, requestContext.Stage)
	apiClient := apigatewaymanagementapi.NewFromConfig(cfg, func(o *apigatewaymanagementapi.Options) {
		o.BaseEndpoint = aws.String(endpoint)
	})

	// Marshal message to JSON
	messageBytes, err := json.Marshal(message)
	if err != nil {
		log.Printf("Error marshaling message: %v", err)
		return events.APIGatewayProxyResponse{StatusCode: 500}, nil
	}

	// Send message to connection
	_, err = apiClient.PostToConnection(ctx, &apigatewaymanagementapi.PostToConnectionInput{
		ConnectionId: aws.String(requestContext.ConnectionID),
		Data:         messageBytes,
	})

	if err != nil {
		log.Printf("Error sending message to connection %s: %v", requestContext.ConnectionID, err)
		return events.APIGatewayProxyResponse{StatusCode: 500}, nil
	}

	return events.APIGatewayProxyResponse{StatusCode: 200}, nil
}

func main() {
	lambda.Start(Handler)
} 