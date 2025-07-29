package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/aws/aws-lambda-go/lambda"
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
	case "ECS Task State Change":
		return handleECSTaskStateChange(ctx, event)
	case "SessionTerminated":
		return handleSessionTerminated(ctx, event)
	case "SessionTimedOut":
		return handleSessionTimedOut(ctx, event)
	default:
		log.Printf("Unknown event type: %s, ignoring", event.DetailType)
		return nil
	}
}

// extractSessionIDFromECSEvent extracts session ID from ECS task event overrides
func extractSessionIDFromECSEvent(detail map[string]interface{}) string {
	overrides, ok := detail["overrides"].(map[string]interface{})
	if !ok {
		return ""
	}

	containerOverrides, ok := overrides["containerOverrides"].([]interface{})
	if !ok {
		return ""
	}

	for _, override := range containerOverrides {
		containerOverride, ok := override.(map[string]interface{})
		if !ok {
			continue
		}

		environment, ok := containerOverride["environment"].([]interface{})
		if !ok {
			continue
		}

		for _, env := range environment {
			envVar, ok := env.(map[string]interface{})
			if !ok {
				continue
			}

			name, ok := envVar["name"].(string)
			if !ok || name != "SESSION_ID" {
				continue
			}

			value, ok := envVar["value"].(string)
			if ok {
				return value
			}
		}
	}

	return ""
}

// extractENIFromEvent extracts the ENI ID from ECS task EventBridge event
func extractENIFromEvent(detail map[string]interface{}) string {
	attachments, ok := detail["attachments"].([]interface{})
	if !ok {
		return ""
	}

	for _, attachment := range attachments {
		attachmentData, ok := attachment.(map[string]interface{})
		if !ok {
			continue
		}

		// Check if this is an ENI attachment
		attachmentType, ok := attachmentData["type"].(string)
		if !ok || attachmentType != "eni" {
			continue
		}

		// Look for networkInterfaceId in the details
		details, ok := attachmentData["details"].([]interface{})
		if !ok {
			continue
		}

		for _, detail := range details {
			detailData, ok := detail.(map[string]interface{})
			if !ok {
				continue
			}

			name, ok := detailData["name"].(string)
			if !ok || name != "networkInterfaceId" {
				continue
			}

			value, ok := detailData["value"].(string)
			if ok {
				return value
			}
		}
	}

	return ""
}

// handleECSTaskStateChange processes ECS task state changes from EventBridge
func handleECSTaskStateChange(ctx context.Context, event EventBridgeEvent) error {
	log.Printf("Processing ECS task state change event")

	// Extract task details from the event
	taskArn, ok := event.Detail["taskArn"].(string)
	if !ok {
		log.Printf("No taskArn found in ECS event, skipping")
		return nil
	}

	lastStatus, ok := event.Detail["lastStatus"].(string)
	if !ok || lastStatus != "RUNNING" {
		log.Printf("Task not in RUNNING state (%s), skipping", lastStatus)
		return nil
	}

	// Extract session ID from task overrides
	sessionID := extractSessionIDFromECSEvent(event.Detail)
	if sessionID == "" {
		log.Printf("No session ID found in ECS task event, skipping")
		return nil
	}

	log.Printf("Processing ECS task RUNNING event for session %s, task %s", sessionID, taskArn)

	// Get Redis client
	rdb := utils.GetRedisClient()

	// Get current session state
	sessionState, err := utils.GetSession(ctx, rdb, sessionID)
	if err != nil {
		log.Printf("Error getting session %s: %v", sessionID, err)
		return nil
	}

	// 🔥 OPTIMIZATION: Extract ENI ID directly from EventBridge event (no API call!)
	eniID := extractENIFromEvent(event.Detail)
	var taskIP string

	if eniID != "" {
		log.Printf("Found ENI ID %s in EventBridge event for task %s", eniID, taskArn)
		// Get public IP directly from ENI (1 API call instead of 2!)
		taskIP, err = utils.GetENIPublicIP(ctx, eniID)
		if err != nil {
			log.Printf("Error getting IP from ENI %s: %v", eniID, err)
		}
	}

	// Fallback: Use original method if ENI extraction failed
	if taskIP == "" {
		log.Printf("Falling back to task description for IP lookup")
		taskIP, err = utils.GetECSTaskPublicIP(ctx, taskArn)
		if err != nil {
			log.Printf("Error getting IP for task %s: %v", taskArn, err)
			return nil
		}
	}

	if taskIP == "" {
		log.Printf("No IP address available for task %s yet", taskArn)
		return nil
	}

	log.Printf("Successfully obtained task IP %s for session %s", taskIP, sessionID)

	// Update session with task information
	sessionState.PublicIP = taskIP
	sessionState.ECSTaskARN = taskArn

	// Generate connect URL if we have a signing key
	if sessionState.SigningKey != "" {
		connectURL := utils.CreateAuthenticatedCDPURL(taskIP, sessionState.SigningKey)
		sessionState.ConnectURL = connectURL
		log.Printf("Updated session %s with IP %s and connect URL", sessionID, taskIP)
	} else {
		log.Printf("No signing key available for session %s", sessionID)
	}

	sessionState.UpdatedAt = time.Now()

	// Update status to READY
	if err := utils.UpdateSessionStatus(ctx, rdb, sessionID, types.SessionStatusReady); err != nil {
		log.Printf("Error updating session status to READY: %v", err)
	}

	// Store updated session
	if err := utils.StoreSession(ctx, rdb, sessionState); err != nil {
		log.Printf("Error storing updated session: %v", err)
		return err
	}

	// 🔥 Notify waiting session creation lambda via Redis Pub/Sub (instant!)
	channel := fmt.Sprintf("session:%s:ready", sessionID)
	err = rdb.Publish(ctx, channel, "ready").Err()
	if err != nil {
		log.Printf("Error publishing session ready notification: %v", err)
	} else {
		log.Printf("Published session ready notification to channel %s", channel)
	}

	// Log ECS task ready event
	utils.LogECSTaskEvent(sessionID, taskArn, "RUNNING", map[string]interface{}{
		"public_ip": taskIP,
		"eni_id":    eniID,
	})

	log.Printf("Successfully processed ECS task state change for session %s with IP %s", sessionID, taskIP)
	return nil
}

// handleSessionTerminated processes manual session termination events
func handleSessionTerminated(ctx context.Context, event EventBridgeEvent) error {
	log.Printf("Processing SessionTerminated event")
	
	sessionID, ok := event.Detail["sessionId"].(string)
	if !ok {
		log.Printf("No sessionId found in SessionTerminated event")
		return nil
	}

	// Additional cleanup logic if needed (e.g., metrics, notifications)
	log.Printf("Session %s was manually terminated", sessionID)
	return nil
}

// handleSessionTimedOut processes automatic session timeout events
func handleSessionTimedOut(ctx context.Context, event EventBridgeEvent) error {
	log.Printf("Processing SessionTimedOut event")
	
	sessionID, ok := event.Detail["sessionId"].(string)
	if !ok {
		log.Printf("No sessionId found in SessionTimedOut event")
		return nil
	}

	// Additional cleanup logic if needed (e.g., metrics, alerts)
	log.Printf("Session %s timed out automatically", sessionID)
	return nil
}

func main() {
	lambda.Start(Handler)
}
