package main

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/wallcrawler/backend-go/internal/types"
	"github.com/wallcrawler/backend-go/internal/utils"
)

type sessionDownloadsResponse struct {
	SessionID string                  `json:"sessionId"`
	Downloads []types.SessionArtifact `json:"downloads"`
}

func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	sessionID := request.PathParameters["id"]
	if strings.TrimSpace(sessionID) == "" {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Missing session ID parameter"))
	}

	projectID := utils.GetAuthorizedProjectID(request.RequestContext.Authorizer)
	if projectID == "" {
		return utils.CreateAPIResponse(403, utils.ErrorResponse("Unauthorized project access"))
	}

	if utils.SessionArtifactsBucketName == "" {
		log.Printf("Session artifacts bucket not configured")
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Session artifacts bucket not configured"))
	}

	ddbClient, err := utils.GetDynamoDBClient(ctx)
	if err != nil {
		log.Printf("error creating DynamoDB client: %v", err)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to initialize storage"))
	}

	sessionState, err := utils.GetSession(ctx, ddbClient, sessionID)
	if err != nil {
		log.Printf("error retrieving session: %v", err)
		return utils.CreateAPIResponse(404, utils.ErrorResponse("Session not found"))
	}

	if !strings.EqualFold(sessionState.ProjectID, projectID) {
		return utils.CreateAPIResponse(403, utils.ErrorResponse("Session does not belong to this project"))
	}

	artifacts, err := utils.ListSessionArtifacts(ctx, utils.SessionArtifactsBucketName, utils.SessionUploadsPrefix(sessionID), 15*time.Minute)
	if err != nil {
		log.Printf("error listing session uploads: %v", err)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to list session uploads"))
	}

	response := sessionDownloadsResponse{
		SessionID: sessionID,
		Downloads: artifacts,
	}

	return utils.CreateAPIResponse(200, response)
}

func main() {
	lambda.Start(func(ctx context.Context, event interface{}) (interface{}, error) {
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
