package main

import (
	"context"
	"log"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/wallcrawler/backend-go/internal/types"
	"github.com/wallcrawler/backend-go/internal/utils"
)

// Handler processes scheduled session cleanup events
func Handler(ctx context.Context, event events.CloudWatchEvent) error {
	log.Printf("Starting session cleanup process")

	// Get Redis client
	rdb := utils.GetRedisClient()

	// Get all sessions
	sessions, err := utils.GetAllSessions(ctx, rdb)
	if err != nil {
		log.Printf("Error getting sessions: %v", err)
		return err
	}

	cleanedCount := 0
	errorCount := 0

	for _, session := range sessions {
		// Skip already terminated sessions
		if session.Status == types.SessionStatusStopped ||
			session.Status == types.SessionStatusFailed {
			continue
		}

		// Check if session has timed out (default 5 minutes)
		sessionTimeout := time.Duration(5) * time.Minute

		// Calculate session age
		sessionAge := time.Since(session.CreatedAt)

		if sessionAge > sessionTimeout {
			log.Printf("Session %s has timed out (age: %v, timeout: %v)", session.ID, sessionAge, sessionTimeout)
			utils.LogSessionTimeout(session.ID, session.ProjectID, sessionAge)

			// Update session status to STOPPED
			if err := utils.UpdateSessionStatus(ctx, rdb, session.ID, types.SessionStatusStopped); err != nil {
				log.Printf("Error updating session %s status: %v", session.ID, err)
				utils.LogSessionError(session.ID, session.ProjectID, err, "update_status", nil)
				errorCount++
				continue
			}

			// Stop ECS task if one is running
			if session.ECSTaskARN != "" {
				log.Printf("Stopping ECS task %s for timed out session %s", session.ECSTaskARN, session.ID)
				if err := utils.StopECSTask(ctx, session.ECSTaskARN); err != nil {
					log.Printf("Error stopping ECS task for session %s: %v", session.ID, err)
					utils.LogSessionError(session.ID, session.ProjectID, err, "stop_ecs_task", map[string]interface{}{
						"task_arn": session.ECSTaskARN,
					})
					// Don't increment error count - task might already be stopped
				}
			}

			// Add timeout event to session history
			eventDetail := map[string]interface{}{
				"reason":       "timeout",
				"sessionAge":   sessionAge.String(),
				"timeoutLimit": sessionTimeout.String(),
				"source":       "session-cleanup",
			}

			if err := utils.AddSessionEvent(ctx, rdb, session.ID, "SessionTimedOut", "wallcrawler.session-cleanup", eventDetail); err != nil {
				log.Printf("Error adding timeout event for session %s: %v", session.ID, err)
			}

			// Log successful termination
			utils.LogSessionTerminated(session.ID, session.ProjectID, "timeout", sessionAge.Milliseconds(), map[string]interface{}{
				"timeout_minutes": sessionTimeout.Minutes(),
			})
			cleanedCount++
		}
	}

	log.Printf("Session cleanup completed: %d sessions timed out, %d errors", cleanedCount, errorCount)

	if errorCount > 0 {
		log.Printf("WARNING: %d errors occurred during cleanup", errorCount)
	}

	return nil
}

func main() {
	lambda.Start(Handler)
}
