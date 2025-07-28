package utils

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/apigatewaymanagementapi"
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
	RedisAddr  = os.Getenv("REDIS_ADDR")
	ECSCluster = os.Getenv("ECS_CLUSTER")
	ECSTaskDef = os.Getenv("ECS_TASK_DEFINITION")
	ConnectURL = os.Getenv("CONNECT_URL_BASE")
)

// GetRedisClient returns a configured Redis client
func GetRedisClient() *redis.Client {
	return redis.NewClient(&redis.Options{
		Addr: RedisAddr,
	})
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

// StoreSession stores session state in Redis
func StoreSession(ctx context.Context, rdb *redis.Client, sessionState *types.SessionState) error {
	sessionData, err := json.Marshal(sessionState)
	if err != nil {
		return err
	}

	// Store with 24 hour expiration
	return rdb.Set(ctx, "session:"+sessionState.ID, sessionData, 24*time.Hour).Err()
}

// GetSession retrieves session state from Redis
func GetSession(ctx context.Context, rdb *redis.Client, sessionID string) (*types.SessionState, error) {
	data, err := rdb.Get(ctx, "session:"+sessionID).Result()
	if err != nil {
		return nil, err
	}

	var sessionState types.SessionState
	err = json.Unmarshal([]byte(data), &sessionState)
	if err != nil {
		return nil, err
	}

	return &sessionState, nil
}

// UpdateSessionStatus updates session status in Redis with proper lifecycle tracking
func UpdateSessionStatus(ctx context.Context, rdb *redis.Client, sessionID, status string) error {
	sessionState, err := GetSession(ctx, rdb, sessionID)
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

	return StoreSession(ctx, rdb, sessionState)
}

// DeleteSession removes session from Redis
func DeleteSession(ctx context.Context, rdb *redis.Client, sessionID string) error {
	return rdb.Del(ctx, "session:"+sessionID).Err()
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
		{Name: aws.String("REDIS_ADDR"), Value: aws.String(RedisAddr)},
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
		TaskDefinition: aws.String(ECSTaskDef),
		LaunchType:     ecstypes.LaunchTypeFargate,
		Count:          aws.Int32(1),
		Overrides: &ecstypes.TaskOverride{
			ContainerOverrides: []ecstypes.ContainerOverride{
				{
					Name:        aws.String("wallcrawler-controller"),
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

// ValidateHeaders validates required headers
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
					return getENIPublicIP(ctx, *detail.Value)
				}
			}
		}
	}

	return "", fmt.Errorf("no network interface found for task")
}

// getENIPublicIP gets the public IP of an Elastic Network Interface
func getENIPublicIP(ctx context.Context, eniID string) (string, error) {
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

// CreateCDPURL creates the CDP WebSocket URL for Direct Mode
func CreateCDPURL(taskIP string) string {
	// For Direct Mode, return the WebSocket URL for CDP
	return fmt.Sprintf("ws://%s:9222", taskIP)
}

// CreateAuthenticatedCDPURL creates the authenticated CDP WebSocket URL for Direct Mode
func CreateAuthenticatedCDPURL(taskIP, jwtToken string) string {
	// Get CDP proxy port from environment (set by CDK)
	cdpProxyPort := os.Getenv("CDP_PROXY_PORT")
	if cdpProxyPort == "" {
		cdpProxyPort = "9223" // Fallback to default
	}
	return fmt.Sprintf("ws://%s:%s/cdp?signingKey=%s", taskIP, cdpProxyPort, jwtToken)
}

// CreateDebuggerURL creates the authenticated debugger URL using our domain
func CreateDebuggerURL(taskIP, jwtToken string) string {
	// Get connect URL base from environment (set by CDK)
	connectURLBase := os.Getenv("CONNECT_URL_BASE")
	if connectURLBase == "" {
		connectURLBase = "https://api.wallcrawler.dev" // Fallback to default
	}
	
	// Get CDP proxy port from environment (set by CDK)
	cdpProxyPort := os.Getenv("CDP_PROXY_PORT")
	if cdpProxyPort == "" {
		cdpProxyPort = "9223" // Fallback to default
	}
	
	// Generate debugger URL using our own domain for proper proxy routing
	return fmt.Sprintf("%s/devtools/inspector.html?ws=%s:%s/cdp&signingKey=%s", 
		connectURLBase, taskIP, cdpProxyPort, jwtToken)
}

// CreateDebugURL creates the Chrome DevTools debug URL
func CreateDebugURL(taskIP string) string {
	return fmt.Sprintf("http://%s:9222", taskIP)
}

// PublishFrameData publishes frame data to Redis for WebSocket streaming
func PublishFrameData(ctx context.Context, rdb *redis.Client, sessionID string, frameData string) error {
	channel := fmt.Sprintf("session:%s:frames", sessionID)

	frame := map[string]interface{}{
		"type":      "frame",
		"data":      frameData,
		"timestamp": time.Now().UnixMilli(),
	}

	frameJSON, err := json.Marshal(frame)
	if err != nil {
		return fmt.Errorf("error marshaling frame data: %v", err)
	}

	return rdb.Publish(ctx, channel, string(frameJSON)).Err()
}

// SubscribeToFrames subscribes to frame updates for a session
func SubscribeToFrames(ctx context.Context, rdb *redis.Client, sessionID string) *redis.PubSub {
	channel := fmt.Sprintf("session:%s:frames", sessionID)
	return rdb.Subscribe(ctx, channel)
}

// BroadcastToSessionViewers sends a message to all WebSocket connections for a session
func BroadcastToSessionViewers(ctx context.Context, rdb *redis.Client, sessionID string, message interface{}, apiGatewayEndpoint string) error {
	// Get all viewer connection IDs for this session
	viewersKey := fmt.Sprintf("session:%s:viewers", sessionID)
	connectionIDs, err := rdb.SMembers(ctx, viewersKey).Result()
	if err != nil {
		return fmt.Errorf("error getting viewers for session %s: %v", sessionID, err)
	}

	if len(connectionIDs) == 0 {
		return nil // No viewers to broadcast to
	}

	// Get AWS config for API Gateway Management API
	cfg, err := GetAWSConfig()
	if err != nil {
		return fmt.Errorf("error getting AWS config: %v", err)
	}

	// Create API Gateway Management API client
	apiClient := apigatewaymanagementapi.NewFromConfig(cfg, func(o *apigatewaymanagementapi.Options) {
		o.BaseEndpoint = aws.String(apiGatewayEndpoint)
	})

	// Marshal message to JSON
	messageBytes, err := json.Marshal(message)
	if err != nil {
		return fmt.Errorf("error marshaling message: %v", err)
	}

	// Send to all connections
	var lastErr error
	successCount := 0
	for _, connectionID := range connectionIDs {
		_, err = apiClient.PostToConnection(ctx, &apigatewaymanagementapi.PostToConnectionInput{
			ConnectionId: aws.String(connectionID),
			Data:         messageBytes,
		})

		if err != nil {
			log.Printf("Error sending message to connection %s: %v", connectionID, err)
			// Remove stale connection
			rdb.SRem(ctx, viewersKey, connectionID)
			lastErr = err
		} else {
			successCount++
		}
	}

	log.Printf("Broadcasted message to %d/%d viewers for session %s", successCount, len(connectionIDs), sessionID)
	return lastErr
}

// GetActiveViewerCount returns the number of active WebSocket viewers for a session
func GetActiveViewerCount(ctx context.Context, rdb *redis.Client, sessionID string) (int64, error) {
	viewersKey := fmt.Sprintf("session:%s:viewers", sessionID)
	return rdb.SCard(ctx, viewersKey).Result()
}

// AddSessionEvent adds an event to session history and publishes to EventBridge
func AddSessionEvent(ctx context.Context, rdb *redis.Client, sessionID, eventType, source string, detail map[string]interface{}) error {
	sessionState, err := GetSession(ctx, rdb, sessionID)
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
	if err := StoreSession(ctx, rdb, sessionState); err != nil {
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
func IncrementSessionRetryCount(ctx context.Context, rdb *redis.Client, sessionID string) error {
	sessionState, err := GetSession(ctx, rdb, sessionID)
	if err != nil {
		return err
	}

	sessionState.RetryCount++
	sessionState.UpdatedAt = time.Now()

	return StoreSession(ctx, rdb, sessionState)
}

// UpdateSessionBilling updates billing information for a session
func UpdateSessionBilling(ctx context.Context, rdb *redis.Client, sessionID string, cpuSeconds, memoryMBHours float64, actionCount int) error {
	sessionState, err := GetSession(ctx, rdb, sessionID)
	if err != nil {
		return err
	}

	if sessionState.BillingInfo == nil {
		sessionState.BillingInfo = &types.BillingInfo{}
	}

	sessionState.BillingInfo.CPUSeconds += cpuSeconds
	sessionState.BillingInfo.MemoryMBHours += memoryMBHours
	sessionState.BillingInfo.ActionsCount += actionCount
	sessionState.BillingInfo.LastBillingAt = time.Now()
	sessionState.UpdatedAt = time.Now()

	return StoreSession(ctx, rdb, sessionState)
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
