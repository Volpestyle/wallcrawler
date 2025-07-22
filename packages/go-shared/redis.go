package shared

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// RedisClient wraps the Redis client with additional utilities
type RedisClient struct {
	*redis.Client
}

// NewRedisClient creates a new Redis client with standard configuration
func NewRedisClient() *RedisClient {
	rdb := redis.NewClient(&redis.Options{
		Addr:     fmt.Sprintf("%s:6379", GetRedisEndpoint()),
		Password: GetRedisPassword(),
		DB:       0,
	})

	return &RedisClient{Client: rdb}
}

// NewRedisClientWithOptions creates a new Redis client with custom options
func NewRedisClientWithOptions(addr, password string, db int) *RedisClient {
	rdb := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: password,
		DB:       db,
	})

	return &RedisClient{Client: rdb}
}

// Session Management

// StoreSession stores session data in Redis
func (r *RedisClient) StoreSession(ctx context.Context, sessionID string, session *Session) error {
	sessionData := map[string]interface{}{
		"id":           session.ID,
		"userId":       session.UserID,
		"status":       session.Status,
		"createdAt":    FormatTime(session.CreatedAt),
		"lastActivity": FormatTime(session.LastActivity),
		"options":      mustMarshal(session.Options),
	}

	return r.HSet(ctx, fmt.Sprintf("session:%s", sessionID), sessionData).Err()
}

// GetSession retrieves session data from Redis
func (r *RedisClient) GetSession(ctx context.Context, sessionID string) (*Session, error) {
	sessionData, err := r.HGetAll(ctx, fmt.Sprintf("session:%s", sessionID)).Result()
	if err != nil {
		return nil, err
	}

	if len(sessionData) == 0 {
		return nil, fmt.Errorf("session not found")
	}

	var session Session
	session.ID = sessionData["id"]
	session.UserID = sessionData["userId"]
	session.Status = sessionData["status"]

	if createdAt, err := ParseTime(sessionData["createdAt"]); err == nil {
		session.CreatedAt = createdAt
	}

	if lastActivity, err := ParseTime(sessionData["lastActivity"]); err == nil {
		session.LastActivity = lastActivity
	}

	if optionsData, ok := sessionData["options"]; ok && optionsData != "" {
		json.Unmarshal([]byte(optionsData), &session.Options)
	}

	return &session, nil
}

// UpdateSessionActivity updates the last activity timestamp for a session
func (r *RedisClient) UpdateSessionActivity(ctx context.Context, sessionID string) error {
	return r.HSet(ctx, fmt.Sprintf("session:%s", sessionID), "lastActivity", FormatNow()).Err()
}

// DeleteSession removes session data from Redis
func (r *RedisClient) DeleteSession(ctx context.Context, sessionID string) error {
	return r.Del(ctx, fmt.Sprintf("session:%s", sessionID)).Err()
}

// SetSessionTTL sets TTL for a session
func (r *RedisClient) SetSessionTTL(ctx context.Context, sessionID string, ttl time.Duration) error {
	return r.Expire(ctx, fmt.Sprintf("session:%s", sessionID), ttl).Err()
}

// Connection Management

// StoreConnection stores WebSocket connection mapping
func (r *RedisClient) StoreConnection(ctx context.Context, connectionID string, mapping *ConnectionMapping) error {
	mappingJSON := mustMarshal(mapping)
	return r.SetEx(ctx, fmt.Sprintf("connection:%s", connectionID), mappingJSON, time.Hour).Err()
}

// GetConnection retrieves WebSocket connection mapping
func (r *RedisClient) GetConnection(ctx context.Context, connectionID string) (*ConnectionMapping, error) {
	connectionData, err := r.Get(ctx, fmt.Sprintf("connection:%s", connectionID)).Result()
	if err != nil {
		return nil, err
	}

	var mapping ConnectionMapping
	if err := json.Unmarshal([]byte(connectionData), &mapping); err != nil {
		return nil, err
	}

	return &mapping, nil
}

// AddConnectionToSession adds a connection to a session's connection set
func (r *RedisClient) AddConnectionToSession(ctx context.Context, sessionID, connectionID string) error {
	if err := r.SAdd(ctx, fmt.Sprintf("session:%s:connections", sessionID), connectionID).Err(); err != nil {
		return err
	}
	return r.Expire(ctx, fmt.Sprintf("session:%s:connections", sessionID), time.Hour).Err()
}

// RemoveConnectionFromSession removes a connection from a session's connection set
func (r *RedisClient) RemoveConnectionFromSession(ctx context.Context, sessionID, connectionID string) error {
	return r.SRem(ctx, fmt.Sprintf("session:%s:connections", sessionID), connectionID).Err()
}

// GetSessionConnections gets all connections for a session
func (r *RedisClient) GetSessionConnections(ctx context.Context, sessionID string) ([]string, error) {
	return r.SMembers(ctx, fmt.Sprintf("session:%s:connections", sessionID)).Result()
}

// DeleteConnection removes connection mapping
func (r *RedisClient) DeleteConnection(ctx context.Context, connectionID string) error {
	return r.Del(ctx, fmt.Sprintf("connection:%s", connectionID)).Err()
}

// Message Queue Management

// PushMessage pushes a message to a session's message queue
func (r *RedisClient) PushMessage(ctx context.Context, sessionID string, message interface{}) error {
	messageJSON := mustMarshal(message)
	if err := r.LPush(ctx, fmt.Sprintf("session:%s:messages", sessionID), messageJSON).Err(); err != nil {
		return err
	}
	return r.Expire(ctx, fmt.Sprintf("session:%s:messages", sessionID), time.Hour).Err()
}

// PopMessage pops a message from a session's message queue
func (r *RedisClient) PopMessage(ctx context.Context, sessionID string) (string, error) {
	return r.RPop(ctx, fmt.Sprintf("session:%s:messages", sessionID)).Result()
}

// GetQueueLength gets the length of a session's message queue
func (r *RedisClient) GetQueueLength(ctx context.Context, sessionID string) (int64, error) {
	return r.LLen(ctx, fmt.Sprintf("session:%s:messages", sessionID)).Result()
}

// Pending Sessions Management

// AddToPendingQueue adds a session to the pending queue
func (r *RedisClient) AddToPendingQueue(ctx context.Context, sessionID string) error {
	return r.LPush(ctx, "pending-sessions", sessionID).Err()
}

// PopFromPendingQueue pops a session from the pending queue
func (r *RedisClient) PopFromPendingQueue(ctx context.Context) (string, error) {
	return r.RPop(ctx, "pending-sessions").Result()
}

// GetPendingQueueLength gets the length of the pending sessions queue
func (r *RedisClient) GetPendingQueueLength(ctx context.Context) (int64, error) {
	return r.LLen(ctx, "pending-sessions").Result()
}

// Container Health Management

// StoreContainerHealth stores container health information
func (r *RedisClient) StoreContainerHealth(ctx context.Context, containerID string, health interface{}) error {
	healthJSON := mustMarshal(health)
	return r.SetEx(ctx, fmt.Sprintf("container:%s:health", containerID), healthJSON, 60*time.Second).Err()
}

// GetContainerHealth retrieves container health information
func (r *RedisClient) GetContainerHealth(ctx context.Context, containerID string) (map[string]interface{}, error) {
	healthData, err := r.Get(ctx, fmt.Sprintf("container:%s:health", containerID)).Result()
	if err != nil {
		return nil, err
	}

	var health map[string]interface{}
	if err := json.Unmarshal([]byte(healthData), &health); err != nil {
		return nil, err
	}

	return health, nil
}

// Screencast Management

// SetupScreencastStreaming marks a connection for screencast streaming
func (r *RedisClient) SetupScreencastStreaming(ctx context.Context, sessionID, connectionID string) error {
	streamingData := map[string]interface{}{
		"type":         "screencast",
		"sessionId":    sessionID,
		"connectionId": connectionID,
		"startedAt":    FormatNow(),
	}

	streamingJSON := mustMarshal(streamingData)

	// Store streaming data with TTL
	if err := r.SetEx(ctx, fmt.Sprintf("streaming:%s", connectionID), streamingJSON, 30*time.Minute).Err(); err != nil {
		return err
	}

	// Add to session's streaming connections
	if err := r.SAdd(ctx, fmt.Sprintf("session:%s:streaming", sessionID), connectionID).Err(); err != nil {
		return err
	}

	return r.Expire(ctx, fmt.Sprintf("session:%s:streaming", sessionID), 30*time.Minute).Err()
}

// RemoveScreencastStreaming removes screencast streaming setup
func (r *RedisClient) RemoveScreencastStreaming(ctx context.Context, sessionID, connectionID string) error {
	r.Del(ctx, fmt.Sprintf("streaming:%s", connectionID))
	return r.SRem(ctx, fmt.Sprintf("session:%s:streaming", sessionID), connectionID).Err()
}

// Utility functions

// mustMarshal marshals to JSON and panics on error (for internal use)
func mustMarshal(v interface{}) string {
	data, err := json.Marshal(v)
	if err != nil {
		panic(fmt.Sprintf("failed to marshal JSON: %v", err))
	}
	return string(data)
}

// HealthCheck checks if Redis is healthy
func (r *RedisClient) HealthCheck(ctx context.Context) error {
	return r.Ping(ctx).Err()
} 