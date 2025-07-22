package shared

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/config"
)

// LoadAWSConfig loads the default AWS configuration
func LoadAWSConfig(ctx context.Context) (config.Config, error) {
	return config.LoadDefaultConfig(ctx)
}

// LoadAWSConfigWithRegion loads AWS configuration with a specific region
func LoadAWSConfigWithRegion(ctx context.Context, region string) (config.Config, error) {
	return config.LoadDefaultConfig(ctx, config.WithRegion(region))
}

// BuildConnectURL builds the WebSocket connection URL based on available endpoints
func BuildConnectURL(sessionID, token string) string {
	cdpEndpoint := GetEnv("CDP_ENDPOINT", "")
	if cdpEndpoint != "" {
		// Use CDP endpoint for direct connection
		return fmt.Sprintf("wss://%s/cdp?sessionId=%s&token=%s", cdpEndpoint, sessionID, token)
	}

	// Fallback to WebSocket API
	wsAPIID := GetEnv("WEBSOCKET_API_ID", "")
	if wsAPIID != "" {
		region := GetAWSRegion()
		environment := GetEnvironment()
		return fmt.Sprintf("wss://%s.execute-api.%s.amazonaws.com/%s?sessionId=%s&token=%s",
			wsAPIID, region, environment, sessionID, token)
	}

	// Default fallback for local development
	return fmt.Sprintf("wss://localhost:8080/internal/ws?sessionId=%s&token=%s", sessionID, token)
}

// GetECSEnvironmentVariables returns environment variables for ECS container overrides
func GetECSEnvironmentVariables() []map[string]string {
	return []map[string]string{
		{"name": "REDIS_ENDPOINT", "value": GetRedisEndpoint()},
		{"name": "S3_BUCKET", "value": GetS3Bucket()},
		{"name": "MAX_SESSIONS", "value": fmt.Sprintf("%d", GetMaxSessions())},
		{"name": "ENVIRONMENT", "value": GetEnvironment()},
		{"name": "JWE_SECRET", "value": GetJWESecret()},
	}
}

// GetSubnetIDs returns subnet IDs as a slice
func GetSubnetIDs() []string {
	subnetIDsStr := GetEnvRequired("SUBNET_IDS")
	return SplitString(subnetIDsStr, ",")
}

// GetSecurityGroupIDs returns security group IDs as a slice  
func GetSecurityGroupIDs() []string {
	sgIDsStr := GetEnvRequired("SECURITY_GROUP_ID")
	return SplitString(sgIDsStr, ",")
}

// ECS Configuration helpers

// GetECSClusterARN returns the ECS cluster ARN
func GetECSClusterARN() string {
	return GetEnvRequired("ECS_CLUSTER_ARN")
}

// GetECSServiceName returns the ECS service name
func GetECSServiceName() string {
	return GetEnvRequired("ECS_SERVICE_NAME")
}

// GetECSTaskDefinitionARN returns the ECS task definition ARN
func GetECSTaskDefinitionARN() string {
	return GetEnvRequired("ECS_TASK_DEFINITION_ARN")
}

// API Gateway helpers

// GetWebSocketAPIID returns the WebSocket API ID
func GetWebSocketAPIID() string {
	return GetEnv("WEBSOCKET_API_ID", "")
}

// GetCDPEndpoint returns the CDP endpoint
func GetCDPEndpoint() string {
	return GetEnv("CDP_ENDPOINT", "")
}

// BuildAPIGatewayEndpoint builds the API Gateway Management API endpoint
func BuildAPIGatewayEndpoint(domainName, stage string) string {
	return fmt.Sprintf("https://%s/%s", domainName, stage)
}

// ECS Task utilities

// BuildTaskARN builds a task ARN from cluster ARN and task ID
func BuildTaskARN(clusterARN, taskID string) string {
	// Extract the account and region from cluster ARN
	// Format: arn:aws:ecs:region:account:cluster/cluster-name
	// Task ARN: arn:aws:ecs:region:account:task/cluster-name/task-id
	
	// This is a simplified version - in production you might want more robust parsing
	parts := SplitString(clusterARN, ":")
	if len(parts) >= 4 {
		region := parts[3]
		account := parts[4]
		clusterName := parts[5][8:] // Remove "cluster/" prefix
		
		return fmt.Sprintf("arn:aws:ecs:%s:%s:task/%s/%s", region, account, clusterName, taskID)
	}
	
	return taskID // Fallback to just the task ID
}

// Metadata utilities

// GetECSMetadataURI returns the ECS metadata URI
func GetECSMetadataURI() string {
	return GetEnv("ECS_CONTAINER_METADATA_URI_V4", "")
}

// GetTaskARN returns the current task ARN
func GetTaskARN() string {
	return GetEnv("ECS_TASK_ARN", "local")
}

// Health check utilities

// BuildHealthCheckData builds health check data for containers
func BuildHealthCheckData(containerID string, sessionCount, maxSessions int) map[string]interface{} {
	return map[string]interface{}{
		"status":      "healthy",
		"containerId": containerID,
		"sessions":    sessionCount,
		"maxSessions": maxSessions,
		"timestamp":   FormatNow(),
		"uptime":      GetUptime(),
	}
}

// GetUptime returns a placeholder uptime value
func GetUptime() float64 {
	// In a real implementation, you'd track actual uptime
	// For now, return 0 as a placeholder
	return 0.0
} 