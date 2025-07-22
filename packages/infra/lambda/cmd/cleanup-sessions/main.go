package main

import (
	"context"
	"log"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	shared "github.com/wallcrawler/go-shared"
)

// CleanupResult represents the result of a cleanup operation
type CleanupResult struct {
	SessionsCleaned int      `json:"sessionsCleaned"`
	TasksStopped    int      `json:"tasksStopped"`
	Errors          []string `json:"errors,omitempty"`
	Duration        float64  `json:"duration"`
	Timestamp       string   `json:"timestamp"`
}

// Global clients
var (
	redisClient *shared.RedisClient
)

func init() {
	redisClient = shared.NewRedisClient()
}

func main() {
	lambda.Start(handler)
}

func handler(ctx context.Context, event events.CloudWatchEvent) (CleanupResult, error) {
	startTime := time.Now()
	log.Printf("Starting session cleanup at %s", startTime.Format(time.RFC3339))

	result := CleanupResult{
		Timestamp: shared.FormatTime(startTime),
		Errors:    []string{},
	}

	// Get all session keys from Redis
	sessionKeys, err := getAllSessionKeys(ctx)
	if err != nil {
		log.Printf("Failed to get session keys: %v", err)
		result.Errors = append(result.Errors, err.Error())
		result.Duration = time.Since(startTime).Seconds()
		return result, nil
	}

	log.Printf("Found %d sessions to check", len(sessionKeys))

	// Check each session for staleness
	for _, sessionKey := range sessionKeys {
		sessionID := extractSessionIDFromKey(sessionKey)
		if sessionID == "" {
			continue
		}

		if shouldCleanupSession(ctx, sessionID) {
			if err := cleanupSession(ctx, sessionID); err != nil {
				log.Printf("Failed to cleanup session %s: %v", sessionID, err)
				result.Errors = append(result.Errors, err.Error())
			} else {
				result.SessionsCleaned++
				log.Printf("Cleaned up session %s", sessionID)
			}
		}
	}

	// Clean up orphaned ECS tasks
	tasksStoppedCount, err := cleanupOrphanedTasks(ctx)
	if err != nil {
		log.Printf("Failed to cleanup orphaned tasks: %v", err)
		result.Errors = append(result.Errors, err.Error())
	} else {
		result.TasksStopped = tasksStoppedCount
	}

	result.Duration = time.Since(startTime).Seconds()
	log.Printf("Cleanup completed: %d sessions cleaned, %d tasks stopped, %d errors",
		result.SessionsCleaned, result.TasksStopped, len(result.Errors))

	return result, nil
}

// getAllSessionKeys gets all session keys from Redis
func getAllSessionKeys(ctx context.Context) ([]string, error) {
	return redisClient.Keys(ctx, "session:*").Result()
}

// extractSessionIDFromKey extracts session ID from Redis key like "session:ses_123"
func extractSessionIDFromKey(key string) string {
	if len(key) > 8 && key[:8] == "session:" {
		return key[8:]
	}
	return ""
}

// shouldCleanupSession determines if a session should be cleaned up
func shouldCleanupSession(ctx context.Context, sessionID string) bool {
	session, err := redisClient.GetSession(ctx, sessionID)
	if err != nil {
		log.Printf("Error checking session %s: %v", sessionID, err)
		return true // Clean up sessions we can't read
	}

	if session == nil {
		return true // Clean up missing sessions
	}

	// Clean up sessions older than 1 hour with no activity
	maxAge := time.Hour
	if time.Since(session.LastActivity) > maxAge {
		log.Printf("Session %s is stale (last activity: %s)", sessionID, session.LastActivity.Format(time.RFC3339))
		return true
	}

	// Clean up failed sessions older than 10 minutes
	if session.Status == "failed" && time.Since(session.CreatedAt) > 10*time.Minute {
		log.Printf("Session %s has been failed for too long", sessionID)
		return true
	}

	// Clean up ending sessions older than 5 minutes (in case cleanup failed)
	if session.Status == "ending" && time.Since(session.LastActivity) > 5*time.Minute {
		log.Printf("Session %s has been ending for too long", sessionID)
		return true
	}

	return false
}

// cleanupSession cleans up a specific session
func cleanupSession(ctx context.Context, sessionID string) error {
	// Stop ECS task if running
	if err := stopECSTaskForSession(sessionID); err != nil {
		log.Printf("Failed to stop ECS task for session %s: %v", sessionID, err)
		// Continue with cleanup even if task stop fails
	}

	// Clean up Redis data
	if err := redisClient.DeleteSession(ctx, sessionID); err != nil {
		return err
	}

	// Clean up connections
	connections, _ := redisClient.GetSessionConnections(ctx, sessionID)
	for _, connectionID := range connections {
		redisClient.DeleteConnection(ctx, connectionID)
		redisClient.RemoveConnectionFromSession(ctx, sessionID, connectionID)
	}

	// Clean up message queues
	redisClient.Del(ctx, "session:"+sessionID+":messages")
	redisClient.Del(ctx, "session:"+sessionID+":connections")
	redisClient.Del(ctx, "session:"+sessionID+":streaming")

	return nil
}

// stopECSTaskForSession stops the ECS task for a session
func stopECSTaskForSession(sessionID string) error {
	// TODO: Implement ECS task stopping logic
	// This should:
	// 1. Get the task ARN from Redis or environment
	// 2. Call ECS StopTask API
	// 3. Handle task already stopped scenarios
	log.Printf("Stopping ECS task for session: %s", sessionID)
	return nil
}

// cleanupOrphanedTasks cleans up ECS tasks that are no longer needed
func cleanupOrphanedTasks(ctx context.Context) (int, error) {
	// TODO: Implement orphaned task cleanup
	// This should:
	// 1. List all running ECS tasks in the cluster
	// 2. Check if each task has an active session in Redis
	// 3. Stop tasks that don't have active sessions
	// 4. Return count of stopped tasks
	log.Printf("Cleaning up orphaned ECS tasks")
	return 0, nil
}
