package utils

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strconv"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	dynamotypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/aws/aws-sdk-go-v2/service/ec2"
	"github.com/aws/aws-sdk-go-v2/service/ecs"
	ecstypes "github.com/aws/aws-sdk-go-v2/service/ecs/types"
	"github.com/aws/aws-sdk-go-v2/service/eventbridge"
	ebtypes "github.com/aws/aws-sdk-go-v2/service/eventbridge/types"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/wallcrawler/backend-go/internal/types"
)

var (
	DynamoDBTableName = os.Getenv("DYNAMODB_TABLE_NAME")
	RedisAddr         = os.Getenv("REDIS_ADDR")
	ECSCluster        = os.Getenv("ECS_CLUSTER")
	ECSTaskDefFamily  = os.Getenv("ECS_TASK_DEFINITION_FAMILY") // Just the family name, not the full ARN
	ConnectURL        = os.Getenv("CONNECT_URL_BASE")
)

// GetDynamoDBClient returns a configured DynamoDB client
func GetDynamoDBClient(ctx context.Context) (*dynamodb.Client, error) {
	cfg, err := GetAWSConfig()
	if err != nil {
		return nil, err
	}
	return dynamodb.NewFromConfig(cfg), nil
}

// GetRedisClient returns a configured Redis client for pub/sub only
func GetRedisClient(ctx context.Context) (*redis.Client, error) {
	if RedisAddr == "" {
		return nil, fmt.Errorf("REDIS_ADDR environment variable not set")
	}

	rdb := redis.NewClient(&redis.Options{
		Addr:         RedisAddr,
		DialTimeout:  10 * time.Second,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		PoolSize:     10,
		PoolTimeout:  30 * time.Second,
	})

	// Test connection
	_, err := rdb.Ping(ctx).Result()
	if err != nil {
		return nil, fmt.Errorf("failed to connect to Redis: %v", err)
	}

	return rdb, nil
}

// GetAWSConfig returns AWS configuration
func GetAWSConfig() (aws.Config, error) {
	// AWS Lambda automatically provides the AWS_REGION environment variable
	return config.LoadDefaultConfig(context.TODO())
}

// GenerateSessionID creates a new session ID
func GenerateSessionID() string {
	return "sess_" + uuid.New().String()[:8]
}

// SuccessResponse wraps data in success response format
func SuccessResponse(data interface{}) types.SuccessResponse {
	return types.SuccessResponse{
		Success: true,
		Data:    data,
	}
}

// ErrorResponse creates an error response
func ErrorResponse(message string) types.ErrorResponse {
	return types.ErrorResponse{
		Success: false,
		Message: message,
	}
}

// StoreSession stores session state in DynamoDB with TTL
func StoreSession(ctx context.Context, ddbClient *dynamodb.Client, sessionState *types.SessionState) error {
	// Set TTL to 1 hour from now
	expiresAt := time.Now().Add(1 * time.Hour).Unix()

	// Convert session state to DynamoDB attributes
	item := map[string]dynamotypes.AttributeValue{
		"sessionId":  &dynamotypes.AttributeValueMemberS{Value: sessionState.ID},
		"status":     &dynamotypes.AttributeValueMemberS{Value: sessionState.Status},
		"projectId":  &dynamotypes.AttributeValueMemberS{Value: sessionState.ProjectID},
		"connectUrl": &dynamotypes.AttributeValueMemberS{Value: sessionState.ConnectURL},
		"publicIP":   &dynamotypes.AttributeValueMemberS{Value: sessionState.PublicIP},
		"signingKey": &dynamotypes.AttributeValueMemberS{Value: sessionState.SigningKey},
		"ecsTaskArn": &dynamotypes.AttributeValueMemberS{Value: sessionState.ECSTaskARN},
		"createdAt":  &dynamotypes.AttributeValueMemberN{Value: strconv.FormatInt(sessionState.CreatedAt.Unix(), 10)},
		"updatedAt":  &dynamotypes.AttributeValueMemberN{Value: strconv.FormatInt(sessionState.UpdatedAt.Unix(), 10)},
		"expiresAt":  &dynamotypes.AttributeValueMemberN{Value: strconv.FormatInt(expiresAt, 10)},
	}

	// Add optional fields
	if sessionState.UserMetadata != nil && len(sessionState.UserMetadata) > 0 {
		metadataAV, err := attributevalue.Marshal(sessionState.UserMetadata)
		if err == nil {
			item["userMetadata"] = metadataAV
		}
	}

	if sessionState.ModelConfig != nil {
		configAV, err := attributevalue.Marshal(sessionState.ModelConfig)
		if err == nil {
			item["modelConfig"] = configAV
		}
	}

	// Store in DynamoDB
	_, err := ddbClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(DynamoDBTableName),
		Item:      item,
	})

	if err != nil {
		log.Printf("Error storing session %s in DynamoDB: %v", sessionState.ID, err)
		return err
	}

	log.Printf("Stored session %s in DynamoDB with TTL %d", sessionState.ID, expiresAt)
	return nil
}

// GetSession retrieves session state from DynamoDB
func GetSession(ctx context.Context, ddbClient *dynamodb.Client, sessionID string) (*types.SessionState, error) {
	result, err := ddbClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(DynamoDBTableName),
		Key: map[string]dynamotypes.AttributeValue{
			"sessionId": &dynamotypes.AttributeValueMemberS{Value: sessionID},
		},
	})

	if err != nil {
		return nil, err
	}

	if result.Item == nil {
		return nil, fmt.Errorf("session not found")
	}

	// Convert DynamoDB item to SessionState
	var sessionState types.SessionState
	err = attributevalue.UnmarshalMap(result.Item, &sessionState)
	if err != nil {
		// Try manual unmarshaling for better control
		sessionState.ID = getStringValue(result.Item["sessionId"])
		sessionState.Status = getStringValue(result.Item["status"])
		sessionState.ProjectID = getStringValue(result.Item["projectId"])
		sessionState.ConnectURL = getStringValue(result.Item["connectUrl"])
		sessionState.PublicIP = getStringValue(result.Item["publicIP"])
		sessionState.SigningKey = getStringValue(result.Item["signingKey"])
		sessionState.ECSTaskARN = getStringValue(result.Item["ecsTaskArn"])

		// Parse timestamps
		if createdAt := getNumberValue(result.Item["createdAt"]); createdAt != 0 {
			sessionState.CreatedAt = time.Unix(createdAt, 0)
		}
		if updatedAt := getNumberValue(result.Item["updatedAt"]); updatedAt != 0 {
			sessionState.UpdatedAt = time.Unix(updatedAt, 0)
		}

		// Parse optional fields
		if metadata, ok := result.Item["userMetadata"]; ok {
			attributevalue.Unmarshal(metadata, &sessionState.UserMetadata)
		}
		if config, ok := result.Item["modelConfig"]; ok {
			attributevalue.Unmarshal(config, &sessionState.ModelConfig)
		}
		return &sessionState, nil
	}

	return &sessionState, nil
}

// Helper functions for DynamoDB attribute extraction
func getStringValue(attr dynamotypes.AttributeValue) string {
	if v, ok := attr.(*dynamotypes.AttributeValueMemberS); ok {
		return v.Value
	}
	return ""
}

func getNumberValue(attr dynamotypes.AttributeValue) int64 {
	if v, ok := attr.(*dynamotypes.AttributeValueMemberN); ok {
		n, _ := strconv.ParseInt(v.Value, 10, 64)
		return n
	}
	return 0
}

// UpdateSessionStatus updates session status in Redis with proper lifecycle tracking
func UpdateSessionStatus(ctx context.Context, ddbClient *dynamodb.Client, sessionID, status string) error {
	sessionState, err := GetSession(ctx, ddbClient, sessionID)
	if err != nil {
		return err
	}

	// Update status with proper lifecycle timing
	previousStatus := sessionState.Status
	sessionState.Status = status
	sessionState.UpdatedAt = time.Now()

	// Track specific lifecycle timestamps
	now := time.Now()
	switch status {
	case types.SessionStatusProvisioning:
		sessionState.ProvisioningStartedAt = &now
	case types.SessionStatusReady:
		sessionState.ReadyAt = &now
	case types.SessionStatusActive:
		sessionState.LastActiveAt = &now
	case types.SessionStatusTerminating, types.SessionStatusStopped, types.SessionStatusFailed:
		sessionState.TerminatedAt = &now
	}

	// Add event to history
	sessionEvent := types.SessionEvent{
		EventType: "StatusChanged",
		Timestamp: now,
		Source:    "wallcrawler.utils",
		Detail: map[string]interface{}{
			"previousStatus": previousStatus,
			"newStatus":      status,
			"sessionId":      sessionID,
		},
	}

	if sessionState.EventHistory == nil {
		sessionState.EventHistory = []types.SessionEvent{}
	}
	sessionState.EventHistory = append(sessionState.EventHistory, sessionEvent)
	sessionState.LastEventTimestamp = &now

	return StoreSession(ctx, ddbClient, sessionState)
}

// DeleteSession removes session from DynamoDB
func DeleteSession(ctx context.Context, ddbClient *dynamodb.Client, sessionID string) error {
	_, err := ddbClient.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(DynamoDBTableName),
		Key: map[string]dynamotypes.AttributeValue{
			"sessionId": &dynamotypes.AttributeValueMemberS{Value: sessionID},
		},
	})
	return err
}

// CreateECSTask creates an ECS task for browser automation
func CreateECSTask(ctx context.Context, sessionID string, sessionState *types.SessionState) (string, error) {
	cfg, err := GetAWSConfig()
	if err != nil {
		return "", err
	}

	ecsClient := ecs.NewFromConfig(cfg)

	// Environment variables for the task
	env := []ecstypes.KeyValuePair{
		{Name: aws.String("SESSION_ID"), Value: aws.String(sessionID)},
		{Name: aws.String("DYNAMODB_TABLE_NAME"), Value: aws.String(DynamoDBTableName)},
		{Name: aws.String("PROJECT_ID"), Value: aws.String(sessionState.ProjectID)},
	}

	// Add model config if available
	if sessionState.ModelConfig != nil {
		modelConfigJSON, _ := json.Marshal(sessionState.ModelConfig)
		env = append(env, ecstypes.KeyValuePair{
			Name:  aws.String("MODEL_CONFIG"),
			Value: aws.String(string(modelConfigJSON)),
		})
	}

	input := &ecs.RunTaskInput{
		Cluster:        aws.String(ECSCluster),
		TaskDefinition: aws.String(ECSTaskDefFamily), // Just the family name - AWS will use the latest revision
		LaunchType:     ecstypes.LaunchTypeFargate,
		Count:          aws.Int32(1),
		Overrides: &ecstypes.TaskOverride{
			ContainerOverrides: []ecstypes.ContainerOverride{
				{
					Name:        aws.String("controller"), // Updated to match the container name in CDK
					Environment: env,
				},
			},
		},
	}

	result, err := ecsClient.RunTask(ctx, input)
	if err != nil {
		return "", err
	}

	if len(result.Tasks) == 0 {
		return "", fmt.Errorf("no tasks created")
	}

	return *result.Tasks[0].TaskArn, nil
}

// StopECSTask stops an ECS task
func StopECSTask(ctx context.Context, taskARN string) error {
	cfg, err := GetAWSConfig()
	if err != nil {
		return err
	}

	ecsClient := ecs.NewFromConfig(cfg)

	_, err = ecsClient.StopTask(ctx, &ecs.StopTaskInput{
		Cluster: aws.String(ECSCluster),
		Task:    aws.String(taskARN),
		Reason:  aws.String("Session ended"),
	})

	return err
}

// PublishEvent publishes an event to EventBridge for the ECS controller
func PublishEvent(ctx context.Context, sessionID string, eventType string, detail interface{}) error {
	cfg, err := GetAWSConfig()
	if err != nil {
		return err
	}

	ebClient := eventbridge.NewFromConfig(cfg)

	detailJSON, err := json.Marshal(detail)
	if err != nil {
		return err
	}

	_, err = ebClient.PutEvents(ctx, &eventbridge.PutEventsInput{
		Entries: []ebtypes.PutEventsRequestEntry{
			{
				Source:       aws.String("wallcrawler.backend"),
				DetailType:   aws.String(eventType),
				Detail:       aws.String(string(detailJSON)),
				EventBusName: aws.String("default"),
				Resources:    []string{"session:" + sessionID},
			},
		},
	})

	return err
}

// ValidateAPIKey validates only the API key header
func ValidateAPIKey(headers map[string]string) error {
	if headers["x-wc-api-key"] == "" {
		return fmt.Errorf("missing required header: x-wc-api-key")
	}
	return nil
}

// ValidateHeaders validates required headers (deprecated, use ValidateAPIKey instead)
// Kept for backward compatibility with any services that still expect both headers
func ValidateHeaders(headers map[string]string) error {
	if headers["x-wc-api-key"] == "" {
		return fmt.Errorf("missing required header: x-wc-api-key")
	}
	if headers["x-wc-project-id"] == "" {
		return fmt.Errorf("missing required header: x-wc-project-id")
	}
	return nil
}

// FormatStreamEvent formats a streaming event
func FormatStreamEvent(eventType string, data interface{}) string {
	event := types.StreamEvent{
		Type: eventType,
		Data: data,
	}

	eventJSON, err := json.Marshal(event)
	if err != nil {
		log.Printf("Error marshaling stream event: %v", err)
		return ""
	}

	return fmt.Sprintf("data: %s\n\n", string(eventJSON))
}

// SendSystemEvent sends a system event with status and result
func SendSystemEvent(status string, result interface{}, errorMsg string) string {
	systemEvent := types.SystemEvent{
		Status: status,
	}

	if result != nil {
		systemEvent.Result = result
	}

	if errorMsg != "" {
		systemEvent.Error = errorMsg
	}

	return FormatStreamEvent("system", systemEvent)
}

// SendLogEvent sends a log event
func SendLogEvent(level, text string) string {
	logEvent := types.LogEvent{
		Message: types.LogMessage{
			Level:     level,
			Text:      text,
			Timestamp: time.Now(),
		},
	}

	return FormatStreamEvent("log", logEvent)
}

// CreateAPIResponse creates an API Gateway proxy response
func CreateAPIResponse(statusCode int, body interface{}) (events.APIGatewayProxyResponse, error) {
	bodyJSON, err := json.Marshal(body)
	if err != nil {
		return events.APIGatewayProxyResponse{}, err
	}

	return events.APIGatewayProxyResponse{
		StatusCode: statusCode,
		Headers: map[string]string{
			"Content-Type":                 "application/json",
			"Access-Control-Allow-Origin":  "*",
			"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type, Authorization, x-wc-api-key, x-wc-project-id, x-wc-session-id, x-model-api-key, x-stream-response",
		},
		Body: string(bodyJSON),
	}, nil
}

// WaitForSessionReady waits for a session to become READY using Redis Pub/Sub (no polling!)
func WaitForSessionReady(ctx context.Context, ddbClient *dynamodb.Client, rdb *redis.Client, sessionID string, timeoutSeconds int) (*types.SessionState, error) {
	timeout := time.Duration(timeoutSeconds) * time.Second

	log.Printf("Waiting for session %s to become READY via Redis Pub/Sub (no polling)...", sessionID)

	// Subscribe to session ready channel
	channel := fmt.Sprintf("session:%s:ready", sessionID)
	pubsub := rdb.Subscribe(ctx, channel)
	defer pubsub.Close()

	// Create a channel to receive messages
	ch := pubsub.Channel()

	// Set up timeout
	timeoutTimer := time.NewTimer(timeout)
	defer timeoutTimer.Stop()

	// Check current status first (in case we missed the event)
	sessionState, err := GetSession(ctx, ddbClient, sessionID)
	if err == nil {
		if sessionState.Status == types.SessionStatusReady &&
			sessionState.PublicIP != "" &&
			sessionState.ConnectURL != "" {
			log.Printf("Session %s is already READY with IP %s", sessionID, sessionState.PublicIP)
			return sessionState, nil
		}

		if sessionState.Status == types.SessionStatusFailed {
			return nil, fmt.Errorf("session %s failed to provision", sessionID)
		}
	}

	// Wait for pub/sub notification or timeout
	select {
	case msg := <-ch:
		log.Printf("Received Redis pub/sub message for session %s: %s", sessionID, msg.Payload)

		// Get updated session state from DynamoDB
		sessionState, err := GetSession(ctx, ddbClient, sessionID)
		if err != nil {
			return nil, fmt.Errorf("error getting session after pub/sub notification: %v", err)
		}

		// Check if session is ready
		if sessionState.Status == types.SessionStatusReady &&
			sessionState.PublicIP != "" &&
			sessionState.ConnectURL != "" {
			log.Printf("Session %s is READY with IP %s via pub/sub", sessionID, sessionState.PublicIP)
			return sessionState, nil
		}

		// Check if session failed
		if sessionState.Status == types.SessionStatusFailed {
			return nil, fmt.Errorf("session %s failed to provision", sessionID)
		}

		return nil, fmt.Errorf("session %s received notification but not ready: status=%s, ip=%s",
			sessionID, sessionState.Status, sessionState.PublicIP)

	case <-timeoutTimer.C:
		return nil, fmt.Errorf("timeout waiting for session %s to become ready after %d seconds", sessionID, timeoutSeconds)

	case <-ctx.Done():
		return nil, fmt.Errorf("context cancelled while waiting for session %s", sessionID)
	}
}

// GetECSTaskPublicIP gets the public IP of an ECS task for CDP connection
func GetECSTaskPublicIP(ctx context.Context, taskARN string) (string, error) {
	cfg, err := GetAWSConfig()
	if err != nil {
		return "", err
	}

	ecsClient := ecs.NewFromConfig(cfg)

	// Describe the task to get network details
	result, err := ecsClient.DescribeTasks(ctx, &ecs.DescribeTasksInput{
		Cluster: aws.String(ECSCluster),
		Tasks:   []string{taskARN},
	})

	if err != nil {
		return "", err
	}

	if len(result.Tasks) == 0 {
		return "", fmt.Errorf("task not found")
	}

	task := result.Tasks[0]

	// Get the network interface from task attachments
	for _, attachment := range task.Attachments {
		if *attachment.Type == "ElasticNetworkInterface" {
			for _, detail := range attachment.Details {
				if *detail.Name == "networkInterfaceId" {
					// We have the ENI ID, now get its public IP
					return GetENIPublicIP(ctx, *detail.Value)
				}
			}
		}
	}

	return "", fmt.Errorf("no network interface found for task")
}

// GetENIPublicIP gets the public IP of an Elastic Network Interface (exported for direct use)
func GetENIPublicIP(ctx context.Context, eniID string) (string, error) {
	cfg, err := GetAWSConfig()
	if err != nil {
		return "", err
	}

	// Import EC2 client
	ec2Client := ec2.NewFromConfig(cfg)

	result, err := ec2Client.DescribeNetworkInterfaces(ctx, &ec2.DescribeNetworkInterfacesInput{
		NetworkInterfaceIds: []string{eniID},
	})

	if err != nil {
		return "", err
	}

	if len(result.NetworkInterfaces) == 0 {
		return "", fmt.Errorf("network interface not found")
	}

	networkInterface := result.NetworkInterfaces[0]

	// Check if it has a public IP
	if networkInterface.Association != nil && networkInterface.Association.PublicIp != nil {
		return *networkInterface.Association.PublicIp, nil
	}

	// If no public IP, fall back to private IP (for VPC-internal access)
	if networkInterface.PrivateIpAddress != nil {
		return *networkInterface.PrivateIpAddress, nil
	}

	return "", fmt.Errorf("no IP address found for network interface")
}

// CreateAuthenticatedCDPURL creates the authenticated CDP WebSocket URL for Direct Mode
func CreateAuthenticatedCDPURL(taskIP, jwtToken string) string {
	// Get CDP proxy port from environment (set by CDK)
	cdpProxyPort := os.Getenv("CDP_PROXY_PORT")
	if cdpProxyPort == "" {
		cdpProxyPort = "9223" // Fallback to default
	}
	// Match Browserbase format: ws://host:port?signingKey=token (no /cdp path)
	return fmt.Sprintf("ws://%s:%s?signingKey=%s", taskIP, cdpProxyPort, jwtToken)
}

// CreateDebuggerURL creates the Chrome DevTools debugger URL for web-based debugging
func CreateDebuggerURL(taskIP, jwtToken string) string {
	// Get CDP proxy port from environment (set by CDK)
	cdpProxyPort := os.Getenv("CDP_PROXY_PORT")
	if cdpProxyPort == "" {
		cdpProxyPort = "9223" // Fallback to default
	}

	// Use Chrome DevTools frontend hosted on chrome-devtools-frontend.appspot.com
	// This is the standard way to create debugger URLs for remote Chrome instances
	wsURL := fmt.Sprintf("%s:%s", taskIP, cdpProxyPort)
	return fmt.Sprintf("https://chrome-devtools-frontend.appspot.com/serve_file/@66a71dd84e44ed89c31a91e3a53006a7a6e1b72e/inspector.html?ws=%s&signingKey=%s",
		wsURL, jwtToken)
}

// CreateDebuggerFullscreenURL creates the fullscreen Chrome DevTools debugger URL
func CreateDebuggerFullscreenURL(taskIP, jwtToken string) string {
	// Get CDP proxy port from environment (set by CDK)
	cdpProxyPort := os.Getenv("CDP_PROXY_PORT")
	if cdpProxyPort == "" {
		cdpProxyPort = "9223" // Fallback to default
	}

	// Create fullscreen debugger URL with dockSide=undocked for fullscreen mode
	wsURL := fmt.Sprintf("%s:%s", taskIP, cdpProxyPort)
	return fmt.Sprintf("https://chrome-devtools-frontend.appspot.com/serve_file/@66a71dd84e44ed89c31a91e3a53006a7a6e1b72e/inspector.html?ws=%s&signingKey=%s&dockSide=undocked",
		wsURL, jwtToken)
}

// AddSessionEvent adds an event to session history and publishes to EventBridge
func AddSessionEvent(ctx context.Context, ddbClient *dynamodb.Client, sessionID, eventType, source string, detail map[string]interface{}) error {
	sessionState, err := GetSession(ctx, ddbClient, sessionID)
	if err != nil {
		return err
	}

	now := time.Now()
	sessionEvent := types.SessionEvent{
		EventType: eventType,
		Timestamp: now,
		Source:    source,
		Detail:    detail,
	}

	if sessionState.EventHistory == nil {
		sessionState.EventHistory = []types.SessionEvent{}
	}
	sessionState.EventHistory = append(sessionState.EventHistory, sessionEvent)
	sessionState.LastEventTimestamp = &now
	sessionState.UpdatedAt = now

	// Store updated session state
	if err := StoreSession(ctx, ddbClient, sessionState); err != nil {
		return err
	}

	// Publish to EventBridge
	return PublishEvent(ctx, sessionID, eventType, detail)
}

// CreateSessionWithDefaults creates a new session with default resource limits and billing info
func CreateSessionWithDefaults(sessionID, projectID string, modelConfig *types.ModelConfig) *types.SessionState {
	now := time.Now()

	// Default resource limits
	defaultLimits := &types.ResourceLimits{
		MaxCPU:      1024, // 1 vCPU
		MaxMemory:   2048, // 2GB
		MaxDuration: 3600, // 1 hour
		MaxActions:  1000, // 1000 actions
	}

	// Initialize billing info
	billingInfo := &types.BillingInfo{
		CPUSeconds:    0,
		MemoryMBHours: 0,
		ActionsCount:  0,
		LastBillingAt: now,
	}

	return &types.SessionState{
		ID:             sessionID,
		Status:         types.SessionStatusCreating,
		ProjectID:      projectID,
		ModelConfig:    modelConfig,
		CreatedAt:      now,
		UpdatedAt:      now,
		ResourceLimits: defaultLimits,
		BillingInfo:    billingInfo,
		EventHistory:   []types.SessionEvent{},
		RetryCount:     0,
	}
}

// IsSessionActive checks if session is in an active state
func IsSessionActive(status string) bool {
	return status == types.SessionStatusReady ||
		status == types.SessionStatusActive ||
		status == types.SessionStatusStarting
}

// IsSessionTerminal checks if session is in a terminal state
func IsSessionTerminal(status string) bool {
	return status == types.SessionStatusStopped ||
		status == types.SessionStatusFailed
}

// IncrementSessionRetryCount increments the retry count for a session
func IncrementSessionRetryCount(ctx context.Context, ddbClient *dynamodb.Client, sessionID string) error {
	sessionState, err := GetSession(ctx, ddbClient, sessionID)
	if err != nil {
		return err
	}

	sessionState.RetryCount++
	sessionState.UpdatedAt = time.Now()

	return StoreSession(ctx, ddbClient, sessionState)
}

// MapStatusToSDK converts internal session status to SDK-compatible status
func MapStatusToSDK(internalStatus string) string {
	switch internalStatus {
	case types.SessionStatusCreating, types.SessionStatusProvisioning, types.SessionStatusStarting:
		return "RUNNING" // Session is being prepared
	case types.SessionStatusReady, types.SessionStatusActive:
		return "RUNNING" // Session is active and usable
	case types.SessionStatusTerminating:
		return "RUNNING" // Still running until fully stopped
	case types.SessionStatusStopped:
		return "COMPLETED" // Session completed successfully
	case types.SessionStatusFailed:
		return "ERROR" // Session failed to start or encountered error
	default:
		return "ERROR" // Unknown status, default to error
	}
}

// GetAllSessions retrieves all sessions from DynamoDB using Scan
func GetAllSessions(ctx context.Context, ddbClient *dynamodb.Client) ([]*types.SessionState, error) {
	var sessions []*types.SessionState
	var lastEvaluatedKey map[string]dynamotypes.AttributeValue

	for {
		// Scan sessions table
		scanInput := &dynamodb.ScanInput{
			TableName: aws.String(DynamoDBTableName),
			Limit:     aws.Int32(100), // Batch size
		}

		if lastEvaluatedKey != nil {
			scanInput.ExclusiveStartKey = lastEvaluatedKey
		}

		result, err := ddbClient.Scan(ctx, scanInput)
		if err != nil {
			return nil, err
		}

		// Convert items to SessionState
		for _, item := range result.Items {
			var sessionState types.SessionState
			err := attributevalue.UnmarshalMap(item, &sessionState)
			if err != nil {
				// Try manual unmarshaling
				sessionState.ID = getStringValue(item["sessionId"])
				sessionState.Status = getStringValue(item["status"])
				sessionState.ProjectID = getStringValue(item["projectId"])

				if sessionState.ID == "" {
					continue // Skip invalid sessions
				}
			}

			sessions = append(sessions, &sessionState)
		}

		// Check if there are more items
		lastEvaluatedKey = result.LastEvaluatedKey
		if lastEvaluatedKey == nil {
			break
		}
	}

	return sessions, nil
}

// GetSessionsByProjectID retrieves all sessions for a specific project using GSI
func GetSessionsByProjectID(ctx context.Context, ddbClient *dynamodb.Client, projectID string) ([]*types.SessionState, error) {
	var sessions []*types.SessionState
	var lastEvaluatedKey map[string]dynamotypes.AttributeValue

	for {
		// Query using GSI
		queryInput := &dynamodb.QueryInput{
			TableName:              aws.String(DynamoDBTableName),
			IndexName:              aws.String("projectId-createdAt-index"),
			KeyConditionExpression: aws.String("projectId = :projectId"),
			ExpressionAttributeValues: map[string]dynamotypes.AttributeValue{
				":projectId": &dynamotypes.AttributeValueMemberS{Value: projectID},
			},
			ScanIndexForward: aws.Bool(false), // Sort by createdAt descending
			Limit:            aws.Int32(100),
		}

		if lastEvaluatedKey != nil {
			queryInput.ExclusiveStartKey = lastEvaluatedKey
		}

		result, err := ddbClient.Query(ctx, queryInput)
		if err != nil {
			return nil, err
		}

		// Convert items to SessionState
		for _, item := range result.Items {
			var sessionState types.SessionState
			err := attributevalue.UnmarshalMap(item, &sessionState)
			if err != nil {
				// Try manual unmarshaling
				sessionState.ID = getStringValue(item["sessionId"])
				sessionState.Status = getStringValue(item["status"])
				sessionState.ProjectID = getStringValue(item["projectId"])
				sessionState.ConnectURL = getStringValue(item["connectUrl"])
				sessionState.PublicIP = getStringValue(item["publicIP"])

				if sessionState.ID == "" {
					continue // Skip invalid sessions
				}

				// Parse timestamps
				if createdAt := getNumberValue(item["createdAt"]); createdAt != 0 {
					sessionState.CreatedAt = time.Unix(createdAt, 0)
				}
				if updatedAt := getNumberValue(item["updatedAt"]); updatedAt != 0 {
					sessionState.UpdatedAt = time.Unix(updatedAt, 0)
				}

				// Parse optional fields
				if metadata, ok := item["userMetadata"]; ok {
					attributevalue.Unmarshal(metadata, &sessionState.UserMetadata)
				}
			}

			sessions = append(sessions, &sessionState)
		}

		// Check if there are more items
		lastEvaluatedKey = result.LastEvaluatedKey
		if lastEvaluatedKey == nil {
			break
		}
	}

	return sessions, nil
}
