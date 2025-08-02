package utils

import (
	"context"
	"fmt"
	"log"

	"github.com/redis/go-redis/v9"
)

// PublishSessionReady publishes a Redis pub/sub event when a session becomes ready
func PublishSessionReady(ctx context.Context, rdb *redis.Client, sessionID string) error {
	channel := fmt.Sprintf("session:%s:ready", sessionID)
	message := fmt.Sprintf("Session %s is ready", sessionID)

	err := rdb.Publish(ctx, channel, message).Err()
	if err != nil {
		log.Printf("Error publishing session ready event: %v", err)
		return err
	}

	log.Printf("Published session ready event for %s to channel %s", sessionID, channel)
	return nil
}
