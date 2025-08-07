package main

import (
	"context"
	"log"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/wallcrawler/backend-go/internal/utils"
)

// Handler processes POST /sessions/start (Stagehand AI-powered sessions)
// This is currently stubbed since we're focusing on basic sessions first
func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	log.Printf("AI sessions endpoint called but not implemented yet")

	// Validate API key only
	if err := utils.ValidateAPIKey(request.Headers); err != nil {
		return utils.CreateAPIResponse(401, utils.ErrorResponse(err.Error()))
	}

	// Return not implemented response
	return utils.CreateAPIResponse(501, utils.ErrorResponse("AI-powered sessions not implemented yet. Use basic sessions via POST /v1/sessions for now."))
}

func main() {
	lambda.Start(Handler)
}
