package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	dynamotypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/wallcrawler/backend-go/internal/utils"
)

// StepFunctionEvent represents the input from Step Functions with task token
type StepFunctionEvent struct {
	TaskToken       string                 `json:"taskToken"`
	ProjectID       string                 `json:"projectId"`
	BrowserSettings map[string]interface{} `json:"browserSettings,omitempty"`
	ExtensionID     string                 `json:"extensionId,omitempty"`
	KeepAlive       bool                   `json:"keepAlive,omitempty"`
	Proxies         interface{}            `json:"proxies,omitempty"`
	Region          string                 `json:"region,omitempty"`
	Timeout         int                    `json:"timeout,omitempty"`
	UserMetadata    map[string]interface{} `json:"userMetadata,omitempty"`
}

// Handler processes session creation requests from Step Functions
// This function creates the ECS task and stores the callback token
// Step Functions will wait until the ECS task is ready
func Handler(ctx context.Context, event StepFunctionEvent) error {
	log.Printf("Processing Step Functions session creation request for project %s", event.ProjectID)

	// Validate required fields
	if event.ProjectID == "" {
		return fmt.Errorf("missing required field: projectId")
	}

	if event.TaskToken == "" {
		return fmt.Errorf("missing required field: taskToken")
	}

	// Generate session ID
	sessionID := utils.GenerateSessionID()

	// Set default timeout if not provided (24 hours)
	if event.Timeout == 0 {
		event.Timeout = 86400 // 24 hours in seconds
	}

	// Set default region if not provided
	region := event.Region
	if region == "" {
		region = "us-east-1"
	}

	// Convert to internal session format
	sessionState := utils.CreateSessionWithDefaults(sessionID, event.ProjectID, nil)

	// Update fields from request
	sessionState.KeepAlive = event.KeepAlive
	sessionState.Region = region

	// Update expiration based on timeout
	expiresAt := time.Now().Add(time.Duration(event.Timeout) * time.Second)
	sessionState.ExpiresAt = expiresAt.Format(time.RFC3339)

	// Store SDK-specific metadata
	if sessionState.UserMetadata == nil {
		sessionState.UserMetadata = make(map[string]interface{})
	}

	// Add SDK-specific fields to metadata
	sessionState.UserMetadata["sessionType"] = "basic"
	sessionState.UserMetadata["timeout"] = event.Timeout

	if event.UserMetadata != nil {
		for k, v := range event.UserMetadata {
			sessionState.UserMetadata[k] = v
		}
	}

	// Log session creation
	utils.LogSessionCreated(sessionID, event.ProjectID, map[string]interface{}{
		"timeout":       event.Timeout,
		"user_metadata": event.UserMetadata,
		"step_function": true,
	})

	// Get DynamoDB client
	ddbClient, err := utils.GetDynamoDBClient(ctx)
	if err != nil {
		log.Printf("Error getting DynamoDB client: %v", err)
		return fmt.Errorf("failed to initialize storage: %v", err)
	}

	// Store session in DynamoDB with initial CREATING status
	if err := utils.StoreSession(ctx, ddbClient, sessionState); err != nil {
		log.Printf("Error storing session: %v", err)
		utils.LogSessionError(sessionID, event.ProjectID, err, "store_session", nil)
		return fmt.Errorf("failed to create session: %v", err)
	}

	// Generate JWT token for this session with proper expiration
	now := time.Now()
	jwtExpiresAt := now.Add(time.Duration(event.Timeout) * time.Second)

	payload := utils.CDPSigningPayload{
		SessionID: sessionID,
		ProjectID: event.ProjectID,
		IssuedAt:  now.Unix(),
		ExpiresAt: jwtExpiresAt.Unix(),
		Nonce:     utils.GenerateRandomNonce(),
	}

	jwtToken, err := utils.CreateCDPToken(payload)
	if err != nil {
		log.Printf("Error creating JWT token for session %s: %v", sessionID, err)
		utils.LogSessionError(sessionID, event.ProjectID, err, "create_jwt", nil)
		utils.DeleteSession(ctx, ddbClient, sessionID)
		return fmt.Errorf("failed to generate session authentication token: %v", err)
	}

	// Store the JWT token in session state
	sessionState.SigningKey = &jwtToken
	if err := utils.StoreSession(ctx, ddbClient, sessionState); err != nil {
		log.Printf("Error storing session with JWT token: %v", err)
		utils.DeleteSession(ctx, ddbClient, sessionID)
		return fmt.Errorf("failed to store session: %v", err)
	}

	// Update status to PROVISIONING
	if err := utils.UpdateSessionStatus(ctx, ddbClient, sessionID, "PROVISIONING"); err != nil {
		log.Printf("Error updating session status to provisioning: %v", err)
		utils.DeleteSession(ctx, ddbClient, sessionID)
		return fmt.Errorf("failed to update session status: %v", err)
	}

	// Create ECS task
	taskARN, err := utils.CreateECSTask(ctx, sessionID, sessionState)
	if err != nil {
		log.Printf("Error creating ECS task for session %s: %v", sessionID, err)
		utils.UpdateSessionStatus(ctx, ddbClient, sessionID, "FAILED")
		return fmt.Errorf("failed to provision browser container: %v", err)
	}

	// Update session with task ARN
	sessionState.ECSTaskARN = taskARN
	if err := utils.StoreSession(ctx, ddbClient, sessionState); err != nil {
		log.Printf("Error storing session with task ARN: %v", err)
	}

	// Store the Step Functions callback token in DynamoDB
	// This will be retrieved by the ECS task processor when the container is ready
	tableName := utils.DynamoDBTableName
	tokenItem := map[string]dynamotypes.AttributeValue{
		"taskArn":   &dynamotypes.AttributeValueMemberS{Value: taskARN},
		"sessionId": &dynamotypes.AttributeValueMemberS{Value: sessionID},
		"taskToken": &dynamotypes.AttributeValueMemberS{Value: event.TaskToken},
		"createdAt": &dynamotypes.AttributeValueMemberN{Value: fmt.Sprintf("%d", time.Now().Unix())},
		"ttl":       &dynamotypes.AttributeValueMemberN{Value: fmt.Sprintf("%d", time.Now().Add(10*time.Minute).Unix())},
	}

	_, err = ddbClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(tableName),
		Item:      tokenItem,
	})
	if err != nil {
		log.Printf("Error storing callback token: %v", err)
		utils.StopECSTask(ctx, taskARN)
		utils.UpdateSessionStatus(ctx, ddbClient, sessionID, "FAILED")
		return fmt.Errorf("failed to store callback token: %v", err)
	}

	log.Printf("Successfully initiated ECS task %s for session %s, Step Functions will wait for callback", taskARN, sessionID)

	// Return successfully - Step Functions will wait for the callback
	// We don't need to return any data here as the actual response will come from SendTaskSuccess
	return nil
}

func main() {
	lambda.Start(Handler)
}