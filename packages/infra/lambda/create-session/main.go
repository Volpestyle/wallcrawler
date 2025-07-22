package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/ecs"
	"github.com/aws/aws-sdk-go-v2/service/ecs/types"
	shared "github.com/wallcrawler/go-shared"
)

// Request/Response types
type CreateSessionRequest struct {
	BrowserSettings map[string]interface{} `json:"browserSettings,omitempty"`
	Timeout         int                    `json:"timeout,omitempty"`
}

type CreateSessionResponse struct {
	Success bool                   `json:"success"`
	Data    *SessionData           `json:"data,omitempty"`
	Error   string                 `json:"error,omitempty"`
	Details string                 `json:"details,omitempty"`
}

type SessionData struct {
	SessionID  string `json:"sessionId"`
	ConnectURL string `json:"connectUrl"`
	Token      string `json:"token"`
	Available  bool   `json:"available"`
}

// Global clients
var (
	ecsClient   *ecs.Client
	redisClient *shared.RedisClient
)

func init() {
	// Initialize AWS SDK
	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		log.Fatalf("Failed to load AWS config: %v", err)
	}

	ecsClient = ecs.NewFromConfig(cfg)
	redisClient = shared.NewRedisClient()
}

func main() {
	lambda.Start(handler)
}

func handler(ctx context.Context, event events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	log.Printf("Create session request: %+v", event)

	// Get API key from request context
	apiKey := event.RequestContext.Identity.APIKey
	if apiKey == "" {
		return errorResponse(401, "API key missing from request context", "")
	}

	// Derive user ID from API key
	userID := fmt.Sprintf("user_%s", apiKey[:8])

	// Parse request body
	var body CreateSessionRequest
	if event.Body != "" {
		if err := json.Unmarshal([]byte(event.Body), &body); err != nil {
			return errorResponse(400, "Invalid request body", err.Error())
		}
	}

	// Set defaults
	if body.BrowserSettings == nil {
		body.BrowserSettings = make(map[string]interface{})
	}
	if body.Timeout == 0 {
		body.Timeout = 60 // Default 60 minutes
	}

	// Generate session ID
	sessionID := shared.GenerateSessionID()

	// Create session data
	session := &shared.Session{
		ID:           sessionID,
		UserID:       userID,
		Status:       "pending",
		CreatedAt:    time.Now(),
		LastActivity: time.Now(),
		Options: shared.SessionOptions{
			// Convert from map to struct if needed
		},
	}

	// Store session in Redis
	if err := redisClient.StoreSession(ctx, sessionID, session); err != nil {
		return errorResponse(500, "Failed to store session", err.Error())
	}

	// Set session TTL
	if err := redisClient.SetSessionTTL(ctx, sessionID, time.Duration(body.Timeout)*time.Minute); err != nil {
		log.Printf("Failed to set session TTL: %v", err)
	}

	// Check capacity and start ECS task if needed
	if err := checkAndStartTask(ctx, sessionID); err != nil {
		log.Printf("Failed to check/start ECS task: %v", err)
		// Don't fail the request, just log the error
	}

	// Create JWT token
	token, err := shared.CreateJWTToken(sessionID, userID, body.BrowserSettings, body.Timeout)
	if err != nil {
		return errorResponse(500, "Failed to create token", err.Error())
	}

	// Build connection URL
	connectURL := shared.BuildConnectURL(sessionID, token)

	log.Printf("Created session %s for user %s", sessionID, userID)

	return events.APIGatewayProxyResponse{
		StatusCode: 200,
		Headers: map[string]string{
			"Content-Type": "application/json",
		},
		Body: mustMarshal(CreateSessionResponse{
			Success: true,
			Data: &SessionData{
				SessionID:  sessionID,
				ConnectURL: connectURL,
				Token:      token,
				Available:  true,
			},
		}),
	}, nil
}

// checkAndStartTask checks ECS capacity and starts new tasks if needed
func checkAndStartTask(ctx context.Context, sessionID string) error {
	// Get current running task count
	describeInput := &ecs.DescribeServicesInput{
		Cluster:  shared.StringPtr(shared.GetECSClusterARN()),
		Services: []string{shared.GetECSServiceName()},
	}

	describeOutput, err := ecsClient.DescribeServices(ctx, describeInput)
	if err != nil {
		return fmt.Errorf("failed to describe ECS services: %w", err)
	}

	var runningCount, pendingCount int32
	if len(describeOutput.Services) > 0 {
		service := describeOutput.Services[0]
		runningCount = service.RunningCount
		pendingCount = service.PendingCount
	}

	log.Printf("Current ECS service state: running=%d, pending=%d", runningCount, pendingCount)

	// Count active sessions across all containers
	sessionKeys, err := redisClient.Keys(ctx, "session:*").Result()
	if err != nil {
		log.Printf("Failed to get session keys: %v", err)
		sessionKeys = []string{} // Continue with empty list
	}

	activeSessions := 0
	for _, key := range sessionKeys {
		sessionData, err := redisClient.HGetAll(ctx, key).Result()
		if err != nil {
			continue
		}
		if status, ok := sessionData["status"]; ok && (status == "active" || status == "pending") {
			activeSessions++
		}
	}

	maxSessionsPerContainer := shared.GetMaxSessionsPerContainer()
	maxContainers := shared.GetMaxContainers()
	totalCapacity := int(runningCount) * maxSessionsPerContainer
	needsNewTask := activeSessions >= totalCapacity && int(runningCount+pendingCount) < maxContainers

	log.Printf("Capacity check: active=%d, capacity=%d, needsNew=%t", activeSessions, totalCapacity, needsNewTask)

	if needsNewTask {
		log.Printf("Starting new ECS task for session %s", sessionID)
		if err := startNewECSTask(ctx, sessionID); err != nil {
			return fmt.Errorf("failed to start ECS task: %w", err)
		}
	} else {
		// Add to pending queue for existing containers
		if err := redisClient.AddToPendingQueue(ctx, sessionID); err != nil {
			return fmt.Errorf("failed to add session to pending queue: %w", err)
		}
		log.Printf("Added session %s to pending queue for existing containers", sessionID)
	}

	return nil
}

// startNewECSTask starts a new ECS task
func startNewECSTask(ctx context.Context, sessionID string) error {
	subnets := shared.GetSubnetIDs()
	securityGroups := shared.GetSecurityGroupIDs()

	runTaskInput := &ecs.RunTaskInput{
		Cluster:        shared.StringPtr(shared.GetECSClusterARN()),
		TaskDefinition: shared.StringPtr(shared.GetECSTaskDefinitionARN()),
		Count:          shared.Int32Ptr(1),
		LaunchType:     types.LaunchTypeFargate,
		NetworkConfiguration: &types.NetworkConfiguration{
			AwsvpcConfiguration: &types.AwsVpcConfiguration{
				Subnets:        subnets,
				SecurityGroups: securityGroups,
				AssignPublicIp: types.AssignPublicIpEnabled,
			},
		},
		Overrides: &types.TaskOverride{
			ContainerOverrides: []types.ContainerOverride{
				{
					Name: shared.StringPtr("BrowserContainer"),
					Environment: []types.KeyValuePair{
						{Name: shared.StringPtr("REDIS_ENDPOINT"), Value: shared.StringPtr(shared.GetRedisEndpoint())},
						{Name: shared.StringPtr("S3_BUCKET"), Value: shared.StringPtr(shared.GetS3Bucket())},
						{Name: shared.StringPtr("MAX_SESSIONS"), Value: shared.StringPtr(strconv.Itoa(shared.GetMaxSessions()))},
						{Name: shared.StringPtr("ENVIRONMENT"), Value: shared.StringPtr(shared.GetEnvironment())},
					},
				},
			},
		},
	}

	output, err := ecsClient.RunTask(ctx, runTaskInput)
	if err != nil {
		return err
	}

	if len(output.Tasks) > 0 {
		taskArn := *output.Tasks[0].TaskArn
		log.Printf("Started ECS task: %s", taskArn)

		// Add session to pending queue and store task ARN
		if err := redisClient.AddToPendingQueue(ctx, sessionID); err != nil {
			log.Printf("Failed to add session to pending queue: %v", err)
		}
		if err := redisClient.HSet(ctx, fmt.Sprintf("session:%s", sessionID), "taskArn", taskArn).Err(); err != nil {
			log.Printf("Failed to store task ARN: %v", err)
		}
	}

	return nil
}

// Utility functions
func errorResponse(statusCode int, message, details string) (events.APIGatewayProxyResponse, error) {
	return events.APIGatewayProxyResponse{
		StatusCode: statusCode,
		Headers: map[string]string{
			"Content-Type": "application/json",
		},
		Body: mustMarshal(CreateSessionResponse{
			Success: false,
			Error:   message,
			Details: details,
		}),
	}, nil
}

func mustMarshal(v interface{}) string {
	data, err := json.Marshal(v)
	if err != nil {
		log.Printf("Failed to marshal JSON: %v", err)
		return "{}"
	}
	return string(data)
} 