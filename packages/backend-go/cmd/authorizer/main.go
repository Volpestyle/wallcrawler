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
	
	// Extract API key and project ID from headers
	wcAPIKey := event.Headers["x-wc-api-key"]
	projectID := event.Headers["x-wc-project-id"]
	
	if wcAPIKey == "" {
		log.Printf("Missing x-wc-api-key header")
		return events.APIGatewayCustomAuthorizerResponse{}, fmt.Errorf("Unauthorized")
	}
	
	log.Printf("Found API key: wc_**** and project ID: %s", projectID)

	// Validate the Wallcrawler API key
	if !utils.ValidateWallcrawlerAPIKey(wcAPIKey) {
		log.Printf("Invalid Wallcrawler API key")
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
	}
	
	// Only include projectId if it's available
	if projectID != "" {
		authContext["projectId"] = projectID
	}

	response := events.APIGatewayCustomAuthorizerResponse{
		PrincipalID:    principalID,
		PolicyDocument: policy,
		Context:        authContext,
		// For future: map Wallcrawler key to AWS usage plan key
		// UsageIdentifierKey: mappedAwsKey,
	}

	log.Printf("Authorization successful for principal: %s", principalID)
	return response, nil
}

func main() {
	lambda.Start(Handler)
}