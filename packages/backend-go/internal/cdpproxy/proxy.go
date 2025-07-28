package cdpproxy

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
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

// CDPProxy represents the integrated CDP proxy
type CDPProxy struct {
	chromeAddr        string
	activeConnections map[string]*Connection
	connectionsMutex  sync.RWMutex
	metrics           *ProxyMetrics
	rateLimiter       *RateLimiter
	errorTracker      *ErrorTracker
	circuitBreaker    *CircuitBreaker
	server            *http.Server
}

// Connection represents an active WebSocket connection
type Connection struct {
	ID           string
	SessionID    string
	ProjectID    string
	ClientIP     string
	ConnectedAt  time.Time
	LastActivity time.Time
	Client       *websocket.Conn
	Chrome       *websocket.Conn
}

// ProxyMetrics tracks proxy performance and usage
type ProxyMetrics struct {
	TotalConnections   int64
	ActiveConnections  int64
	TotalRequests      int64
	FailedRequests     int64
	AuthFailures       int64
	BytesTransferred   int64
	ConnectionDuration time.Duration
	mutex              sync.RWMutex
}

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

// NewCDPProxy creates a new CDP proxy instance
func NewCDPProxy(chromeAddr string) *CDPProxy {
	return &CDPProxy{
		chromeAddr:        chromeAddr,
		activeConnections: make(map[string]*Connection),
		metrics:           &ProxyMetrics{},
		rateLimiter:       NewRateLimiter(),
		errorTracker:      NewErrorTracker(),
		circuitBreaker:    NewCircuitBreaker(),
	}
}

// Start initializes and starts the CDP proxy server
func (p *CDPProxy) Start(port string) error {
	mux := http.NewServeMux()

	// Main CDP proxy endpoint with auth middleware
	mux.HandleFunc("/cdp/", p.handleCDPRequest)

	// Management endpoints (no auth required)
	mux.HandleFunc("/health", p.handleHealth)
	mux.HandleFunc("/metrics", p.handleMetrics)

	p.server = &http.Server{
		Addr:    ":" + port,
		Handler: p.applyMiddleware(mux),
	}

	// Start server in goroutine
	go func() {
		log.Printf("Starting integrated CDP proxy server on port %s", port)
		if err := p.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("CDP proxy server error: %v", err)
		}
	}()

	// Give the proxy a moment to start
	time.Sleep(2 * time.Second)

	// Test if proxy is responding
	resp, err := http.Get("http://localhost:" + port + "/health")
	if err != nil {
		return fmt.Errorf("CDP proxy health check failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("CDP proxy unhealthy, status: %d", resp.StatusCode)
	}

	log.Printf("Integrated CDP proxy ready on port %s", port)
	return nil
}

// Stop gracefully shuts down the CDP proxy server
func (p *CDPProxy) Stop() error {
	if p.server == nil {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := p.server.Shutdown(ctx); err != nil {
		log.Printf("CDP proxy server shutdown error: %v", err)
		return err
	}

	log.Printf("CDP proxy server shut down gracefully")
	return nil
}

// applyMiddleware applies the middleware chain to all requests
func (p *CDPProxy) applyMiddleware(handler http.Handler) http.Handler {
	// Apply middleware in order: logging -> metrics -> rate limiting -> circuit breaker -> auth
	handler = p.authMiddleware(handler)
	handler = p.circuitBreakerMiddleware(handler)
	handler = p.rateLimitMiddleware(handler)
	handler = p.metricsMiddleware(handler)
	handler = p.loggingMiddleware(handler)
	return handler
}

// handleCDPRequest routes CDP requests to appropriate handlers
func (p *CDPProxy) handleCDPRequest(w http.ResponseWriter, r *http.Request) {
	payload, ok := r.Context().Value("cdp_payload").(*utils.CDPSigningPayload)
	if !ok {
		http.Error(w, "Internal error: missing authentication payload", 500)
		return
	}

	if r.Header.Get("Upgrade") == "websocket" {
		p.handleWebSocketConnection(w, r, payload)
		return
	}

	p.handleHTTPRequest(w, r, payload)
}

// handleWebSocketConnection handles WebSocket connections
func (p *CDPProxy) handleWebSocketConnection(w http.ResponseWriter, r *http.Request, payload *utils.CDPSigningPayload) {
	log.Printf("CDP Proxy: WebSocket connection for session %s", payload.SessionID)

	clientConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("CDP Proxy: Failed to upgrade WebSocket: %v", err)
		return
	}
	defer clientConn.Close()

	chromeEndpoint, err := p.getChromeWebSocketEndpoint(r.URL.Path)
	if err != nil {
		log.Printf("CDP Proxy: Failed to determine Chrome endpoint: %v", err)
		clientConn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseInternalServerErr, "Failed to connect to Chrome"))
		return
	}

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

	p.circuitBreaker.RecordSuccess()

	connectionID := fmt.Sprintf("%s_%d", payload.SessionID, time.Now().UnixNano())
	connection := &Connection{
		ID:           connectionID,
		SessionID:    payload.SessionID,
		ProjectID:    payload.ProjectID,
		ClientIP:     payload.IPAddress,
		ConnectedAt:  time.Now(),
		LastActivity: time.Now(),
		Client:       clientConn,
		Chrome:       chromeConn,
	}

	p.connectionsMutex.Lock()
	p.activeConnections[connectionID] = connection
	p.metrics.TotalConnections++
	p.metrics.ActiveConnections++
	p.connectionsMutex.Unlock()

	p.proxyWebSocketMessages(connection)

	p.connectionsMutex.Lock()
	delete(p.activeConnections, connectionID)
	p.metrics.ActiveConnections--
	p.connectionsMutex.Unlock()

	log.Printf("CDP Proxy: WebSocket connection closed for session %s", payload.SessionID)
}

// handleHTTPRequest handles HTTP requests to Chrome's JSON API
func (p *CDPProxy) handleHTTPRequest(w http.ResponseWriter, r *http.Request, payload *utils.CDPSigningPayload) {
	chromeEndpoint := p.getChromeHTTPEndpoint(r.URL.Path)
	targetURL := fmt.Sprintf("http://%s%s", p.chromeAddr, chromeEndpoint)

	if r.URL.RawQuery != "" {
		params, _ := url.ParseQuery(r.URL.RawQuery)
		params.Del("signingKey")
		if len(params) > 0 {
			targetURL += "?" + params.Encode()
		}
	}

	log.Printf("CDP Proxy: Proxying HTTP %s to %s", r.Method, targetURL)
	p.proxyHTTPRequest(w, r, targetURL)
}

// proxyHTTPRequest proxies HTTP requests to Chrome
func (p *CDPProxy) proxyHTTPRequest(w http.ResponseWriter, r *http.Request, targetURL string) {
	req, err := http.NewRequest(r.Method, targetURL, r.Body)
	if err != nil {
		log.Printf("CDP Proxy: Error creating Chrome request: %v", err)
		http.Error(w, "Error creating request to Chrome", 500)
		return
	}

	for key, values := range r.Header {
		if key != "Authorization" && !strings.HasPrefix(key, "X-") {
			for _, value := range values {
				req.Header.Add(key, value)
			}
		}
	}

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

	p.circuitBreaker.RecordSuccess()

	for key, values := range resp.Header {
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}

	w.WriteHeader(resp.StatusCode)

	bytesTransferred, err := io.Copy(w, resp.Body)
	if err != nil {
		log.Printf("CDP Proxy: Error copying response body: %v", err)
		return
	}

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

			conn.LastActivity = time.Now()

			if err := conn.Chrome.WriteMessage(messageType, message); err != nil {
				log.Printf("CDP Proxy: Error writing to Chrome: %v", err)
				return
			}

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

			conn.LastActivity = time.Now()

			if err := conn.Client.WriteMessage(messageType, message); err != nil {
				log.Printf("CDP Proxy: Error writing to client: %v", err)
				return
			}

			p.metrics.mutex.Lock()
			p.metrics.BytesTransferred += int64(len(message))
			p.metrics.mutex.Unlock()
		}
	}()

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

	for _, page := range pages {
		if page.Type == "page" {
			return &page, nil
		}
	}

	if len(pages) > 0 {
		return &pages[0], nil
	}

	return nil, fmt.Errorf("no pages found")
}



// getChromeWebSocketEndpoint determines the correct Chrome WebSocket endpoint
func (p *CDPProxy) getChromeWebSocketEndpoint(requestPath string) (string, error) {
	cdpPath := strings.TrimPrefix(requestPath, "/cdp")
	if cdpPath == "" || cdpPath == "/" {
		pageInfo, err := p.getPageInfo()
		if err != nil {
			return "", fmt.Errorf("failed to get page info: %v", err)
		}

		if pageInfo.WebSocketDebuggerUrl != "" {
			return pageInfo.WebSocketDebuggerUrl, nil
		}

		return fmt.Sprintf("ws://%s/devtools/page/%s", p.chromeAddr, pageInfo.ID), nil
	}

	return fmt.Sprintf("ws://%s%s", p.chromeAddr, cdpPath), nil
}

// getChromeHTTPEndpoint maps request paths to Chrome HTTP endpoints
func (p *CDPProxy) getChromeHTTPEndpoint(requestPath string) string {
	cdpPath := strings.TrimPrefix(requestPath, "/cdp")

	switch {
	case cdpPath == "" || cdpPath == "/" || cdpPath == "/json":
		return "/json"
	case strings.HasPrefix(cdpPath, "/json/"):
		return cdpPath
	case strings.HasPrefix(cdpPath, "/devtools/"):
		return cdpPath
	default:
		return cdpPath
	}
}

// extractSigningKey extracts the signing key from request
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
