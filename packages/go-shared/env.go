package shared

import (
	"os"
	"strconv"
)

// GetEnv gets an environment variable with a default value
func GetEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// GetEnvRequired gets a required environment variable and panics if not set
func GetEnvRequired(key string) string {
	value := os.Getenv(key)
	if value == "" {
		panic("Required environment variable " + key + " not set")
	}
	return value
}

// GetEnvInt gets an environment variable as an integer with a default value
func GetEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if i, err := strconv.Atoi(value); err == nil {
			return i
		}
	}
	return defaultValue
}

// GetEnvBool gets an environment variable as a boolean with a default value
func GetEnvBool(key string, defaultValue bool) bool {
	if value := os.Getenv(key); value != "" {
		if b, err := strconv.ParseBool(value); err == nil {
			return b
		}
	}
	return defaultValue
}

// GetEnvFloat gets an environment variable as a float64 with a default value
func GetEnvFloat(key string, defaultValue float64) float64 {
	if value := os.Getenv(key); value != "" {
		if f, err := strconv.ParseFloat(value, 64); err == nil {
			return f
		}
	}
	return defaultValue
}

// Common environment variable getters for wallcrawler

// GetRedisEndpoint gets the Redis endpoint from environment
func GetRedisEndpoint() string {
	return GetEnvRequired("REDIS_ENDPOINT")
}

// GetRedisPassword gets the Redis password from environment (optional)
func GetRedisPassword() string {
	return GetEnv("REDIS_PASSWORD", "")
}

// GetJWESecret gets the JWE secret from environment (with development fallback)
func GetJWESecret() string {
	return GetEnv("JWE_SECRET", "development-secret")
}

// GetJWESecretARN gets the JWE secret ARN from environment
func GetJWESecretARN() string {
	return GetEnvRequired("JWE_SECRET_ARN")
}

// GetS3Bucket gets the S3 bucket name from environment
func GetS3Bucket() string {
	return GetEnvRequired("S3_BUCKET")
}

// GetEnvironment gets the deployment environment (dev, staging, prod)
func GetEnvironment() string {
	return GetEnv("ENVIRONMENT", "dev")
}

// GetAWSRegion gets the AWS region from environment
func GetAWSRegion() string {
	return GetEnv("AWS_REGION", "us-east-1")
}

// GetMaxSessions gets the maximum sessions per container
func GetMaxSessions() int {
	return GetEnvInt("MAX_SESSIONS", 20)
}

// GetMaxContainers gets the maximum number of containers
func GetMaxContainers() int {
	return GetEnvInt("MAX_CONTAINERS", 10)
}

// GetMaxSessionsPerContainer gets the maximum sessions per container for ECS
func GetMaxSessionsPerContainer() int {
	return GetEnvInt("MAX_SESSIONS_PER_CONTAINER", 20)
}

// GetContainerID gets the container ID (auto-generated if not set)
func GetContainerID() string {
	return GetEnv("CONTAINER_ID", GenerateContainerID())
}

// GetPort gets the server port
func GetPort() int {
	return GetEnvInt("PORT", 8080)
}

// GetCDPPort gets the CDP debug port
func GetCDPPort() int {
	return GetEnvInt("CDP_PORT", 9222)
} 