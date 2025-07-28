package main

import (
	"context"
	"log"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/wallcrawler/backend-go/internal/utils"
)

// Handler processes GET /v1/sessions (SDK-compatible session listing)
func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// Validate headers
	if err := utils.ValidateHeaders(request.Headers); err != nil {
		return utils.CreateAPIResponse(401, utils.ErrorResponse(err.Error()))
	}

	// Get project ID from headers
	projectID := request.Headers["x-wc-project-id"]

	// Get query parameters for filtering
	queryParams := request.QueryStringParameters
	statusFilter := ""
	queryFilter := ""
	if queryParams != nil {
		statusFilter = queryParams["status"]
		queryFilter = queryParams["q"]
	}

	// Connect to Redis
	rdb := utils.GetRedisClient()

	// Get all session keys for the project
	pattern := "session:*"
	keys, err := rdb.Keys(ctx, pattern).Result()
	if err != nil {
		log.Printf("Error getting session keys: %v", err)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to retrieve sessions"))
	}

	var sessions []utils.SDKSession

	// Retrieve and filter sessions
	for _, key := range keys {
		sessionState, err := utils.GetSession(ctx, rdb, strings.TrimPrefix(key, "session:"))
		if err != nil {
			log.Printf("Error getting session %s: %v", key, err)
			continue
		}

		// Filter by project ID
		if sessionState.ProjectID != projectID {
			continue
		}

		// Filter by status if provided
		if statusFilter != "" && sessionState.Status != statusFilter {
			continue
		}

		// TODO: Implement query filtering by user metadata
		// For now, we skip the complex query filtering
		if queryFilter != "" {
			// Basic implementation - could be enhanced with proper JSON query parsing
			log.Printf("Query filtering not fully implemented, ignoring q parameter: %s", queryFilter)
		}

		// Convert internal session to SDK format using utility function
		session := utils.ConvertToSDKSession(sessionState)
		sessions = append(sessions, session)
	}

	log.Printf("Listed %d sessions for project %s", len(sessions), projectID)
	return utils.CreateAPIResponse(200, utils.SuccessResponse(sessions))
}

func main() {
	lambda.Start(Handler)
}
