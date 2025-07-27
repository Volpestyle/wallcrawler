package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/wallcrawler/backend-go/internal/utils"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		// In production, implement proper CORS checking
		return true
	},
}

// CDPProxy represents a unified CDP proxy with comprehensive routing and management
type CDPProxy struct {
	chromeAddr        string                    // Chrome CDP address (localhost:9222)
	activeConnections map[string]*Connection    // Track active WebSocket connections
	connectionsMutex  sync.RWMutex             // Protect connections map
	metrics           *ProxyMetrics             // Performance and usage metrics
	middleware        []MiddlewareFunc          // Middleware chain
	rateLimiter       *RateLimiter              // Rate limiting
	errorTracker      *ErrorTracker             // Error tracking and patterns
	circuitBreaker    *CircuitBreaker           // Circuit breaker for Chrome connectivity
}

// Connection represents an active WebSocket connection
type Connection struct {
	ID        string
	SessionID string
	ProjectID string
	Scope     string
	ClientIP  string
	ConnectedAt time.Time
	LastActivity time.Time
	Client    *websocket.Conn
	Chrome    *websocket.Conn
}

// ProxyMetrics tracks proxy performance and usage
type ProxyMetrics struct {
	TotalConnections    int64
	ActiveConnections   int64
	TotalRequests       int64
	FailedRequests      int64
	AuthFailures        int64
	BytesTransferred    int64
	ConnectionDuration  time.Duration
	mutex               sync.RWMutex
}

// MiddlewareFunc represents a middleware function
type MiddlewareFunc func(http.Handler) http.Handler

// PageInfo represents information about a Chrome page/target
type PageInfo struct {
	ID                   string `json:"id"`
	Type                 string `json:"type"`
	Title                string `json:"title"`
	URL                  string `json:"url"`
	DevtoolsFrontendUrl  string `json:"devtoolsFrontendUrl"`
	WebSocketDebuggerUrl string `json:"webSocketDebuggerUrl"`
	FaviconUrl           string `json:"faviconUrl,omitempty"`
	Description          string `json:"description,omitempty"`
}

// Add rate limiting and error handling structures after the existing types
// RateLimiter manages rate limiting per session/project
type RateLimiter struct {
	limits map[string]*SessionLimit // key: sessionID or projectID
	mutex  sync.RWMutex
}

type SessionLimit struct {
	RequestCount    int64
	LastRequest     time.Time
	WindowStart     time.Time
	MaxRequests     int64 // per minute
	IsBlocked       bool
	BlockedUntil    time.Time
}

// ErrorTracker tracks and manages error patterns
type ErrorTracker struct {
	errors map[string]*ErrorPattern
	mutex  sync.RWMutex
}

type ErrorPattern struct {
	Count          int64
	LastOccurrence time.Time
	ErrorType      string
	RecoveryAction string
}

// CircuitBreaker implements circuit breaker pattern for Chrome connectivity
type CircuitBreaker struct {
	FailureCount    int64
	LastFailureTime time.Time
	State           CircuitState
	mutex           sync.RWMutex
}

type CircuitState int

const (
	Closed CircuitState = iota
	Open
	HalfOpen
)

// NewCDPProxy creates a new comprehensive CDP proxy
func NewCDPProxy() *CDPProxy {
	proxy := &CDPProxy{
		chromeAddr:        "127.0.0.1:9222",
		activeConnections: make(map[string]*Connection),
		metrics:           &ProxyMetrics{},
		middleware:        []MiddlewareFunc{},
		rateLimiter:       NewRateLimiter(),
		errorTracker:      NewErrorTracker(),
		circuitBreaker:    NewCircuitBreaker(),
	}

	// Add default middleware chain (order matters!)
	proxy.AddMiddleware(proxy.loggingMiddleware)
	proxy.AddMiddleware(proxy.metricsMiddleware)
	proxy.AddMiddleware(proxy.rateLimitMiddleware)
	proxy.AddMiddleware(proxy.circuitBreakerMiddleware)
	proxy.AddMiddleware(proxy.authMiddleware)

	return proxy
}

// AddMiddleware adds a middleware function to the chain
func (p *CDPProxy) AddMiddleware(middleware MiddlewareFunc) {
	p.middleware = append(p.middleware, middleware)
}

// buildMiddlewareChain builds the complete middleware chain
func (p *CDPProxy) buildMiddlewareChain(handler http.Handler) http.Handler {
	// Build middleware chain in reverse order
	for i := len(p.middleware) - 1; i >= 0; i-- {
		handler = p.middleware[i](handler)
	}
	return handler
}

// loggingMiddleware logs all requests
func (p *CDPProxy) loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		log.Printf("CDP Proxy: %s %s from %s", r.Method, r.URL.Path, r.RemoteAddr)
		next.ServeHTTP(w, r)
		log.Printf("CDP Proxy: %s %s completed in %v", r.Method, r.URL.Path, time.Since(start))
	})
}

// metricsMiddleware tracks request metrics
func (p *CDPProxy) metricsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p.metrics.mutex.Lock()
		p.metrics.TotalRequests++
		p.metrics.mutex.Unlock()

		start := time.Now()
		next.ServeHTTP(w, r)
		
		// Could track response status and update failed requests if needed
		duration := time.Since(start)
		p.metrics.mutex.Lock()
		p.metrics.ConnectionDuration += duration
		p.metrics.mutex.Unlock()
	})
}

// rateLimitMiddleware enforces rate limiting per session/project
func (p *CDPProxy) rateLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip rate limiting for management endpoints
		if r.URL.Path == "/health" || r.URL.Path == "/metrics" {
			next.ServeHTTP(w, r)
			return
		}

		// For rate limiting, we need to extract session info from the token
		// This is a simplified approach - in practice you might want to rate limit by IP as well
		signingKey := p.extractSigningKey(r)
		if signingKey != "" {
			// Quick token validation for rate limiting (full validation happens in auth middleware)
			if payload, err := utils.ValidateCDPToken(signingKey); err == nil {
				if !p.rateLimiter.CheckRateLimit(payload.SessionID, payload.ProjectID) {
					p.errorTracker.RecordError("rate_limit_exceeded", payload.SessionID)
					log.Printf("CDP Proxy: Rate limit exceeded for session %s", payload.SessionID)
					http.Error(w, "Rate limit exceeded", 429)
					return
				}
			}
		}

		next.ServeHTTP(w, r)
	})
}

// circuitBreakerMiddleware implements circuit breaker pattern
func (p *CDPProxy) circuitBreakerMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip circuit breaker for management endpoints
		if r.URL.Path == "/health" || r.URL.Path == "/metrics" {
			next.ServeHTTP(w, r)
			return
		}

		// Check if circuit breaker allows requests
		if !p.circuitBreaker.CanExecute() {
			p.errorTracker.RecordError("circuit_breaker_open", "chrome_unavailable")
			log.Printf("CDP Proxy: Circuit breaker is open, rejecting request")
			http.Error(w, "Service temporarily unavailable", 503)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// authMiddleware handles authentication for all requests
func (p *CDPProxy) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip auth for health check
		if r.URL.Path == "/health" || r.URL.Path == "/metrics" {
			next.ServeHTTP(w, r)
			return
		}

		// Extract and validate signing key
		signingKey := p.extractSigningKey(r)
		if signingKey == "" {
			p.metrics.mutex.Lock()
			p.metrics.AuthFailures++
			p.metrics.mutex.Unlock()
			
			p.errorTracker.RecordError("missing_auth_token", r.RemoteAddr)
			log.Printf("CDP Proxy: Missing signing key for %s %s", r.Method, r.URL.Path)
			http.Error(w, "Unauthorized: Missing signing key", 401)
			return
		}

		// Validate the token
		payload, err := utils.ValidateCDPToken(signingKey)
		if err != nil {
			p.metrics.mutex.Lock()
			p.metrics.AuthFailures++
			p.metrics.mutex.Unlock()
			
			p.errorTracker.RecordError("invalid_auth_token", err.Error())
			log.Printf("CDP Proxy: Invalid signing key: %v", err)
			http.Error(w, "Unauthorized: Invalid signing key", 401)
			return
		}

		// Add payload to request context for downstream handlers
		ctx := context.WithValue(r.Context(), "cdp_payload", payload)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// extractSigningKey extracts the signing key from request (query params or Authorization header)
func (p *CDPProxy) extractSigningKey(r *http.Request) string {
	// Try query parameter first (for WebSocket connections)
	if signingKey := r.URL.Query().Get("signingKey"); signingKey != "" {
		return signingKey
	}

	// Try Authorization header (for HTTP requests)
	authHeader := r.Header.Get("Authorization")
	if strings.HasPrefix(authHeader, "Bearer ") {
		return strings.TrimPrefix(authHeader, "Bearer ")
	}

	return ""
}

// handleCDPRequest routes CDP requests to appropriate handlers
func (p *CDPProxy) handleCDPRequest(w http.ResponseWriter, r *http.Request) {
	// Get the validated payload from context
	payload, ok := r.Context().Value("cdp_payload").(*utils.CDPSigningPayload)
	if !ok {
		http.Error(w, "Internal error: missing authentication payload", 500)
		return
	}

	// Route based on request type and path
	if r.Header.Get("Upgrade") == "websocket" {
		p.handleWebSocketConnection(w, r, payload)
		return
	}

	// Handle HTTP requests to Chrome's JSON API
	p.handleHTTPRequest(w, r, payload)
}

// handleWebSocketConnection handles WebSocket connections with comprehensive routing
func (p *CDPProxy) handleWebSocketConnection(w http.ResponseWriter, r *http.Request, payload *utils.CDPSigningPayload) {
	log.Printf("CDP Proxy: WebSocket connection for session %s, scope %s", payload.SessionID, payload.Scope)

	// Validate scope for WebSocket connections
	if !p.isValidWebSocketScope(payload.Scope) {
		log.Printf("CDP Proxy: Invalid WebSocket scope: %s", payload.Scope)
		http.Error(w, "Forbidden: Invalid scope for WebSocket access", 403)
		return
	}

	// Upgrade to WebSocket
	clientConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("CDP Proxy: Failed to upgrade WebSocket: %v", err)
		return
	}
	defer clientConn.Close()

	// Determine Chrome WebSocket endpoint
	chromeEndpoint, err := p.getChromeWebSocketEndpoint(r.URL.Path, payload.Scope)
	if err != nil {
		log.Printf("CDP Proxy: Failed to determine Chrome endpoint: %v", err)
		clientConn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseInternalServerErr, "Failed to connect to Chrome"))
		return
	}

	// Connect to Chrome
	chromeConn, _, err := websocket.DefaultDialer.Dial(chromeEndpoint, nil)
	if err != nil {
		p.circuitBreaker.RecordFailure()
		p.errorTracker.RecordError("chrome_connection_failed", err.Error())
		log.Printf("CDP Proxy: Failed to connect to Chrome: %v", err)
		clientConn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseInternalServerErr, "Chrome CDP unavailable"))
		return
	}
	defer chromeConn.Close()
	
	// Record successful Chrome connection
	p.circuitBreaker.RecordSuccess()

	// Create connection tracking
	connectionID := fmt.Sprintf("%s_%d", payload.SessionID, time.Now().UnixNano())
	connection := &Connection{
		ID:           connectionID,
		SessionID:    payload.SessionID,
		ProjectID:    payload.ProjectID,
		Scope:        payload.Scope,
		ClientIP:     payload.IPAddress,
		ConnectedAt:  time.Now(),
		LastActivity: time.Now(),
		Client:       clientConn,
		Chrome:       chromeConn,
	}

	// Track the connection
	p.connectionsMutex.Lock()
	p.activeConnections[connectionID] = connection
	p.metrics.TotalConnections++
	p.metrics.ActiveConnections++
	p.connectionsMutex.Unlock()

	// Handle the connection
	p.proxyWebSocketMessages(connection)

	// Clean up connection tracking
	p.connectionsMutex.Lock()
	delete(p.activeConnections, connectionID)
	p.metrics.ActiveConnections--
	p.connectionsMutex.Unlock()

	log.Printf("CDP Proxy: WebSocket connection closed for session %s", payload.SessionID)
}

// isValidWebSocketScope checks if the scope is valid for WebSocket connections
func (p *CDPProxy) isValidWebSocketScope(scope string) bool {
	validScopes := map[string]bool{
		"cdp-direct": true,
		"debug":      true,
		"screencast": true,
	}
	return validScopes[scope]
}

// getChromeWebSocketEndpoint determines the correct Chrome WebSocket endpoint
func (p *CDPProxy) getChromeWebSocketEndpoint(requestPath, scope string) (string, error) {
	// Extract path for Chrome CDP
	cdpPath := strings.TrimPrefix(requestPath, "/cdp")
	if cdpPath == "" || cdpPath == "/" {
		// For default requests, get the first available page
		pageInfo, err := p.getPageInfo()
		if err != nil {
			return "", fmt.Errorf("failed to get page info: %v", err)
		}
		
		// Use the WebSocket debugger URL from the page info
		if pageInfo.WebSocketDebuggerUrl != "" {
			return pageInfo.WebSocketDebuggerUrl, nil
		}
		
		// Fallback to constructed URL
		return fmt.Sprintf("ws://%s/devtools/page/%s", p.chromeAddr, pageInfo.ID), nil
	}

	// Use the provided path
	return fmt.Sprintf("ws://%s%s", p.chromeAddr, cdpPath), nil
}

// handleHTTPRequest handles HTTP requests to Chrome's JSON API
func (p *CDPProxy) handleHTTPRequest(w http.ResponseWriter, r *http.Request, payload *utils.CDPSigningPayload) {
	// Validate scope for HTTP requests
	if !p.isValidHTTPScope(payload.Scope) {
		log.Printf("CDP Proxy: Invalid HTTP scope: %s", payload.Scope)
		http.Error(w, "Forbidden: Invalid scope for HTTP access", 403)
		return
	}

	// Determine Chrome HTTP endpoint
	chromeEndpoint := p.getChromeHTTPEndpoint(r.URL.Path)
	
	// Build the target URL
	targetURL := fmt.Sprintf("http://%s%s", p.chromeAddr, chromeEndpoint)
	
	// Add query parameters (except signingKey)
	if r.URL.RawQuery != "" {
		params, _ := url.ParseQuery(r.URL.RawQuery)
		params.Del("signingKey") // Remove our auth param
		if len(params) > 0 {
			targetURL += "?" + params.Encode()
		}
	}

	log.Printf("CDP Proxy: Proxying HTTP %s to %s", r.Method, targetURL)

	// Proxy the request
	p.proxyHTTPRequest(w, r, targetURL)
}

// isValidHTTPScope checks if the scope is valid for HTTP requests
func (p *CDPProxy) isValidHTTPScope(scope string) bool {
	validScopes := map[string]bool{
		"cdp-direct": true,
		"debug":      true,
		// screencast typically doesn't need HTTP access
	}
	return validScopes[scope]
}

// getChromeHTTPEndpoint maps request paths to Chrome HTTP endpoints
func (p *CDPProxy) getChromeHTTPEndpoint(requestPath string) string {
	// Map CDP proxy paths to Chrome paths
	cdpPath := strings.TrimPrefix(requestPath, "/cdp")
	
	// Handle common Chrome endpoints
	switch {
	case cdpPath == "" || cdpPath == "/" || cdpPath == "/json":
		return "/json"
	case strings.HasPrefix(cdpPath, "/json/"):
		return cdpPath
	case strings.HasPrefix(cdpPath, "/devtools/"):
		return cdpPath
	default:
		// Default to the path as-is
		return cdpPath
	}
}

// proxyHTTPRequest proxies HTTP requests to Chrome
func (p *CDPProxy) proxyHTTPRequest(w http.ResponseWriter, r *http.Request, targetURL string) {
	// Create a new request to Chrome
	req, err := http.NewRequest(r.Method, targetURL, r.Body)
	if err != nil {
		log.Printf("CDP Proxy: Error creating Chrome request: %v", err)
		http.Error(w, "Error creating request to Chrome", 500)
		return
	}

	// Copy headers (except auth-related ones)
	for key, values := range r.Header {
		if key != "Authorization" && !strings.HasPrefix(key, "X-") {
			for _, value := range values {
				req.Header.Add(key, value)
			}
		}
	}

	// Make the request to Chrome
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		p.circuitBreaker.RecordFailure()
		p.errorTracker.RecordError("chrome_http_request_failed", err.Error())
		log.Printf("CDP Proxy: Error requesting from Chrome: %v", err)
		http.Error(w, "Chrome CDP unavailable", 502)
		return
	}
	defer resp.Body.Close()
	
	// Record successful Chrome HTTP request
	p.circuitBreaker.RecordSuccess()

	// Copy response headers
	for key, values := range resp.Header {
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}

	// Set status code
	w.WriteHeader(resp.StatusCode)

	// Copy response body
	bytesTransferred, err := io.Copy(w, resp.Body)
	if err != nil {
		log.Printf("CDP Proxy: Error copying response body: %v", err)
		return
	}

	// Update metrics
	p.metrics.mutex.Lock()
	p.metrics.BytesTransferred += bytesTransferred
	p.metrics.mutex.Unlock()
}

// proxyWebSocketMessages handles bidirectional WebSocket message proxying
func (p *CDPProxy) proxyWebSocketMessages(conn *Connection) {
	done := make(chan struct{})

	// Client -> Chrome
	go func() {
		defer close(done)
		for {
			messageType, message, err := conn.Client.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
					log.Printf("CDP Proxy: Client WebSocket error: %v", err)
				}
				return
			}

			// Update activity
			conn.LastActivity = time.Now()

			// Optional: Log CDP commands for debugging/auditing
			if conn.Scope == "debug" {
				log.Printf("CDP Proxy: Command from session %s: %s", conn.SessionID, string(message))
			}

			if err := conn.Chrome.WriteMessage(messageType, message); err != nil {
				log.Printf("CDP Proxy: Error writing to Chrome: %v", err)
				return
			}

			// Update metrics
			p.metrics.mutex.Lock()
			p.metrics.BytesTransferred += int64(len(message))
			p.metrics.mutex.Unlock()
		}
	}()

	// Chrome -> Client
	go func() {
		for {
			messageType, message, err := conn.Chrome.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
					log.Printf("CDP Proxy: Chrome WebSocket error: %v", err)
				}
				return
			}

			// Update activity
			conn.LastActivity = time.Now()

			if err := conn.Client.WriteMessage(messageType, message); err != nil {
				log.Printf("CDP Proxy: Error writing to client: %v", err)
				return
			}

			// Update metrics
			p.metrics.mutex.Lock()
			p.metrics.BytesTransferred += int64(len(message))
			p.metrics.mutex.Unlock()
		}
	}()

	// Wait for either connection to close
	<-done
}

// getPageInfo retrieves page information from Chrome's /json endpoint
func (p *CDPProxy) getPageInfo() (*PageInfo, error) {
	resp, err := http.Get(fmt.Sprintf("http://%s/json", p.chromeAddr))
	if err != nil {
		return nil, fmt.Errorf("failed to get page info: %v", err)
	}
	defer resp.Body.Close()

	var pages []PageInfo
	if err := json.NewDecoder(resp.Body).Decode(&pages); err != nil {
		return nil, fmt.Errorf("failed to decode page info: %v", err)
	}

	// Find the first page target (not extensions or other types)
	for _, page := range pages {
		if page.Type == "page" {
			return &page, nil
		}
	}

	if len(pages) > 0 {
		// Fallback to first available target
		return &pages[0], nil
	}

	return nil, fmt.Errorf("no pages found")
}

// handleMetrics provides comprehensive metrics endpoint
func (p *CDPProxy) handleMetrics(w http.ResponseWriter, r *http.Request) {
	p.metrics.mutex.RLock()
	avgDuration := float64(0)
	if p.metrics.TotalConnections > 0 {
		avgDuration = p.metrics.ConnectionDuration.Seconds() / float64(p.metrics.TotalConnections)
	}
	
	metrics := map[string]interface{}{
		"total_connections":        p.metrics.TotalConnections,
		"active_connections":       p.metrics.ActiveConnections,
		"total_requests":           p.metrics.TotalRequests,
		"failed_requests":          p.metrics.FailedRequests,
		"auth_failures":            p.metrics.AuthFailures,
		"bytes_transferred":        p.metrics.BytesTransferred,
		"avg_connection_duration":  avgDuration,
	}
	p.metrics.mutex.RUnlock()

	// Add circuit breaker status
	p.circuitBreaker.mutex.RLock()
	circuitBreakerStatus := map[string]interface{}{
		"state":              p.circuitBreaker.State,
		"failure_count":      p.circuitBreaker.FailureCount,
		"last_failure_time":  p.circuitBreaker.LastFailureTime,
	}
	p.circuitBreaker.mutex.RUnlock()

	// Add error tracking information
	p.errorTracker.mutex.RLock()
	errorPatterns := make(map[string]interface{})
	for errorType, pattern := range p.errorTracker.errors {
		errorPatterns[errorType] = map[string]interface{}{
			"count":            pattern.Count,
			"last_occurrence":  pattern.LastOccurrence,
			"recovery_action":  pattern.RecoveryAction,
		}
	}
	p.errorTracker.mutex.RUnlock()

	// Add rate limiting status
	p.rateLimiter.mutex.RLock()
	rateLimitStatus := map[string]interface{}{
		"active_limits": len(p.rateLimiter.limits),
	}
	
	// Add details of currently rate-limited sessions
	blockedSessions := make([]map[string]interface{}, 0)
	for sessionID, limit := range p.rateLimiter.limits {
		if limit.IsBlocked {
			blockedSessions = append(blockedSessions, map[string]interface{}{
				"session_id":     sessionID,
				"request_count":  limit.RequestCount,
				"blocked_until":  limit.BlockedUntil,
				"window_start":   limit.WindowStart,
			})
		}
	}
	rateLimitStatus["blocked_sessions"] = blockedSessions
	p.rateLimiter.mutex.RUnlock()

	// Add active connection details
	p.connectionsMutex.RLock()
	connections := make([]map[string]interface{}, 0, len(p.activeConnections))
	for _, conn := range p.activeConnections {
		connections = append(connections, map[string]interface{}{
			"id":            conn.ID,
			"session_id":    conn.SessionID,
			"project_id":    conn.ProjectID,
			"scope":         conn.Scope,
			"client_ip":     conn.ClientIP,
			"connected_at":  conn.ConnectedAt,
			"last_activity": conn.LastActivity,
			"duration":      time.Since(conn.ConnectedAt).Seconds(),
		})
	}
	p.connectionsMutex.RUnlock()

	response := map[string]interface{}{
		"status":              "healthy",
		"metrics":             metrics,
		"circuit_breaker":     circuitBreakerStatus,
		"error_patterns":      errorPatterns,
		"rate_limiting":       rateLimitStatus,
		"active_connections":  connections,
		"timestamp":           time.Now(),
		"chrome_address":      p.chromeAddr,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleHealth provides health check endpoint
func (p *CDPProxy) handleHealth(w http.ResponseWriter, r *http.Request) {
	// Check Chrome connectivity
	_, err := http.Get(fmt.Sprintf("http://%s/json/version", p.chromeAddr))
	if err != nil {
		w.WriteHeader(503)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "unhealthy",
			"error":  "Chrome CDP unavailable",
			"timestamp": time.Now(),
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "healthy",
		"chrome_addr": p.chromeAddr,
		"timestamp": time.Now(),
	})
}

// NewRateLimiter creates a new rate limiter
func NewRateLimiter() *RateLimiter {
	rl := &RateLimiter{
		limits: make(map[string]*SessionLimit),
	}
	
	// Start cleanup goroutine
	go rl.cleanup()
	return rl
}

// CheckRateLimit checks if a session/project is within rate limits
func (rl *RateLimiter) CheckRateLimit(sessionID, projectID string) bool {
	rl.mutex.Lock()
	defer rl.mutex.Unlock()
	
	now := time.Now()
	key := sessionID // Could also check projectID for project-level limits
	
	limit, exists := rl.limits[key]
	if !exists {
		limit = &SessionLimit{
			RequestCount: 1,
			LastRequest:  now,
			WindowStart:  now,
			MaxRequests:  100, // 100 requests per minute default
		}
		rl.limits[key] = limit
		return true
	}
	
	// Check if blocked
	if limit.IsBlocked && now.Before(limit.BlockedUntil) {
		return false
	}
	
	// Reset window if it's been more than a minute
	if now.Sub(limit.WindowStart) > time.Minute {
		limit.RequestCount = 1
		limit.WindowStart = now
		limit.IsBlocked = false
		return true
	}
	
	// Check rate limit
	limit.RequestCount++
	limit.LastRequest = now
	
	if limit.RequestCount > limit.MaxRequests {
		limit.IsBlocked = true
		limit.BlockedUntil = now.Add(5 * time.Minute) // Block for 5 minutes
		return false
	}
	
	return true
}

// cleanup removes old rate limit entries
func (rl *RateLimiter) cleanup() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	
	for range ticker.C {
		rl.mutex.Lock()
		now := time.Now()
		for key, limit := range rl.limits {
			if now.Sub(limit.LastRequest) > 10*time.Minute {
				delete(rl.limits, key)
			}
		}
		rl.mutex.Unlock()
	}
}

// NewErrorTracker creates a new error tracker
func NewErrorTracker() *ErrorTracker {
	return &ErrorTracker{
		errors: make(map[string]*ErrorPattern),
	}
}

// RecordError records an error pattern
func (et *ErrorTracker) RecordError(errorType, details string) {
	et.mutex.Lock()
	defer et.mutex.Unlock()
	
	key := errorType
	pattern, exists := et.errors[key]
	if !exists {
		pattern = &ErrorPattern{
			Count:          1,
			LastOccurrence: time.Now(),
			ErrorType:      errorType,
			RecoveryAction: "retry",
		}
		et.errors[key] = pattern
	} else {
		pattern.Count++
		pattern.LastOccurrence = time.Now()
	}
	
	// Log error patterns
	log.Printf("CDP Proxy Error: %s occurred %d times (last: %v)", 
		errorType, pattern.Count, pattern.LastOccurrence)
}

// NewCircuitBreaker creates a new circuit breaker
func NewCircuitBreaker() *CircuitBreaker {
	return &CircuitBreaker{
		State: Closed,
	}
}

// CanExecute checks if requests can be executed (circuit breaker)
func (cb *CircuitBreaker) CanExecute() bool {
	cb.mutex.RLock()
	defer cb.mutex.RUnlock()
	
	switch cb.State {
	case Open:
		// Check if we should transition to half-open
		if time.Since(cb.LastFailureTime) > 30*time.Second {
			cb.mutex.RUnlock()
			cb.mutex.Lock()
			cb.State = HalfOpen
			cb.mutex.Unlock()
			cb.mutex.RLock()
			return true
		}
		return false
	case HalfOpen, Closed:
		return true
	default:
		return false
	}
}

// RecordSuccess records a successful operation
func (cb *CircuitBreaker) RecordSuccess() {
	cb.mutex.Lock()
	defer cb.mutex.Unlock()
	
	cb.FailureCount = 0
	cb.State = Closed
}

// RecordFailure records a failed operation
func (cb *CircuitBreaker) RecordFailure() {
	cb.mutex.Lock()
	defer cb.mutex.Unlock()
	
	cb.FailureCount++
	cb.LastFailureTime = time.Now()
	
	if cb.FailureCount >= 5 { // Open circuit after 5 failures
		cb.State = Open
		log.Printf("CDP Proxy: Circuit breaker opened due to %d failures", cb.FailureCount)
	}
}

func main() {
	port := os.Getenv("CDP_PROXY_PORT")
	if port == "" {
		port = "9223" // Default authenticated CDP proxy port
	}

	proxy := NewCDPProxy()

	// Main CDP proxy endpoint with middleware chain
	http.Handle("/cdp/", proxy.buildMiddlewareChain(http.HandlerFunc(proxy.handleCDPRequest)))

	// Management endpoints (no auth required)
	http.HandleFunc("/health", proxy.handleHealth)
	http.HandleFunc("/metrics", proxy.handleMetrics)

	log.Printf("Starting Unified CDP Proxy server on port %s", port)
	log.Printf("Chrome CDP address: %s", proxy.chromeAddr)
	log.Printf("Middleware chain: logging -> metrics -> rate-limiting -> circuit-breaker -> auth -> routing")
	log.Printf("Features enabled: JWT auth, rate limiting, circuit breaker, error tracking, comprehensive metrics")
	log.Printf("Management endpoints: /health, /metrics")
	
	log.Fatal(http.ListenAndServe(":"+port, nil))
} 