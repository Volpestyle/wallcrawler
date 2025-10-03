package main

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/wallcrawler/backend-go/internal/utils"
)

type projectUsageResponse struct {
	BrowserMinutes int `json:"browserMinutes"`
	ProxyBytes     int `json:"proxyBytes"`
}

func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	projectIDs := utils.GetAuthorizedProjectIDs(request.RequestContext.Authorizer)
	if len(projectIDs) == 0 {
		return utils.CreateAPIResponse(403, utils.ErrorResponse("Unauthorized project access"))
	}

	requestedID := strings.TrimSpace(request.PathParameters["id"])
	if requestedID == "" {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Missing project ID"))
	}

	projectID := ""
	for _, id := range projectIDs {
		if strings.EqualFold(id, requestedID) {
			projectID = id
			break
		}
	}

	if projectID == "" {
		return utils.CreateAPIResponse(403, utils.ErrorResponse("Project not accessible with this API key"))
	}

	ddbClient, err := utils.GetDynamoDBClient(ctx)
	if err != nil {
		log.Printf("error creating DynamoDB client: %v", err)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to initialize storage"))
	}

	sessions, err := utils.GetSessionsByProjectID(ctx, ddbClient, projectID)
	if err != nil {
		log.Printf("error fetching sessions for usage aggregation: %v", err)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to retrieve usage data"))
	}

	var totalDuration time.Duration
	var totalProxyBytes int

	now := time.Now()
	for _, session := range sessions {
		startTime, err := time.Parse(time.RFC3339, session.StartedAt)
		if err != nil {
			continue
		}

		endTime := now
		if session.EndedAt != nil && *session.EndedAt != "" {
			if parsed, err := time.Parse(time.RFC3339, *session.EndedAt); err == nil {
				endTime = parsed
			}
		} else if session.ExpiresAt != "" {
			if parsed, err := time.Parse(time.RFC3339, session.ExpiresAt); err == nil {
				if parsed.Before(endTime) {
					endTime = parsed
				}
			}
		}

		if endTime.After(startTime) {
			totalDuration += endTime.Sub(startTime)
		}

		totalProxyBytes += session.ProxyBytes
	}

	usage := projectUsageResponse{
		BrowserMinutes: int(totalDuration / time.Minute),
		ProxyBytes:     totalProxyBytes,
	}

	return utils.CreateAPIResponse(200, usage)
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
