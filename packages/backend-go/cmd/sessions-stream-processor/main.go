package main

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sns"
	"github.com/aws/aws-sdk-go-v2/service/sns/types"
)

// SessionReadyNotification represents the message sent to SNS
type SessionReadyNotification struct {
	SessionID         string `json:"sessionId"`
	ProjectID         string `json:"projectId"`
	Status            string `json:"status"`
	ConnectURL        string `json:"connectUrl"`
	SeleniumRemoteURL string `json:"seleniumRemoteUrl"`
	PublicIP          string `json:"publicIp"`
	CreatedAt         string `json:"createdAt"`
	ExpiresAt         string `json:"expiresAt"`
	Region            string `json:"region"`
	KeepAlive         bool   `json:"keepAlive"`
}

// Handler processes DynamoDB stream events and publishes session ready notifications
func Handler(ctx context.Context, event events.DynamoDBEvent) error {
	log.Printf("Processing %d DynamoDB stream records", len(event.Records))

	// Get SNS client
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		log.Printf("Error loading AWS config: %v", err)
		return err
	}
	snsClient := sns.NewFromConfig(cfg)

	// Get topic ARN from environment
	topicArn := os.Getenv("SESSION_READY_TOPIC_ARN")
	if topicArn == "" {
		log.Printf("SESSION_READY_TOPIC_ARN not set, skipping SNS notifications")
		return nil
	}

	for _, record := range event.Records {
		// Only process INSERT and MODIFY events
		if record.EventName != "INSERT" && record.EventName != "MODIFY" {
			continue
		}

		// Skip if no new image
		if record.Change.NewImage == nil {
			continue
		}

		// Extract session ID
		sessionIDAttr, ok := record.Change.NewImage["sessionId"]
		if !ok {
			continue
		}
		sessionID := sessionIDAttr.String()

		// Check if this is a status change to READY (internal lifecycle status)
		internalStatusAttr, ok := record.Change.NewImage["internalStatus"]
		if !ok {
			continue
		}
		newStatus := internalStatusAttr.String()

		// For MODIFY events, check if status changed from non-READY to READY
		if record.EventName == "MODIFY" {
			if record.Change.OldImage != nil {
				oldStatus := ""
				if oldInternal, ok := record.Change.OldImage["internalStatus"]; ok {
					oldStatus = oldInternal.String()
				}
				if strings.EqualFold(oldStatus, "READY") {
					// Status was already READY, skip
					continue
				}
			}
		}

		// Only notify for READY status
		if !strings.EqualFold(newStatus, "READY") {
			continue
		}

		log.Printf("Session %s is now READY, sending notification", sessionID)

		// Extract session details from the new image
		notification := SessionReadyNotification{
			SessionID: sessionID,
			Status:    "READY",
		}

		// Extract other fields
		if projectIDAttr, ok := record.Change.NewImage["projectId"]; ok {
			notification.ProjectID = projectIDAttr.String()
		}
		if connectURLAttr, ok := record.Change.NewImage["connectUrl"]; ok {
			notification.ConnectURL = connectURLAttr.String()
		}
		if seleniumURLAttr, ok := record.Change.NewImage["seleniumRemoteUrl"]; ok {
			notification.SeleniumRemoteURL = seleniumURLAttr.String()
		}
		if publicIPAttr, ok := record.Change.NewImage["publicIp"]; ok {
			notification.PublicIP = publicIPAttr.String()
		}
		if createdAtAttr, ok := record.Change.NewImage["createdAt"]; ok {
			notification.CreatedAt = createdAtAttr.String()
		}
		if expiresAtAttr, ok := record.Change.NewImage["expiresAt"]; ok {
			notification.ExpiresAt = expiresAtAttr.String()
		}
		if regionAttr, ok := record.Change.NewImage["region"]; ok {
			notification.Region = regionAttr.String()
		}
		if keepAliveAttr, ok := record.Change.NewImage["keepAlive"]; ok {
			notification.KeepAlive = keepAliveAttr.Boolean()
		}

		// Marshal notification to JSON
		messageBody, err := json.Marshal(notification)
		if err != nil {
			log.Printf("Error marshaling notification: %v", err)
			continue
		}

		// Publish to SNS with session ID as message attribute for filtering
		_, err = snsClient.Publish(ctx, &sns.PublishInput{
			TopicArn: aws.String(topicArn),
			Message:  aws.String(string(messageBody)),
			MessageAttributes: map[string]types.MessageAttributeValue{
				"sessionId": {
					DataType:    aws.String("String"),
					StringValue: aws.String(sessionID),
				},
			},
		})
		if err != nil {
			log.Printf("Error publishing to SNS for session %s: %v", sessionID, err)
			// Continue processing other records
		} else {
			log.Printf("Successfully published session ready notification for %s", sessionID)
		}
	}

	return nil
}

func main() {
	lambda.Start(Handler)
}
