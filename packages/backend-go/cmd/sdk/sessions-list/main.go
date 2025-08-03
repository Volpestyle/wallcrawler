package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/wallcrawler/backend-go/internal/types"
	"github.com/wallcrawler/backend-go/internal/utils"
)

// Handler processes GET /v1/sessions (SDK-compatible session listing)
func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	log.Printf("Processing sessions list request")

	// Validate API key header only
	if request.Headers["x-wc-api-key"] == "" {
		return utils.CreateAPIResponse(401, utils.ErrorResponse("Missing required header: x-wc-api-key"))
	}

	// Get query parameters for filtering
	queryParams := request.QueryStringParameters
	statusFilter := ""
	queryFilter := ""
	if queryParams != nil {
		statusFilter = queryParams["status"]
		queryFilter = queryParams["q"]
	}

	// Get DynamoDB client
	ddbClient, err := utils.GetDynamoDBClient(ctx)
	if err != nil {
		log.Printf("Error getting DynamoDB client: %v", err)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to initialize storage"))
	}

	// Get all sessions - we'll need to implement a scan or get project ID from API key
	// For now, let's implement a scan to get all sessions
	allSessions, err := utils.GetAllSessions(ctx, ddbClient)
	if err != nil {
		log.Printf("Error getting sessions: %v", err)
		return utils.CreateAPIResponse(500, utils.ErrorResponse("Failed to retrieve sessions"))
	}

	// Initialize as empty slice instead of nil to ensure JSON array output
	filteredSessions := make([]utils.SDKSession, 0)

	// Filter and convert sessions
	for _, sessionState := range allSessions {
		// Project ID already filtered by GSI query

		// Filter by status if provided
		if statusFilter != "" && !matchesStatus(sessionState.Status, statusFilter) {
			continue
		}

		// Filter by query if provided (searches user metadata)
		if queryFilter != "" && !matchesQuery(sessionState, queryFilter) {
			continue
		}

		// Convert internal session to SDK format
		session := utils.ConvertToSDKSession(sessionState)
		filteredSessions = append(filteredSessions, session)
	}

	log.Printf("Listed %d sessions (filtered from %d total)", len(filteredSessions), len(allSessions))
	return utils.CreateAPIResponse(200, utils.SuccessResponse(filteredSessions))
}

// matchesStatus checks if session status matches the filter
func matchesStatus(sessionStatus, statusFilter string) bool {
	// Map internal status to SDK status for comparison
	sdkStatus := utils.MapStatusToSDK(sessionStatus)
	return strings.EqualFold(sdkStatus, statusFilter)
}

// matchesQuery implements basic query filtering against user metadata
// This is a simplified implementation that searches for the query string
// in the user metadata values (both keys and values)
func matchesQuery(sessionState *types.SessionState, query string) bool {
	if sessionState.UserMetadata == nil {
		return false
	}

	queryLower := strings.ToLower(query)

	// Search in metadata keys and values
	for key, value := range sessionState.UserMetadata {
		if strings.Contains(strings.ToLower(key), queryLower) {
			return true
		}
		if strings.Contains(strings.ToLower(value), queryLower) {
			return true
		}
	}

	// Try to parse query as JSON for more sophisticated filtering
	// This supports Browserbase-style queries like: {"key": "value"}
	var queryObj map[string]interface{}
	if err := json.Unmarshal([]byte(query), &queryObj); err == nil {
		return matchesQueryObject(sessionState.UserMetadata, queryObj)
	}

	return false
}

// matchesQueryObject checks if session metadata matches the query object
func matchesQueryObject(metadata map[string]string, queryObj map[string]interface{}) bool {
	for queryKey, queryValue := range queryObj {
		metadataValue, exists := metadata[queryKey]
		if !exists {
			return false
		}

		// Convert query value to string for comparison
		queryValueStr := ""
		switch v := queryValue.(type) {
		case string:
			queryValueStr = v
		case float64:
			queryValueStr = strings.TrimSuffix(strings.TrimSuffix(fmt.Sprintf("%.6f", v), "0"), ".")
		case bool:
			queryValueStr = fmt.Sprintf("%t", v)
		default:
			queryValueStr = fmt.Sprintf("%v", v)
		}

		if metadataValue != queryValueStr {
			return false
		}
	}

	return true
}

func main() {
	lambda.Start(Handler)
}
