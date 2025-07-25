package util

import (
	"context"

	"github.com/redis/go-redis/v9"
)

func UpdateState(client *redis.Client, sessionID, state string) error {
	return client.HSet(context.Background(), "session:"+sessionID, "state", state).Err()
}

func StoreScript(client *redis.Client, sessionID, script string) error {
	return client.HSet(context.Background(), "session:"+sessionID, "script", script).Err()
}

func StoreCdpEndpoint(client *redis.Client, sessionID, endpoint string) error {
	return client.HSet(context.Background(), "session:"+sessionID, "cdpEndpoint", endpoint).Err()
} 