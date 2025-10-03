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
	projectIDs := utils.GetAuthorizedProjectIDs(request.RequestContext.Authorizer)
	if len(projectIDs) == 0 {
		return utils.CreateAPIResponse(403, utils.ErrorResponse("Unauthorized project access"))
	}

	ddbClient, err := utils.GetDynamoDBClient(ctx)
	if err != nil {
		log.Printf("error creating DynamoDB client: %v", err)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to initialize storage"))
	}

	uniqueProjects := make([]projectSummary, 0, len(projectIDs))
	seen := make(map[string]struct{})
	for _, id := range projectIDs {
		if _, exists := seen[strings.ToLower(id)]; exists {
			continue
		}
		project, err := utils.GetProjectMetadata(ctx, ddbClient, id)
		if err != nil {
			log.Printf("error fetching project metadata for %s: %v", id, err)
			continue
		}
		uniqueProjects = append(uniqueProjects, toProjectSummary(project))
		seen[strings.ToLower(id)] = struct{}{}
	}

	if len(uniqueProjects) == 0 {
		return utils.CreateAPIResponse(404, utils.ErrorResponse("Projects not found"))
	}

	return utils.CreateAPIResponse(200, uniqueProjects)
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
