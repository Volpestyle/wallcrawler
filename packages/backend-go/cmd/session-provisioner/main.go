package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/redis/go-redis/v9"
	"github.com/wallcrawler/backend-go/internal/types"
	"github.com/wallcrawler/backend-go/internal/utils"
)

// EventBridgeEvent represents an EventBridge event
type EventBridgeEvent struct {
	Version    string                 `json:"version"`
	ID         string                 `json:"id"`
	DetailType string                 `json:"detail-type"`
	Source     string                 `json:"source"`
	Account    string                 `json:"account"`
	Time       time.Time              `json:"time"`
	Region     string                 `json:"region"`
	Detail     map[string]interface{} `json:"detail"`
	Resources  []string               `json:"resources"`
}

// Handler processes EventBridge events for session lifecycle management
func Handler(ctx context.Context, event EventBridgeEvent) error {
	log.Printf("Received EventBridge event: %s from %s", event.DetailType, event.Source)

	switch event.DetailType {
	case "SessionCreateRequested":
		return handleSessionCreateRequested(ctx, event)
	case "SessionTerminationRequested":
		return handleSessionTerminationRequested(ctx, event)
	case "SessionCreateFailed":
		return handleSessionCreateFailed(ctx, event)
	default:
		log.Printf("Unknown event type: %s", event.DetailType)
		return nil
	}
}

// handleSessionCreateRequested processes session creation requests
func handleSessionCreateRequested(ctx context.Context, event EventBridgeEvent) error {
	sessionID, ok := event.Detail["sessionId"].(string)
	if !ok {
		return fmt.Errorf("missing sessionId in event detail")
	}

	log.Printf("Processing session creation for %s", sessionID)

	// Get Redis client
	rdb := utils.GetRedisClient()

	// Update session status to PROVISIONING
	if err := utils.UpdateSessionStatus(ctx, rdb, sessionID, types.SessionStatusProvisioning); err != nil {
		log.Printf("Error updating session status to provisioning: %v", err)
		return err
	}

	// Get session state
	sessionState, err := utils.GetSession(ctx, rdb, sessionID)
	if err != nil {
		log.Printf("Error getting session %s: %v", sessionID, err)
		return err
	}

	// Create ECS task for browser automation
	taskARN, err := utils.CreateECSTask(ctx, sessionID, sessionState)
	if err != nil {
		log.Printf("Error creating ECS task for session %s: %v", sessionID, err)

		// Mark session as failed and add retry logic
		if err := handleProvisioningFailure(ctx, rdb, sessionID, err); err != nil {
			log.Printf("Error handling provisioning failure: %v", err)
		}
		return err
	}

	// Update session with task ARN
	sessionState.ECSTaskARN = taskARN
	sessionState.UpdatedAt = time.Now()
	if err := utils.StoreSession(ctx, rdb, sessionState); err != nil {
		log.Printf("Error storing session with task ARN: %v", err)
	}

	// Add provisioning started event
	provisioningEvent := map[string]interface{}{
		"sessionId": sessionID,
		"taskArn":   taskARN,
		"step":      "ecs_task_created",
	}
	if err := utils.AddSessionEvent(ctx, rdb, sessionID, "SessionProvisioning", "wallcrawler.session-provisioner", provisioningEvent); err != nil {
		log.Printf("Error adding provisioning event: %v", err)
	}

	// Start async task monitoring
	go monitorTaskStartup(sessionID, taskARN)

	log.Printf("Session %s provisioning started with task %s", sessionID, taskARN)
	return nil
}

// handleSessionTerminationRequested processes session termination requests
func handleSessionTerminationRequested(ctx context.Context, event EventBridgeEvent) error {
	sessionID, ok := event.Detail["sessionId"].(string)
	if !ok {
		return fmt.Errorf("missing sessionId in event detail")
	}

	log.Printf("Processing session termination for %s", sessionID)

	// Get Redis client
	rdb := utils.GetRedisClient()

	// Get session state
	sessionState, err := utils.GetSession(ctx, rdb, sessionID)
	if err != nil {
		log.Printf("Error getting session %s: %v", sessionID, err)
		return err
	}

	// Check if session is already terminated
	if utils.IsSessionTerminal(sessionState.Status) {
		log.Printf("Session %s is already in terminal state: %s", sessionID, sessionState.Status)
		return nil
	}

	// Stop ECS task if it exists
	if sessionState.ECSTaskARN != "" {
		if err := utils.StopECSTask(ctx, sessionState.ECSTaskARN); err != nil {
			log.Printf("Error stopping ECS task %s: %v", sessionState.ECSTaskARN, err)
			// Continue with termination even if ECS task stop fails
		} else {
			log.Printf("Stopped ECS task %s for session %s", sessionState.ECSTaskARN, sessionID)
		}
	}

	// Mark session as stopped and set ended timestamp
	now := time.Now()
	sessionState.Status = types.SessionStatusStopped
	sessionState.TerminatedAt = &now
	sessionState.UpdatedAt = now

	// Store updated session state
	if err := utils.StoreSession(ctx, rdb, sessionState); err != nil {
		log.Printf("Error storing terminated session state: %v", err)
		return err
	}

	// Add termination completed event
	terminationEvent := map[string]interface{}{
		"sessionId":   sessionID,
		"taskArn":     sessionState.ECSTaskARN,
		"reason":      event.Detail["reason"],
		"completedAt": now.Unix(),
		"finalStatus": types.SessionStatusStopped,
	}
	if err := utils.AddSessionEvent(ctx, rdb, sessionID, "SessionTerminationCompleted", "wallcrawler.session-provisioner", terminationEvent); err != nil {
		log.Printf("Error adding termination completed event: %v", err)
	}

	log.Printf("Session %s termination completed successfully", sessionID)
	return nil
}

// handleSessionCreateFailed processes failed session creation with retry logic
func handleSessionCreateFailed(ctx context.Context, event EventBridgeEvent) error {
	sessionID, ok := event.Detail["sessionId"].(string)
	if !ok {
		return fmt.Errorf("missing sessionId in event detail")
	}

	log.Printf("Processing session creation failure for %s", sessionID)

	// Get Redis client
	rdb := utils.GetRedisClient()

	// Increment retry count
	if err := utils.IncrementSessionRetryCount(ctx, rdb, sessionID); err != nil {
		log.Printf("Error incrementing retry count: %v", err)
		return err
	}

	// Get updated session state
	sessionState, err := utils.GetSession(ctx, rdb, sessionID)
	if err != nil {
		log.Printf("Error getting session %s: %v", sessionID, err)
		return err
	}

	// Check if we should retry (max 3 retries)
	maxRetries := 3
	if sessionState.RetryCount <= maxRetries {
		log.Printf("Retrying session creation for %s (attempt %d/%d)", sessionID, sessionState.RetryCount, maxRetries)

		// Wait before retry (exponential backoff)
		retryDelay := time.Duration(sessionState.RetryCount*sessionState.RetryCount) * time.Second
		time.Sleep(retryDelay)

		// Retry session creation
		return handleSessionCreateRequested(ctx, event)
	}

	// Max retries exceeded, mark as failed
	log.Printf("Max retries exceeded for session %s, marking as failed", sessionID)
	if err := utils.UpdateSessionStatus(ctx, rdb, sessionID, types.SessionStatusFailed); err != nil {
		log.Printf("Error updating session status to failed: %v", err)
	}

	return nil
}

// handleProvisioningFailure handles ECS task creation failures
func handleProvisioningFailure(ctx context.Context, rdb *redis.Client, sessionID string, provisioningErr error) error {
	// Add failure event
	failureEvent := map[string]interface{}{
		"sessionId": sessionID,
		"error":     provisioningErr.Error(),
		"step":      "ecs_task_creation",
	}

	if err := utils.AddSessionEvent(ctx, rdb, sessionID, "SessionCreateFailed", "wallcrawler.session-provisioner", failureEvent); err != nil {
		return err
	}

	return nil
}

// monitorTaskStartup monitors ECS task startup and updates session when ready
func monitorTaskStartup(sessionID, taskARN string) {
	ctx := context.Background()
	rdb := utils.GetRedisClient()

	// Wait for task to get a public IP (up to 5 minutes)
	for i := 0; i < 300; i++ {
		taskIP, err := utils.GetECSTaskPublicIP(ctx, taskARN)
		if err == nil && taskIP != "" {
			// Update session with connect URL
			sessionState, err := utils.GetSession(ctx, rdb, sessionID)
			if err != nil {
				log.Printf("Error getting session during IP update: %v", err)
				return
			}

			connectURL := utils.CreateCDPURL(taskIP)
			sessionState.ConnectURL = connectURL
			sessionState.PublicIP = taskIP
			sessionState.UpdatedAt = time.Now()

			if err := utils.StoreSession(ctx, rdb, sessionState); err != nil {
				log.Printf("Error storing session with connect URL: %v", err)
				return
			}

			// Update status to STARTING
			if err := utils.UpdateSessionStatus(ctx, rdb, sessionID, types.SessionStatusStarting); err != nil {
				log.Printf("Error updating session status to starting: %v", err)
			}

			// Add IP assigned event
			ipEvent := map[string]interface{}{
				"sessionId":  sessionID,
				"taskArn":    taskARN,
				"publicIP":   taskIP,
				"connectUrl": connectURL,
			}
			if err := utils.AddSessionEvent(ctx, rdb, sessionID, "SessionIPAssigned", "wallcrawler.session-provisioner", ipEvent); err != nil {
				log.Printf("Error adding IP assigned event: %v", err)
			}

			log.Printf("Session %s got IP %s, connect URL: %s", sessionID, taskIP, connectURL)
			return
		}

		time.Sleep(1 * time.Second)
	}

	// Timeout waiting for IP
	log.Printf("Timeout waiting for IP for session %s task %s", sessionID, taskARN)

	// Mark as failed
	failureEvent := map[string]interface{}{
		"sessionId": sessionID,
		"taskArn":   taskARN,
		"error":     "Timeout waiting for task IP assignment",
		"step":      "ip_assignment",
	}

	if err := utils.AddSessionEvent(ctx, rdb, sessionID, "SessionCreateFailed", "wallcrawler.session-provisioner", failureEvent); err != nil {
		log.Printf("Error adding IP timeout failure event: %v", err)
	}
}

func main() {
	lambda.Start(Handler)
}
