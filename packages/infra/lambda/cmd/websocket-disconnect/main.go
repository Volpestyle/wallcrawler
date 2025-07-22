package main

import (
	"context"
	"log"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/wallcrawler/go-lambda/internal/handlers"
	shared "github.com/wallcrawler/go-shared"
)

// Global clients
var (
	redisClient *shared.RedisClient
)

func init() {
	redisClient = shared.NewRedisClient()
}

func main() {
	lambda.Start(handler)
}

func handler(ctx context.Context, event events.APIGatewayWebsocketProxyRequest) (events.APIGatewayProxyResponse, error) {
	log.Printf("WebSocket disconnect: %s", event.RequestContext.ConnectionID)

	// 🌐 Use go-shared for Redis operations
	connectionID := event.RequestContext.ConnectionID

	// Get session ID from connection mapping (basic Redis operations)
	sessionKey := "connection:" + connectionID
	sessionID, err := redisClient.Get(ctx, sessionKey).Result()
	if err != nil {
		log.Printf("Failed to get connection mapping for %s: %v", connectionID, err)
		// Continue with cleanup even if we can't find the session
	}

	// Clean up connection mapping
	if err := redisClient.Del(ctx, sessionKey).Err(); err != nil {
		log.Printf("Failed to delete connection mapping for %s: %v", connectionID, err)
	}

	// If we found a session, clean up session data
	if sessionID != "" {
		// Mark session as disconnected using HSet
		if err := redisClient.HSet(ctx, "session:"+sessionID, "status", "disconnected").Err(); err != nil {
			log.Printf("Failed to update session status for %s: %v", sessionID, err)
		}

		// TODO: Implement ECS task cleanup if this was the last connection
		log.Printf("Session %s disconnected", sessionID)
	}

	log.Printf("WebSocket cleanup completed for connection: %s", connectionID)

	// 📦 Use internal/handlers for WebSocket response
	return handlers.WebSocketResponse(200), nil
}
