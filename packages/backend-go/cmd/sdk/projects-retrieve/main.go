package main

import (
	"context"
	"fmt"
	"log"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/wallcrawler/backend-go/internal/types"
	"github.com/wallcrawler/backend-go/internal/utils"
)

type projectSummary struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	OwnerID        *string `json:"ownerId,omitempty"`
	DefaultTimeout int     `json:"defaultTimeout"`
	Concurrency    int     `json:"concurrency"`
	CreatedAt      string  `json:"createdAt"`
	UpdatedAt      string  `json:"updatedAt"`
}

func toProjectSummary(project *types.Project) projectSummary {
	return projectSummary{
		ID:             project.ID,
		Name:           project.Name,
		OwnerID:        project.OwnerID,
		DefaultTimeout: project.DefaultTimeout,
		Concurrency:    project.Concurrency,
		CreatedAt:      project.CreatedAt,
		UpdatedAt:      project.UpdatedAt,
	}
}

func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	projectID := utils.GetAuthorizedProjectID(request.RequestContext.Authorizer)
	if projectID == "" {
		return utils.CreateAPIResponse(403, utils.ErrorResponse("Unauthorized project access"))
	}

	requestedID := request.PathParameters["id"]
	if requestedID == "" {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Missing project ID"))
	}

	if !strings.EqualFold(requestedID, projectID) {
		return utils.CreateAPIResponse(403, utils.ErrorResponse("Project not accessible with this API key"))
	}

	ddbClient, err := utils.GetDynamoDBClient(ctx)
	if err != nil {
		log.Printf("error creating DynamoDB client: %v", err)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to initialize storage"))
	}

	project, err := utils.GetProjectMetadata(ctx, ddbClient, projectID)
	if err != nil {
		log.Printf("error fetching project metadata for %s: %v", projectID, err)
		return utils.CreateAPIResponse(404, utils.ErrorResponse("Project not found"))
	}

	return utils.CreateAPIResponse(200, toProjectSummary(project))
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
