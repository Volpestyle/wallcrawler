package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
)

// Environment configuration
var (
	Port              = getEnvInt("PORT", 8080)
	CDPPort           = getEnvInt("CDP_PORT", 9222)
	ContainerID       = getEnv("CONTAINER_ID", fmt.Sprintf("container-%d", time.Now().Unix()))
	MaxSessions       = getEnvInt("MAX_SESSIONS", 20)
	RedisEndpoint     = getEnvRequired("REDIS_ENDPOINT")
	S3Bucket          = getEnvRequired("S3_BUCKET")
	ProxyEndpoint     = getEnv("PROXY_ENDPOINT", "http://localhost:3001")
	JWESecret         = ""
)

// Session represents a browser session
type Session struct {
	ID           string                 `json:"id"`
	UserID       string                 `json:"userId"`
	Context      context.Context        `json:"-"`
	Cancel       context.CancelFunc     `json:"-"`
	LastActivity time.Time              `json:"lastActivity"`
	Options      SessionOptions         `json:"options"`
	Pages        map[string]interface{} `json:"-"` // chromedp doesn't expose pages directly
}

// SessionOptions represents browser session configuration
type SessionOptions struct {
	Viewport     *Viewport             `json:"viewport,omitempty"`
	UserAgent    string                `json:"userAgent,omitempty"`
	Locale       string                `json:"locale,omitempty"`
	TimezoneID   string                `json:"timezoneId,omitempty"`
	ExtraHeaders map[string]string     `json:"extraHTTPHeaders,omitempty"`
}

// Viewport represents browser viewport settings
type Viewport struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

// MultiSessionContainer manages multiple browser contexts
type MultiSessionContainer struct {
	sessions         map[string]*Session
	sessionsMutex    sync.RWMutex
	screencastMgr    *ScreencastManager
	httpServer       *http.Server
	wsUpgrader       websocket.Upgrader
	redisClient      *redis.Client
	sessionWS        map[string]*websocket.Conn
	sessionWSMutex   sync.RWMutex
	proxyConnection  *websocket.Conn
	proxyMutex       sync.Mutex
	cleanupTicker    *time.Ticker
	healthTicker     *time.Ticker
}

// ClientMessage represents incoming CDP messages
type ClientMessage struct {
	ID       int                    `json:"id"`
	Method   string                 `json:"method,omitempty"`
	Params   map[string]interface{} `json:"params,omitempty"`
	TargetID string                 `json:"targetId,omitempty"`
}

// InternalMessage represents internal container messages
type InternalMessage struct {
	Type      string                 `json:"type"`
	SessionID string                 `json:"sessionId,omitempty"`
	UserID    string                 `json:"userId,omitempty"`
	Options   *SessionOptions        `json:"options,omitempty"`
	Data      map[string]interface{} `json:"data,omitempty"`
	Event     *InputEvent            `json:"event,omitempty"`
	Params    map[string]interface{} `json:"params,omitempty"`
}

// InputEvent represents user input events
type InputEvent struct {
	Type       string  `json:"type"`
	Timestamp  int64   `json:"timestamp"`
	X          float64 `json:"x,omitempty"`
	Y          float64 `json:"y,omitempty"`
	Button     string  `json:"button,omitempty"`
	ClickCount int     `json:"clickCount,omitempty"`
	Key        string  `json:"key,omitempty"`
	Code       string  `json:"code,omitempty"`
	Text       string  `json:"text,omitempty"`
}

// NewMultiSessionContainer creates a new container instance
func NewMultiSessionContainer() *MultiSessionContainer {
	return &MultiSessionContainer{
		sessions:      make(map[string]*Session),
		sessionWS:     make(map[string]*websocket.Conn),
		screencastMgr: NewScreencastManager(),
		wsUpgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true // Allow all origins in container
			},
		},
		redisClient: redis.NewClient(&redis.Options{
			Addr:     fmt.Sprintf("%s:6379", RedisEndpoint),
			Password: os.Getenv("REDIS_PASSWORD"),
			DB:       0,
		}),
	}
}

// Start initializes and starts the container
func (c *MultiSessionContainer) Start() error {
	// Test Redis connection
	ctx := context.Background()
	if err := c.redisClient.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("failed to connect to Redis: %w", err)
	}

	// Set up HTTP routes
	mux := http.NewServeMux()
	mux.HandleFunc("/health", c.handleHealth)
	mux.HandleFunc("/internal/ws", c.handleWebSocket)
	mux.HandleFunc("/cdp", c.handleCDPWebSocket)
	mux.HandleFunc("/sessions/{id}/start-screencast", c.handleStartScreencast)
	mux.HandleFunc("/sessions/{id}/stop-screencast", c.handleStopScreencast)

	c.httpServer = &http.Server{
		Addr:    fmt.Sprintf(":%d", Port),
		Handler: mux,
	}

	// Start HTTP server
	go func() {
		log.Printf("🚀 Multi-Session Container started on port %d", Port)
		log.Printf("Container ID: %s", ContainerID)
		log.Printf("Max Sessions: %d", MaxSessions)
		if err := c.httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP server failed: %v", err)
		}
	}()

	// Register with proxy
	if err := c.registerWithProxy(); err != nil {
		log.Printf("Failed to register with proxy: %v", err)
	}

	// Start cleanup routine
	c.startCleanupRoutine()

	// Start health reporting
	c.startHealthReporting()

	// Wait for shutdown signal
	c.waitForShutdown()

	return nil
}

// handleHealth returns container health status
func (c *MultiSessionContainer) handleHealth(w http.ResponseWriter, r *http.Request) {
	c.sessionsMutex.RLock()
	sessionCount := len(c.sessions)
	c.sessionsMutex.RUnlock()

	health := map[string]interface{}{
		"status":      "healthy",
		"sessions":    sessionCount,
		"maxSessions": MaxSessions,
		"containerId": ContainerID,
		"timestamp":   time.Now().Unix(),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(health)
}

// handleWebSocket handles internal WebSocket connections
func (c *MultiSessionContainer) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := c.wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	// Check if this is a direct client connection or proxy
	token := extractToken(r.URL.RawQuery, r.Header)
	if token != "" {
		// Direct client connection - validate JWT
		sessionID, err := c.validateToken(token)
		if err != nil {
			log.Printf("JWT validation failed: %v", err)
			conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(1008, "Invalid token"))
			return
		}

		c.sessionWSMutex.Lock()
		c.sessionWS[sessionID] = conn
		c.sessionWSMutex.Unlock()

		log.Printf("Direct client connected for session: %s", sessionID)

		// Send connection established message
		c.sendMessage(conn, map[string]interface{}{
			"type":      "CONNECTION_ESTABLISHED",
			"sessionId": sessionID,
			"timestamp": time.Now().Format(time.RFC3339),
		})

		// Handle messages for this session
		c.handleSessionMessages(conn, sessionID)
	} else {
		// Proxy connection
		c.proxyMutex.Lock()
		c.proxyConnection = conn
		c.proxyMutex.Unlock()

		log.Println("Proxy connected")
		c.handleProxyMessages(conn)
	}
}

// handleSessionMessages handles messages for a specific session
func (c *MultiSessionContainer) handleSessionMessages(conn *websocket.Conn, sessionID string) {
	defer func() {
		c.sessionWSMutex.Lock()
		delete(c.sessionWS, sessionID)
		c.sessionWSMutex.Unlock()

		// Stop screencast if active
		c.screencastMgr.StopScreencast(sessionID)
	}()

	for {
		_, messageBytes, err := conn.ReadMessage()
		if err != nil {
			log.Printf("WebSocket read error for session %s: %v", sessionID, err)
			break
		}

		var msg InternalMessage
		if err := json.Unmarshal(messageBytes, &msg); err != nil {
			log.Printf("Failed to parse message: %v", err)
			continue
		}

		c.handleInternalMessage(conn, &msg)
	}
}

// handleProxyMessages handles messages from the proxy connection
func (c *MultiSessionContainer) handleProxyMessages(conn *websocket.Conn) {
	defer func() {
		c.proxyMutex.Lock()
		c.proxyConnection = nil
		c.proxyMutex.Unlock()
		log.Println("Proxy disconnected")
	}()

	for {
		_, messageBytes, err := conn.ReadMessage()
		if err != nil {
			log.Printf("Proxy WebSocket read error: %v", err)
			break
		}

		var msg InternalMessage
		if err := json.Unmarshal(messageBytes, &msg); err != nil {
			log.Printf("Failed to parse proxy message: %v", err)
			continue
		}

		c.handleInternalMessage(conn, &msg)
	}
}

// Utility functions
func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if i, err := strconv.Atoi(value); err == nil {
			return i
		}
	}
	return defaultValue
}

func getEnvRequired(key string) string {
	value := os.Getenv(key)
	if value == "" {
		log.Fatalf("Required environment variable %s not set", key)
	}
	return value
}

func extractToken(query string, headers http.Header) string {
	// Try URL query parameters first
	if token := extractFromQuery(query, "token"); token != "" {
		return token
	}

	// Try Authorization header
	if auth := headers.Get("Authorization"); auth != "" {
		if len(auth) > 7 && auth[:7] == "Bearer " {
			return auth[7:]
		}
	}

	return ""
}

func extractFromQuery(query, key string) string {
	// Simple query parameter extraction
	params := make(map[string]string)
	if query == "" {
		return ""
	}
	
	pairs := strings.Split(query, "&")
	for _, pair := range pairs {
		kv := strings.Split(pair, "=")
		if len(kv) == 2 {
			params[kv[0]] = kv[1]
		}
	}
	
	return params[key]
}

func main() {
	container := NewMultiSessionContainer()
	if err := container.Start(); err != nil {
		log.Fatalf("Failed to start container: %v", err)
	}
} 