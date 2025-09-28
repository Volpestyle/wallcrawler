package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/wallcrawler/backend-go/internal/utils"
)

var (
	awsAPIKey string
)

func init() {
	awsAPIKey = os.Getenv("AWS_API_KEY")
	if awsAPIKey == "" {
		log.Fatal("AWS_API_KEY environment variable is required")
	}
}

func Handler(ctx context.Context, event events.APIGatewayCustomAuthorizerRequestTypeRequest) (events.APIGatewayCustomAuthorizerResponse, error) {
	log.Printf("Authorizer invoked with methodArn: %s", event.MethodArn)
	log.Printf("Request type: REQUEST authorizer")

	// Extract API key and optional project hint from headers
	wcAPIKey := event.Headers["x-wc-api-key"]
	requestedProjectID := event.Headers["x-wc-project-id"]

	if wcAPIKey == "" {
		log.Printf("Missing x-wc-api-key header")
		return events.APIGatewayCustomAuthorizerResponse{}, fmt.Errorf("Unauthorized")
	}

	log.Printf("Found API key: wc_**** and requested project ID: %s", requestedProjectID)

	// Validate the Wallcrawler API key
	ddbClient, err := utils.GetDynamoDBClient(ctx)
	if err != nil {
		log.Printf("Error creating DynamoDB client: %v", err)
		return events.APIGatewayCustomAuthorizerResponse{}, fmt.Errorf("Unauthorized")
	}

	apiKeyMetadata, err := utils.ValidateWallcrawlerAPIKey(ctx, ddbClient, wcAPIKey)
	if err != nil {
		log.Printf("API key validation failed: %v", err)
		return events.APIGatewayCustomAuthorizerResponse{}, fmt.Errorf("Unauthorized")
	}

	allowedProjects := make([]string, 0, len(apiKeyMetadata.ProjectIDs))
	for _, id := range apiKeyMetadata.ProjectIDs {
		project := strings.TrimSpace(id)
		if project != "" {
			allowedProjects = append(allowedProjects, project)
		}
	}

	if len(allowedProjects) == 0 {
		log.Printf("API key %s has no associated projects", wcAPIKey)
		return events.APIGatewayCustomAuthorizerResponse{}, fmt.Errorf("Unauthorized")
	}

	projectID := allowedProjects[0]
	if requestedProjectID != "" {
		matchFound := false
		for _, candidate := range allowedProjects {
			if strings.EqualFold(candidate, requestedProjectID) {
				projectID = candidate
				matchFound = true
				break
			}
		}
		if !matchFound {
			log.Printf("Requested project %s not permitted for key", requestedProjectID)
			return events.APIGatewayCustomAuthorizerResponse{}, fmt.Errorf("Unauthorized")
		}
	} else if len(allowedProjects) > 1 {
		log.Printf("Multiple projects available (%v); defaulting to %s", allowedProjects, projectID)
	}

	log.Printf("Authorized projects for key: %v (selected %s)", allowedProjects, projectID)

	projectMetadata, err := utils.GetProjectMetadata(ctx, ddbClient, projectID)
	if err != nil {
		log.Printf("Project validation failed: %v", err)
		return events.APIGatewayCustomAuthorizerResponse{}, fmt.Errorf("Unauthorized")
	}

	// Use a consistent principal ID based on the API key itself
	// This ensures caching works correctly regardless of whether projectID is provided
	principalID := "wc-user"
	if strings.HasPrefix(wcAPIKey, "wc_") && len(wcAPIKey) > 10 {
		// Use a hash or portion of the API key for consistent principal
		// Taking middle portion to avoid exposing key prefix/suffix
		principalID = fmt.Sprintf("wc-%s", wcAPIKey[7:17])
	}

	// Build the IAM policy
	policy := events.APIGatewayCustomAuthorizerPolicy{
		Version: "2012-10-17",
		Statement: []events.IAMPolicyStatement{
			{
				Action:   []string{"execute-api:Invoke"},
				Effect:   "Allow",
				Resource: []string{event.MethodArn},
			},
		},
	}

	// Build the response with context
	authContext := map[string]interface{}{
		"awsApiKey": awsAPIKey,
		"apiKey":    wcAPIKey, // Pass through for logging/metrics
		"projectId": projectID,
	}

	if len(allowedProjects) > 0 {
		authContext["projectIds"] = strings.Join(allowedProjects, ",")
	}

	if projectMetadata != nil {
		authContext["projectName"] = projectMetadata.Name
		authContext["projectDefaultTimeout"] = projectMetadata.DefaultTimeout
		authContext["projectConcurrency"] = projectMetadata.Concurrency
	}

	response := events.APIGatewayCustomAuthorizerResponse{
		PrincipalID:    principalID,
		PolicyDocument: policy,
		// The AWS API key is passed via context to backend services
		Context: authContext,
		// Use the Wallcrawler API key for per-client usage tracking
		UsageIdentifierKey: wcAPIKey,
	}

	log.Printf("Authorization successful for principal: %s", principalID)
	return response, nil
}

func main() {
	lambda.Start(Handler)
}
