package main

import (
	"context"
	"fmt"
	"log"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/wallcrawler/backend-go/internal/utils"
)

// Handler processes GET /v1/sessions/{id} (SDK-compatible session retrieval)
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

	// Return full session details - no conversion needed
	return utils.CreateAPIResponse(200, utils.SuccessResponse(sessionState))
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
