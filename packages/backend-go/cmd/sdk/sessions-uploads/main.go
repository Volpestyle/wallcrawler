package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/google/uuid"
	"github.com/wallcrawler/backend-go/internal/utils"
)

type sessionUploadRequest struct {
	FileName         string `json:"fileName"`
	ContentType      string `json:"contentType,omitempty"`
	ExpiresInSeconds int    `json:"expiresInSeconds,omitempty"`
}

type sessionUploadResponse struct {
	SessionID string            `json:"sessionId"`
	Key       string            `json:"key"`
	UploadURL string            `json:"uploadUrl"`
	Method    string            `json:"method"`
	ExpiresAt string            `json:"expiresAt"`
	Headers   map[string]string `json:"headers"`
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

	var req sessionUploadRequest
	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Invalid request body"))
	}

	req.FileName = strings.TrimSpace(req.FileName)
	if req.FileName == "" {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Missing fileName"))
	}

	expires := time.Duration(req.ExpiresInSeconds) * time.Second
	if expires <= 0 {
		expires = 15 * time.Minute
	}
	if expires > time.Hour {
		expires = time.Hour
	}

	objectID := uuid.NewString()
	key := utils.BuildSessionUploadKey(sessionID, objectID, req.FileName)

	uploadURL, err := utils.GenerateUploadURL(ctx, utils.SessionArtifactsBucketName, key, expires)
	if err != nil {
		log.Printf("error generating upload URL: %v", err)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to generate upload URL"))
	}

	response := sessionUploadResponse{
		SessionID: sessionID,
		Key:       key,
		UploadURL: uploadURL,
		Method:    "PUT",
		ExpiresAt: time.Now().Add(expires).Format(time.RFC3339),
		Headers:   map[string]string{},
	}

	if req.ContentType != "" {
		response.Headers["Content-Type"] = req.ContentType
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
