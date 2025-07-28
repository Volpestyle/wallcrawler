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
	"time"

	"github.com/gorilla/websocket"
	"github.com/wallcrawler/backend-go/internal/utils"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for simplicity
	},
}

// CDPProxy represents a simplified CDP proxy that only handles authentication
type CDPProxy struct {
	chromeAddr string
	server     *http.Server
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

// NewCDPProxy creates a new simplified CDP proxy instance
func NewCDPProxy(chromeAddr string) *CDPProxy {
	return &CDPProxy{
		chromeAddr: chromeAddr,
	}
}

// Start initializes and starts the CDP proxy server
func (p *CDPProxy) Start(port string) error {
	mux := http.NewServeMux()

	// Main endpoint with auth
	mux.HandleFunc("/", p.handleCDPRequest)

	// Health check endpoint (no auth required)
	mux.HandleFunc("/health", p.handleHealth)

	p.server = &http.Server{
		Addr:    ":" + port,
		Handler: mux,
	}

	// Start server in goroutine
	go func() {
		log.Printf("Starting simplified CDP proxy server on port %s", port)
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

	log.Printf("Simplified CDP proxy ready on port %s", port)
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

// handleCDPRequest handles authentication and routes CDP requests
func (p *CDPProxy) handleCDPRequest(w http.ResponseWriter, r *http.Request) {
	// Extract and validate signing key from query parameters
	signingKey := r.URL.Query().Get("signingKey")
	if signingKey == "" {
		log.Printf("CDP Proxy: Missing signing key for %s %s", r.Method, r.URL.Path)
		http.Error(w, "Unauthorized: Missing signing key", 401)
		return
	}

	// Validate the signing key
	payload, err := utils.ValidateCDPToken(signingKey)
	if err != nil {
		log.Printf("CDP Proxy: Invalid signing key: %v", err)
		http.Error(w, "Unauthorized: Invalid signing key", 401)
		return
	}

	log.Printf("CDP Proxy: Authenticated request for session %s", payload.SessionID)

	// Handle WebSocket vs HTTP requests
	if r.Header.Get("Upgrade") == "websocket" {
		p.handleWebSocketConnection(w, r, payload)
		return
	}

	p.handleHTTPRequest(w, r, payload)
}

// handleWebSocketConnection handles WebSocket connections
func (p *CDPProxy) handleWebSocketConnection(w http.ResponseWriter, r *http.Request, payload *utils.CDPSigningPayload) {
	log.Printf("CDP Proxy: WebSocket connection for session %s", payload.SessionID)

	// Upgrade client connection
	clientConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("CDP Proxy: Failed to upgrade WebSocket: %v", err)
		return
	}
	defer clientConn.Close()

	// Determine Chrome WebSocket endpoint
	chromeEndpoint, err := p.getChromeWebSocketEndpoint(r.URL.Path)
	if err != nil {
		log.Printf("CDP Proxy: Failed to determine Chrome endpoint: %v", err)
		clientConn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseInternalServerErr, "Failed to connect to Chrome"))
		return
	}

	// Connect to Chrome
	chromeConn, _, err := websocket.DefaultDialer.Dial(chromeEndpoint, nil)
	if err != nil {
		log.Printf("CDP Proxy: Failed to connect to Chrome: %v", err)
		clientConn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseInternalServerErr, "Chrome CDP unavailable"))
		return
	}
	defer chromeConn.Close()

	log.Printf("CDP Proxy: WebSocket proxy established for session %s", payload.SessionID)

	// Proxy messages bidirectionally
	p.proxyWebSocketMessages(clientConn, chromeConn)

	log.Printf("CDP Proxy: WebSocket connection closed for session %s", payload.SessionID)
}

// handleHTTPRequest handles HTTP requests to Chrome's JSON API
func (p *CDPProxy) handleHTTPRequest(w http.ResponseWriter, r *http.Request, payload *utils.CDPSigningPayload) {
	// Map request path to Chrome endpoint
	chromeEndpoint := p.getChromeHTTPEndpoint(r.URL.Path)
	targetURL := fmt.Sprintf("http://%s%s", p.chromeAddr, chromeEndpoint)

	// Preserve query parameters (except signingKey)
	if r.URL.RawQuery != "" {
		params, _ := url.ParseQuery(r.URL.RawQuery)
		params.Del("signingKey") // Remove our auth parameter
		if len(params) > 0 {
			targetURL += "?" + params.Encode()
		}
	}

	log.Printf("CDP Proxy: Proxying HTTP %s to %s for session %s", r.Method, targetURL, payload.SessionID)
	p.proxyHTTPRequest(w, r, targetURL)
}

// proxyHTTPRequest proxies HTTP requests to Chrome
func (p *CDPProxy) proxyHTTPRequest(w http.ResponseWriter, r *http.Request, targetURL string) {
	// Create request to Chrome
	req, err := http.NewRequest(r.Method, targetURL, r.Body)
	if err != nil {
		log.Printf("CDP Proxy: Error creating Chrome request: %v", err)
		http.Error(w, "Error creating request to Chrome", 500)
		return
	}

	// Copy relevant headers (exclude auth headers)
	for key, values := range r.Header {
		if key != "Authorization" && !strings.HasPrefix(key, "X-") {
			for _, value := range values {
				req.Header.Add(key, value)
			}
		}
	}

	// Make request to Chrome
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("CDP Proxy: Error requesting from Chrome: %v", err)
		http.Error(w, "Chrome CDP unavailable", 502)
		return
	}
	defer resp.Body.Close()

	// Copy response headers
	for key, values := range resp.Header {
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}

	// Copy status code and body
	w.WriteHeader(resp.StatusCode)
	_, err = io.Copy(w, resp.Body)
	if err != nil {
		log.Printf("CDP Proxy: Error copying response body: %v", err)
	}
}

// proxyWebSocketMessages handles bidirectional WebSocket message proxying
func (p *CDPProxy) proxyWebSocketMessages(clientConn, chromeConn *websocket.Conn) {
	done := make(chan struct{})

	// Client -> Chrome
	go func() {
		defer close(done)
		for {
			messageType, message, err := clientConn.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
					log.Printf("CDP Proxy: Client WebSocket error: %v", err)
				}
				return
			}

			if err := chromeConn.WriteMessage(messageType, message); err != nil {
				log.Printf("CDP Proxy: Error writing to Chrome: %v", err)
				return
			}
		}
	}()

	// Chrome -> Client
	go func() {
		for {
			messageType, message, err := chromeConn.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
					log.Printf("CDP Proxy: Chrome WebSocket error: %v", err)
				}
				return
			}

			if err := clientConn.WriteMessage(messageType, message); err != nil {
				log.Printf("CDP Proxy: Error writing to client: %v", err)
				return
			}
		}
	}()

	// Wait for one direction to close
	<-done
}

// getChromeWebSocketEndpoint determines the correct Chrome WebSocket endpoint
func (p *CDPProxy) getChromeWebSocketEndpoint(requestPath string) (string, error) {
	// If no specific path or root path, get the main page
	if requestPath == "" || requestPath == "/" {
		pageInfo, err := p.getPageInfo()
		if err != nil {
			return "", fmt.Errorf("failed to get page info: %v", err)
		}

		if pageInfo.WebSocketDebuggerUrl != "" {
			return pageInfo.WebSocketDebuggerUrl, nil
		}

		return fmt.Sprintf("ws://%s/devtools/page/%s", p.chromeAddr, pageInfo.ID), nil
	}

	// Direct path mapping
	return fmt.Sprintf("ws://%s%s", p.chromeAddr, requestPath), nil
}

// getChromeHTTPEndpoint maps request paths to Chrome HTTP endpoints
func (p *CDPProxy) getChromeHTTPEndpoint(requestPath string) string {
	switch {
	case requestPath == "" || requestPath == "/" || requestPath == "/json":
		return "/json"
	case strings.HasPrefix(requestPath, "/json/"):
		return requestPath
	case strings.HasPrefix(requestPath, "/devtools/"):
		return requestPath
	default:
		return requestPath
	}
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

	// Find the first page target
	for _, page := range pages {
		if page.Type == "page" {
			return &page, nil
		}
	}

	// Fallback to first target if no page found
	if len(pages) > 0 {
		return &pages[0], nil
	}

	return nil, fmt.Errorf("no pages found")
}

// handleHealth provides simple health check endpoint
func (p *CDPProxy) handleHealth(w http.ResponseWriter, r *http.Request) {
	// Test Chrome connectivity
	_, err := http.Get(fmt.Sprintf("http://%s/json/version", p.chromeAddr))
	if err != nil {
		w.WriteHeader(503)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":    "unhealthy",
			"error":     "Chrome CDP unavailable",
			"timestamp": time.Now(),
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":      "healthy",
		"chrome_addr": p.chromeAddr,
		"timestamp":   time.Now(),
	})
}
