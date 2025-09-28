package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/wallcrawler/backend-go/internal/types"
	"github.com/wallcrawler/backend-go/internal/utils"
)

func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	projectID := utils.GetAuthorizedProjectID(request.RequestContext.Authorizer)
	if projectID == "" {
		return utils.CreateAPIResponse(403, utils.ErrorResponse("Unauthorized project access"))
	}

	contextID := request.PathParameters["id"]
	if contextID == "" {
		return utils.CreateAPIResponse(400, utils.ErrorResponse("Missing context ID"))
	}

	ddbClient, err := utils.GetDynamoDBClient(ctx)
	if err != nil {
		log.Printf("error creating DynamoDB client: %v", err)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to initialize storage"))
	}

	record, err := utils.GetContextForProject(ctx, ddbClient, projectID, contextID)
	if err != nil {
		log.Printf("error retrieving context %s: %v", contextID, err)
		return utils.CreateAPIResponse(404, utils.ErrorResponse("Context not found"))
	}

	if err := utils.UpdateContextTimestamp(ctx, ddbClient, record); err != nil {
		log.Printf("error updating context timestamp: %v", err)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to update context"))
	}

	if utils.ContextsBucketName == "" {
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Contexts bucket not configured"))
	}

	uploadURL, err := utils.GenerateUploadURL(ctx, utils.ContextsBucketName, record.StorageKey, 15*time.Minute)
	if err != nil {
		log.Printf("error generating upload URL: %v", err)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to generate upload URL"))
	}

	response := types.ContextUpdateResponse{
		ID:                       record.ID,
		CipherAlgorithm:          "NONE",
		InitializationVectorSize: 0,
		PublicKey:                "",
		UploadURL:                uploadURL,
	}

	return utils.CreateAPIResponse(200, utils.SuccessResponse(response))
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
