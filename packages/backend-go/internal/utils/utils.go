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
	"github.com/wallcrawler/backend-go/internal/types"
)

var (
	SessionsTableName          = os.Getenv("SESSIONS_TABLE_NAME")
	ProjectsTableName          = os.Getenv("PROJECTS_TABLE_NAME")
	APIKeysTableName           = os.Getenv("API_KEYS_TABLE_NAME")
	ContextsTableName          = os.Getenv("CONTEXTS_TABLE_NAME")
	ContextsBucketName         = os.Getenv("CONTEXTS_BUCKET_NAME")
	SessionArtifactsBucketName = os.Getenv("SESSION_ARTIFACTS_BUCKET_NAME")
	ECSCluster                 = os.Getenv("ECS_CLUSTER")
	ECSTaskDefFamily           = os.Getenv("ECS_TASK_DEFINITION_FAMILY") // Just the family name, not the full ARN
	ConnectURL                 = os.Getenv("CONNECT_URL_BASE")
	maxSessionTimeout          = getMaxSessionTimeout()
)

const (
	defaultSessionTimeoutSeconds = 3600 // 1 hour
)

func getMaxSessionTimeout() int {
	if raw := os.Getenv("WALLCRAWLER_MAX_SESSION_TIMEOUT"); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 {
			return v
		}
	}
	return defaultSessionTimeoutSeconds
}

// NormalizeSessionTimeout enforces configured bounds for session duration.
func NormalizeSessionTimeout(requested int) int {
	if requested <= 0 {
		return defaultSessionTimeoutSeconds
	}
	if requested > maxSessionTimeout {
		return maxSessionTimeout
	}
	return requested
}

// EventType represents the type of Lambda event
type EventType int

const (
	EventTypeUnknown EventType = iota
	EventTypeAPIGateway
	EventTypeSNS
)

// ParseLambdaEvent converts raw Lambda events to their proper types
// This handles the case where API Gateway with custom authorizers sends events as map[string]interface{}
func ParseLambdaEvent(event interface{}) (interface{}, EventType, error) {
	// Try direct type assertion for API Gateway request
	if apiReq, ok := event.(events.APIGatewayProxyRequest); ok {
		return apiReq, EventTypeAPIGateway, nil
	}

	// Try direct type assertion for SNS event
	if snsEvent, ok := event.(events.SNSEvent); ok {
		return snsEvent, EventTypeSNS, nil
	}

	// Handle raw map from API Gateway (happens with custom authorizers)
	if rawEvent, ok := event.(map[string]interface{}); ok {
		// Marshal to JSON to properly convert the map
		eventJSON, err := json.Marshal(rawEvent)
		if err != nil {
			return nil, EventTypeUnknown, fmt.Errorf("failed to marshal raw event: %v", err)
		}

		// Try to parse as API Gateway request first (most common)
		var apiReq events.APIGatewayProxyRequest
		if err := json.Unmarshal(eventJSON, &apiReq); err == nil {
			// Check if it has required fields to be an API Gateway request
			if apiReq.HTTPMethod != "" && apiReq.Path != "" {
				return apiReq, EventTypeAPIGateway, nil
			}
		}

		// Try to parse as SNS event
		var snsEvent events.SNSEvent
		if err := json.Unmarshal(eventJSON, &snsEvent); err == nil {
			// Check if it has SNS records
			if len(snsEvent.Records) > 0 {
				return snsEvent, EventTypeSNS, nil
			}
		}

		return nil, EventTypeUnknown, fmt.Errorf("unable to determine event type from raw map")
	}

	return nil, EventTypeUnknown, fmt.Errorf("unsupported event type: %T", event)
}

// GetDynamoDBClient returns a configured DynamoDB client
func GetDynamoDBClient(ctx context.Context) (*dynamodb.Client, error) {
	cfg, err := GetAWSConfig()
	if err != nil {
		return nil, err
	}
	return dynamodb.NewFromConfig(cfg), nil
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
	// Ensure the TTL aligns with the computed session expiration
	if sessionState.ExpiresAtUnix == 0 {
		return fmt.Errorf("session %s missing expiration timestamp", sessionState.ID)
	}

	// Convert session state to DynamoDB attributes
	item := map[string]dynamotypes.AttributeValue{
		"sessionId":      &dynamotypes.AttributeValueMemberS{Value: sessionState.ID},
		"status":         &dynamotypes.AttributeValueMemberS{Value: sessionState.Status},
		"internalStatus": &dynamotypes.AttributeValueMemberS{Value: sessionState.InternalStatus},
		"projectId":      &dynamotypes.AttributeValueMemberS{Value: sessionState.ProjectID},
		"keepAlive":      &dynamotypes.AttributeValueMemberBOOL{Value: sessionState.KeepAlive},
		"region":         &dynamotypes.AttributeValueMemberS{Value: sessionState.Region},
		"startedAt":      &dynamotypes.AttributeValueMemberS{Value: sessionState.StartedAt},
		"expiresAt":      &dynamotypes.AttributeValueMemberN{Value: strconv.FormatInt(sessionState.ExpiresAtUnix, 10)},
		"proxyBytes":     &dynamotypes.AttributeValueMemberN{Value: strconv.Itoa(sessionState.ProxyBytes)},
		"publicIP":       &dynamotypes.AttributeValueMemberS{Value: sessionState.PublicIP},
		"ecsTaskArn":     &dynamotypes.AttributeValueMemberS{Value: sessionState.ECSTaskARN},
	}

	// Add timestamp fields (store as strings for SDK compatibility)
	item["createdAt"] = &dynamotypes.AttributeValueMemberS{Value: sessionState.CreatedAt}
	item["updatedAt"] = &dynamotypes.AttributeValueMemberS{Value: sessionState.UpdatedAt}

	// Add optional pointer fields
	if sessionState.ConnectURL != nil {
		item["connectUrl"] = &dynamotypes.AttributeValueMemberS{Value: *sessionState.ConnectURL}
	}
	if sessionState.SigningKey != nil {
		item["signingKey"] = &dynamotypes.AttributeValueMemberS{Value: *sessionState.SigningKey}
	}
	if sessionState.SeleniumRemoteURL != nil {
		item["seleniumRemoteUrl"] = &dynamotypes.AttributeValueMemberS{Value: *sessionState.SeleniumRemoteURL}
	}
	if sessionState.AvgCPUUsage != nil {
		item["avgCpuUsage"] = &dynamotypes.AttributeValueMemberN{Value: strconv.Itoa(*sessionState.AvgCPUUsage)}
	}
	if sessionState.ContextID != nil {
		item["contextId"] = &dynamotypes.AttributeValueMemberS{Value: *sessionState.ContextID}
	}
	if sessionState.ContextPersist {
		item["contextPersist"] = &dynamotypes.AttributeValueMemberBOOL{Value: true}
	}
	if sessionState.EndedAt != nil {
		item["endedAt"] = &dynamotypes.AttributeValueMemberS{Value: *sessionState.EndedAt}
	}
	if sessionState.MemoryUsage != nil {
		item["memoryUsage"] = &dynamotypes.AttributeValueMemberN{Value: strconv.Itoa(*sessionState.MemoryUsage)}
	}
	if sessionState.ContextStorageKey != nil && *sessionState.ContextStorageKey != "" {
		item["contextStorageKey"] = &dynamotypes.AttributeValueMemberS{Value: *sessionState.ContextStorageKey}
	}

	// Add optional fields
	if len(sessionState.UserMetadata) > 0 {
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
		TableName: aws.String(SessionsTableName),
		Item:      item,
	})

	if err != nil {
		log.Printf("Error storing session %s in DynamoDB: %v", sessionState.ID, err)
		return err
	}

	log.Printf("Stored session %s in DynamoDB with TTL %d", sessionState.ID, sessionState.ExpiresAtUnix)
	return nil
}

// GetSession retrieves session state from DynamoDB
func GetSession(ctx context.Context, ddbClient *dynamodb.Client, sessionID string) (*types.SessionState, error) {
	result, err := ddbClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(SessionsTableName),
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
	if err == nil {
		// Automatic unmarshal succeeded - ensure ExpiresAt string is populated from Unix timestamp
		if sessionState.ExpiresAtUnix > 0 && sessionState.ExpiresAt == "" {
			sessionState.ExpiresAt = time.Unix(sessionState.ExpiresAtUnix, 0).Format(time.RFC3339)
		}
	} else {
		// Try manual unmarshaling for better control
		sessionState.ID = getStringValue(result.Item["sessionId"])
		sessionState.Status = getStringValue(result.Item["status"])
		sessionState.ProjectID = getStringValue(result.Item["projectId"])
		sessionState.KeepAlive = getBoolValue(result.Item["keepAlive"])
		sessionState.Region = getStringValue(result.Item["region"])
		sessionState.StartedAt = getStringValue(result.Item["startedAt"])
		// Handle expiresAt - it's stored as a number in DynamoDB but needs to be a string in the API
		if expiresAtUnix := getNumberValue(result.Item["expiresAt"]); expiresAtUnix > 0 {
			sessionState.ExpiresAtUnix = expiresAtUnix
			sessionState.ExpiresAt = time.Unix(expiresAtUnix, 0).Format(time.RFC3339)
		} else {
			// Fallback for old format (string)
			sessionState.ExpiresAt = getStringValue(result.Item["expiresAt"])
		}
		sessionState.ProxyBytes = int(getNumberValue(result.Item["proxyBytes"]))
		sessionState.PublicIP = getStringValue(result.Item["publicIP"])
		sessionState.ECSTaskARN = getStringValue(result.Item["ecsTaskArn"])
		sessionState.CreatedAt = getStringValue(result.Item["createdAt"])
		sessionState.UpdatedAt = getStringValue(result.Item["updatedAt"])

		// Handle optional pointer fields
		if connectURL := getStringValue(result.Item["connectUrl"]); connectURL != "" {
			sessionState.ConnectURL = &connectURL
		}
		if signingKey := getStringValue(result.Item["signingKey"]); signingKey != "" {
			sessionState.SigningKey = &signingKey
		}
		if internalStatus := getStringValue(result.Item["internalStatus"]); internalStatus != "" {
			sessionState.InternalStatus = internalStatus
		}
		if seleniumURL := getStringValue(result.Item["seleniumRemoteUrl"]); seleniumURL != "" {
			sessionState.SeleniumRemoteURL = &seleniumURL
		}
		if contextID := getStringValue(result.Item["contextId"]); contextID != "" {
			sessionState.ContextID = &contextID
		}
		if persistAttr, ok := result.Item["contextPersist"].(*dynamotypes.AttributeValueMemberBOOL); ok {
			sessionState.ContextPersist = persistAttr.Value
		}
		if endedAt := getStringValue(result.Item["endedAt"]); endedAt != "" {
			sessionState.EndedAt = &endedAt
		}
		if avgCPU := getNumberValue(result.Item["avgCpuUsage"]); avgCPU != 0 {
			cpu := int(avgCPU)
			sessionState.AvgCPUUsage = &cpu
		}
		if memUsage := getNumberValue(result.Item["memoryUsage"]); memUsage != 0 {
			mem := int(memUsage)
			sessionState.MemoryUsage = &mem
		}
		if storageKey := getStringValue(result.Item["contextStorageKey"]); storageKey != "" {
			sessionState.ContextStorageKey = &storageKey
		}

		// Parse optional fields
		if metadata, ok := result.Item["userMetadata"]; ok {
			attributevalue.Unmarshal(metadata, &sessionState.UserMetadata)
		}
		if config, ok := result.Item["modelConfig"]; ok {
			attributevalue.Unmarshal(config, &sessionState.ModelConfig)
		}
		if internalStatus := getStringValue(result.Item["internalStatus"]); internalStatus != "" {
			sessionState.InternalStatus = internalStatus
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

func getBoolValue(attr dynamotypes.AttributeValue) bool {
	if v, ok := attr.(*dynamotypes.AttributeValueMemberBOOL); ok {
		return v.Value
	}
	return false
}

// UpdateSessionStatus updates session status in Redis with proper lifecycle tracking
func UpdateSessionStatus(ctx context.Context, ddbClient *dynamodb.Client, sessionID, status string) error {
	sessionState, err := GetSession(ctx, ddbClient, sessionID)
	if err != nil {
		return err
	}

	// Update status with proper lifecycle timing
	previousStatus := sessionState.Status
	sessionState.Status = MapStatusToSDK(status) // Map internal status to SDK status
	sessionState.InternalStatus = status
	now := time.Now()
	nowStr := now.Format(time.RFC3339)
	sessionState.UpdatedAt = nowStr

	// Track specific lifecycle timestamps
	switch status {
	case types.SessionStatusProvisioning:
		sessionState.ProvisioningStartedAt = &nowStr
	case types.SessionStatusReady:
		sessionState.ReadyAt = &nowStr
	case types.SessionStatusActive:
		sessionState.LastActiveAt = &nowStr
	case types.SessionStatusTerminating, types.SessionStatusStopped, types.SessionStatusFailed:
		sessionState.EndedAt = &nowStr // SDK field
	}

	// Add event to history
	sessionEvent := types.SessionEvent{
		EventType: "StatusChanged",
		Timestamp: nowStr,
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
	sessionState.LastEventTimestamp = &nowStr

	return StoreSession(ctx, ddbClient, sessionState)
}

// DeleteSession removes session from DynamoDB
func DeleteSession(ctx context.Context, ddbClient *dynamodb.Client, sessionID string) error {
	_, err := ddbClient.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(SessionsTableName),
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
		{Name: aws.String("SESSIONS_TABLE_NAME"), Value: aws.String(SessionsTableName)},
		{Name: aws.String("PROJECT_ID"), Value: aws.String(sessionState.ProjectID)},
	}

	if sessionState.ContextID != nil && *sessionState.ContextID != "" &&
		sessionState.ContextStorageKey != nil && *sessionState.ContextStorageKey != "" && ContextsBucketName != "" {
		env = append(env,
			ecstypes.KeyValuePair{Name: aws.String("CONTEXT_ID"), Value: aws.String(*sessionState.ContextID)},
			ecstypes.KeyValuePair{Name: aws.String("CONTEXT_S3_KEY"), Value: aws.String(*sessionState.ContextStorageKey)},
			ecstypes.KeyValuePair{Name: aws.String("CONTEXTS_BUCKET_NAME"), Value: aws.String(ContextsBucketName)},
			ecstypes.KeyValuePair{Name: aws.String("CONTEXT_PERSIST"), Value: aws.String(strconv.FormatBool(sessionState.ContextPersist))},
		)
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
	nowStr := now.Format(time.RFC3339)
	sessionEvent := types.SessionEvent{
		EventType: eventType,
		Timestamp: nowStr,
		Source:    source,
		Detail:    detail,
	}

	if sessionState.EventHistory == nil {
		sessionState.EventHistory = []types.SessionEvent{}
	}
	sessionState.EventHistory = append(sessionState.EventHistory, sessionEvent)
	sessionState.LastEventTimestamp = &nowStr
	sessionState.UpdatedAt = nowStr

	// Store updated session state
	if err := StoreSession(ctx, ddbClient, sessionState); err != nil {
		return err
	}

	// Publish to EventBridge
	return PublishEvent(ctx, sessionID, eventType, detail)
}

// CreateSessionWithDefaults creates a new session with default resource limits and billing info
func CreateSessionWithDefaults(sessionID, projectID string, modelConfig *types.ModelConfig, timeoutSeconds int) *types.SessionState {
	now := time.Now()
	nowStr := now.Format(time.RFC3339)
	if timeoutSeconds <= 0 {
		timeoutSeconds = defaultSessionTimeoutSeconds
	}
	if timeoutSeconds > maxSessionTimeout {
		timeoutSeconds = maxSessionTimeout
	}
	expiresAtTime := now.Add(time.Duration(timeoutSeconds) * time.Second)
	expiresAt := expiresAtTime.Format(time.RFC3339)
	expiresAtUnix := expiresAtTime.Unix()

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
		Status:         types.SessionStatusRunning, // SDK status - session is being prepared
		InternalStatus: types.SessionStatusCreating,
		ProjectID:      projectID,
		ModelConfig:    modelConfig,
		CreatedAt:      nowStr,
		StartedAt:      nowStr,
		UpdatedAt:      nowStr,
		ExpiresAt:      expiresAt,
		ExpiresAtUnix:  expiresAtUnix,
		KeepAlive:      false,
		Region:         "us-east-1",
		ProxyBytes:     0,
		ResourceLimits: defaultLimits,
		BillingInfo:    billingInfo,
		EventHistory:   []types.SessionEvent{},
		RetryCount:     0,
		UserMetadata:   make(map[string]interface{}),
	}
}

// IsSessionActive checks if session is in an active state
func IsSessionActive(status string) bool {
	return status == types.SessionStatusReady ||
		status == types.SessionStatusActive ||
		status == types.SessionStatusStarting
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
	case types.SessionStatusTimedOut:
		return "TIMED_OUT"
	default:
		return "ERROR" // Unknown status, default to error
	}
}

// GetSessionsByProjectID retrieves all sessions for a specific project using GSI
func GetSessionsByProjectID(ctx context.Context, ddbClient *dynamodb.Client, projectID string) ([]*types.SessionState, error) {
	var sessions []*types.SessionState
	var lastEvaluatedKey map[string]dynamotypes.AttributeValue

	for {
		// Query using GSI
		queryInput := &dynamodb.QueryInput{
			TableName:              aws.String(SessionsTableName),
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
				sessionState.PublicIP = getStringValue(item["publicIP"])

				// Handle optional pointer fields
				if connectURL := getStringValue(item["connectUrl"]); connectURL != "" {
					sessionState.ConnectURL = &connectURL
				}

				if sessionState.ID == "" {
					continue // Skip invalid sessions
				}

				// Parse timestamps
				if createdAt := getNumberValue(item["createdAt"]); createdAt != 0 {
					sessionState.CreatedAt = time.Unix(createdAt, 0).Format(time.RFC3339)
				}
				if updatedAt := getNumberValue(item["updatedAt"]); updatedAt != 0 {
					sessionState.UpdatedAt = time.Unix(updatedAt, 0).Format(time.RFC3339)
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
