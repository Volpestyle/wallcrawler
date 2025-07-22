package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"

	"syscall"
	"time"

	"github.com/chromedp/chromedp"
	"github.com/gorilla/websocket"
	"github.com/golang-jwt/jwt/v5"
)

// validateToken validates a JWT token and returns the session ID
func (c *MultiSessionContainer) validateToken(tokenString string) (string, error) {
	// In production, implement proper JWT validation with the JWE secret
	// For now, basic implementation
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		// Validate signing method
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		// Return the secret (in production, get from environment)
		return []byte(getEnv("JWE_SECRET", "development-secret")), nil
	})

	if err != nil {
		return "", err
	}

	if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {
		if sessionID, ok := claims["sessionId"].(string); ok {
			return sessionID, nil
		}
		return "", fmt.Errorf("sessionId not found in token")
	}

	return "", fmt.Errorf("invalid token")
}

// sendMessage sends a JSON message over a WebSocket connection
func (c *MultiSessionContainer) sendMessage(conn *websocket.Conn, message map[string]interface{}) error {
	return conn.WriteJSON(message)
}

// handleInternalMessage processes internal messages
func (c *MultiSessionContainer) handleInternalMessage(conn *websocket.Conn, msg *InternalMessage) {
	switch msg.Type {
	case "CREATE_SESSION":
		c.createSession(msg.SessionID, msg.UserID, msg.Options)
	case "DESTROY_SESSION":
		c.destroySession(msg.SessionID)
	case "CLIENT_MESSAGE":
		c.handleClientMessage(msg.SessionID, msg.Data)
	case "START_SCREENCAST":
		c.handleStartScreencastMessage(conn, msg)
	case "STOP_SCREENCAST":
		c.handleStopScreencastMessage(msg)
	case "SEND_INPUT":
		c.handleInputEvent(msg)
	default:
		log.Printf("Unknown message type: %s", msg.Type)
	}
}

// createSession creates a new browser session
func (c *MultiSessionContainer) createSession(sessionID, userID string, options *SessionOptions) {
	c.sessionsMutex.Lock()
	defer c.sessionsMutex.Unlock()

	if len(c.sessions) >= MaxSessions {
		c.sendToProxy(map[string]interface{}{
			"type":      "SESSION_ERROR",
			"sessionId": sessionID,
			"error":     "Container at capacity",
		})
		return
	}

	// Create Chrome context with chromedp
	opts := []chromedp.ExecAllocatorOption{
		chromedp.NoSandbox,
		chromedp.DisableGPU,
		chromedp.NoFirstRun,
		chromedp.NoDefaultBrowserCheck,
		chromedp.Headless,
		chromedp.WindowSize(1920, 1080),
	}

	if options != nil {
		if options.UserAgent != "" {
			opts = append(opts, chromedp.UserAgent(options.UserAgent))
		}
		if options.Viewport != nil {
			opts = append(opts, chromedp.WindowSize(options.Viewport.Width, options.Viewport.Height))
		}
	}

	allocCtx, allocCancel := chromedp.NewExecAllocator(context.Background(), opts...)
	ctx, cancel := chromedp.NewContext(allocCtx)

	// Test the context by navigating to about:blank
	if err := chromedp.Run(ctx, chromedp.Navigate("about:blank")); err != nil {
		log.Printf("Failed to create session %s: %v", sessionID, err)
		allocCancel()
		cancel()
		c.sendToProxy(map[string]interface{}{
			"type":      "SESSION_ERROR",
			"sessionId": sessionID,
			"error":     fmt.Sprintf("Failed to create browser context: %v", err),
		})
		return
	}

	session := &Session{
		ID:           sessionID,
		UserID:       userID,
		Context:      ctx,
		Cancel:       cancel,
		LastActivity: time.Now(),
		Options:      *options,
		Pages:        make(map[string]interface{}),
	}

	c.sessions[sessionID] = session

	// Update Redis
	sessionData := map[string]interface{}{
		"userId":    userID,
		"createdAt": time.Now().Unix(),
		"status":    "active",
	}
	c.redisClient.HSet(context.Background(), fmt.Sprintf("container:%s:sessions", ContainerID), sessionID, sessionData)

	// Notify proxy
	c.sendToProxy(map[string]interface{}{
		"type":      "SESSION_READY",
		"sessionId": sessionID,
	})

	log.Printf("Session created: %s for user %s", sessionID, userID)
}

// destroySession destroys a browser session
func (c *MultiSessionContainer) destroySession(sessionID string) {
	c.sessionsMutex.Lock()
	defer c.sessionsMutex.Unlock()

	session, exists := c.sessions[sessionID]
	if !exists {
		return
	}

	// Stop screencast if active
	c.screencastMgr.StopScreencast(sessionID)

	// Cancel the context (closes browser)
	session.Cancel()

	delete(c.sessions, sessionID)

	// Update Redis
	c.redisClient.HDel(context.Background(), fmt.Sprintf("container:%s:sessions", ContainerID), sessionID)

	log.Printf("Session destroyed: %s", sessionID)
}

// handleClientMessage handles CDP messages for a session
func (c *MultiSessionContainer) handleClientMessage(sessionID string, data map[string]interface{}) {
	c.sessionsMutex.RLock()
	session, exists := c.sessions[sessionID]
	c.sessionsMutex.RUnlock()

	if !exists {
		c.sendToProxy(map[string]interface{}{
			"type":      "CDP_RESPONSE",
			"sessionId": sessionID,
			"data": map[string]interface{}{
				"id":    data["id"],
				"error": map[string]interface{}{"message": "Session not found"},
			},
		})
		return
	}

	session.LastActivity = time.Now()

	// Handle CDP commands using chromedp
	method, _ := data["method"].(string)
	params, _ := data["params"].(map[string]interface{})
	id, _ := data["id"].(float64)

	result, err := c.executeCDPCommand(session.Context, method, params)
	if err != nil {
		c.sendToProxy(map[string]interface{}{
			"type":      "CDP_RESPONSE",
			"sessionId": sessionID,
			"data": map[string]interface{}{
				"id":    id,
				"error": map[string]interface{}{"message": err.Error()},
			},
		})
		return
	}

	c.sendToProxy(map[string]interface{}{
		"type":      "CDP_RESPONSE",
		"sessionId": sessionID,
		"data": map[string]interface{}{
			"id":     id,
			"result": result,
		},
	})
}

// executeCDPCommand executes a CDP command using chromedp
func (c *MultiSessionContainer) executeCDPCommand(ctx context.Context, method string, params map[string]interface{}) (interface{}, error) {
	switch method {
	case "Page.navigate":
		if url, ok := params["url"].(string); ok {
			err := chromedp.Run(ctx, chromedp.Navigate(url))
			return map[string]interface{}{"frameId": "main"}, err
		}
		return nil, fmt.Errorf("missing url parameter")

	case "Page.captureScreenshot":
		var buf []byte
		err := chromedp.Run(ctx, chromedp.CaptureScreenshot(&buf))
		if err != nil {
			return nil, err
		}
		// Convert to base64
		data := base64.StdEncoding.EncodeToString(buf)
		return map[string]interface{}{"data": data}, nil

	case "Runtime.evaluate":
		if expression, ok := params["expression"].(string); ok {
			var result interface{}
			err := chromedp.Run(ctx, chromedp.Evaluate(expression, &result))
			return map[string]interface{}{"result": map[string]interface{}{"value": result}}, err
		}
		return nil, fmt.Errorf("missing expression parameter")

	default:
		// For other CDP commands, we'd need more specific implementations
		return map[string]interface{}{}, nil
	}
}

// handleCDPWebSocket handles direct CDP WebSocket connections
func (c *MultiSessionContainer) handleCDPWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := c.wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("CDP WebSocket upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	// Extract token and session ID from query parameters
	token := r.URL.Query().Get("token")
	sessionID := r.URL.Query().Get("sessionId")

	if token == "" || sessionID == "" {
		log.Println("CDP connection missing token or sessionId")
		conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(1008, "Missing token or sessionId"))
		return
	}

	// Validate token
	validatedSessionID, err := c.validateToken(token)
	if err != nil || validatedSessionID != sessionID {
		log.Printf("CDP token validation failed: %v", err)
		conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(1008, "Invalid token"))
		return
	}

	// Check if session exists
	c.sessionsMutex.RLock()
	session, exists := c.sessions[sessionID]
	c.sessionsMutex.RUnlock()

	if !exists {
		log.Printf("CDP connection for non-existent session: %s", sessionID)
		conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(1008, "Session not found"))
		return
	}

	log.Printf("CDP connection established for session: %s", sessionID)

	// Handle CDP messages
	for {
		_, messageBytes, err := conn.ReadMessage()
		if err != nil {
			log.Printf("CDP WebSocket read error: %v", err)
			break
		}

		var message map[string]interface{}
		if err := json.Unmarshal(messageBytes, &message); err != nil {
			log.Printf("Failed to parse CDP message: %v", err)
			continue
		}

		method, _ := message["method"].(string)
		params, _ := message["params"].(map[string]interface{})
		id, _ := message["id"].(float64)

		result, err := c.executeCDPCommand(session.Context, method, params)
		if err != nil {
			conn.WriteJSON(map[string]interface{}{
				"id":    id,
				"error": map[string]interface{}{"message": err.Error(), "code": -32000},
			})
		} else {
			conn.WriteJSON(map[string]interface{}{
				"id":     id,
				"result": result,
			})
		}

		session.LastActivity = time.Now()
	}
}

// sendToProxy sends a message to the proxy connection
func (c *MultiSessionContainer) sendToProxy(message map[string]interface{}) {
	c.proxyMutex.Lock()
	defer c.proxyMutex.Unlock()

	if c.proxyConnection != nil {
		c.proxyConnection.WriteJSON(message)
	}
}

// registerWithProxy registers this container with the proxy
func (c *MultiSessionContainer) registerWithProxy() error {
	// Get container IP (simplified for development)
	containerIP := "localhost"

	// In production, get from ECS metadata
	// This would involve fetching from ECS_CONTAINER_METADATA_URI_V4

	registrationData := map[string]interface{}{
		"containerId": ContainerID,
		"ip":          containerIP,
		"port":        Port,
		"taskArn":     getEnv("ECS_TASK_ARN", "local"),
	}

	// Make registration request to proxy
	// In production, implement HTTP POST to proxy endpoint
	log.Printf("Would register with proxy: %+v", registrationData)
	return nil
}

// startCleanupRoutine starts the cleanup routine for idle sessions
func (c *MultiSessionContainer) startCleanupRoutine() {
	c.cleanupTicker = time.NewTicker(60 * time.Second)
	go func() {
		for range c.cleanupTicker.C {
			c.cleanupIdleSessions()
		}
	}()
}

// cleanupIdleSessions removes idle sessions
func (c *MultiSessionContainer) cleanupIdleSessions() {
	c.sessionsMutex.Lock()
	defer c.sessionsMutex.Unlock()

	now := time.Now()
	idleTimeout := 5 * time.Minute

	for sessionID, session := range c.sessions {
		if now.Sub(session.LastActivity) > idleTimeout {
			log.Printf("Cleaning up idle session: %s", sessionID)
			
			// Stop screencast if active
			c.screencastMgr.StopScreencast(sessionID)
			
			// Cancel context
			session.Cancel()
			delete(c.sessions, sessionID)

			// Update Redis
			c.redisClient.HDel(context.Background(), fmt.Sprintf("container:%s:sessions", ContainerID), sessionID)

			// Notify proxy
			c.sendToProxy(map[string]interface{}{
				"type":      "SESSION_TIMEOUT",
				"sessionId": sessionID,
			})
		}
	}
}

// startHealthReporting starts health reporting to proxy and Redis
func (c *MultiSessionContainer) startHealthReporting() {
	c.healthTicker = time.NewTicker(30 * time.Second)
	go func() {
		for range c.healthTicker.C {
			c.reportHealth()
		}
	}()
}

// reportHealth reports health status
func (c *MultiSessionContainer) reportHealth() {
	c.sessionsMutex.RLock()
	sessionCount := len(c.sessions)
	c.sessionsMutex.RUnlock()

	health := map[string]interface{}{
		"status":      "healthy",
		"containerId": ContainerID,
		"sessions":    sessionCount,
		"maxSessions": MaxSessions,
		"uptime":      time.Now().Unix() - time.Now().Unix(), // Placeholder
		"timestamp":   time.Now().Unix(),
	}

	// Report to proxy
	c.sendToProxy(map[string]interface{}{
		"type":        "HEALTH_UPDATE",
		"cpuUsage":    0.0, // Placeholder
		"memoryUsage": 0.0, // Placeholder
	})

	// Update Redis
	healthJSON, _ := json.Marshal(health)
	c.redisClient.SetEx(context.Background(), fmt.Sprintf("container:%s:health", ContainerID), string(healthJSON), 60*time.Second)
}

// waitForShutdown waits for shutdown signals
func (c *MultiSessionContainer) waitForShutdown() {
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan
	c.shutdown()
}

// shutdown gracefully shuts down the container
func (c *MultiSessionContainer) shutdown() {
	log.Println("Shutting down gracefully...")

	// Stop tickers
	if c.cleanupTicker != nil {
		c.cleanupTicker.Stop()
	}
	if c.healthTicker != nil {
		c.healthTicker.Stop()
	}

	// Close all sessions
	c.sessionsMutex.Lock()
	for sessionID, session := range c.sessions {
		log.Printf("Closing session: %s", sessionID)
		session.Cancel()
	}
	c.sessionsMutex.Unlock()

	// Close HTTP server
	if c.httpServer != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		c.httpServer.Shutdown(ctx)
	}

	// Close Redis connection
	c.redisClient.Close()

	log.Println("Shutdown complete")
} 