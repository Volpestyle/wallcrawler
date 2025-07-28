package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/wallcrawler/backend-go/internal/cdpproxy"

	"github.com/chromedp/cdproto/target"
	"github.com/chromedp/chromedp"
)

type Controller struct {
	sessionID       string
	chromeCmd       *exec.Cmd
	redisClient     *redis.Client
	allocator       context.Context
	allocatorCancel context.CancelFunc
	ctx             context.Context
	cancel          context.CancelFunc
	cdpProxy        *cdpproxy.CDPProxy
}

func main() {
	sessionID := os.Getenv("SESSION_ID")
	if sessionID == "" {
		log.Fatal("SESSION_ID environment variable is required")
	}

	redisAddr := os.Getenv("REDIS_ADDR")
	if redisAddr == "" {
		redisAddr = "localhost:6379"
	}

	// Setup Redis client
	rdb := redis.NewClient(&redis.Options{
		Addr: redisAddr,
	})

	// Test Redis connection
	if err := rdb.Ping(context.Background()).Err(); err != nil {
		log.Fatalf("Failed to connect to Redis: %v", err)
	}

	log.Printf("Starting ECS controller for session %s", sessionID)

	// Create controller
	controller := &Controller{
		sessionID:   sessionID,
		redisClient: rdb,
	}

	// Start Chrome with remote debugging
	if err := controller.startChrome(); err != nil {
		log.Fatalf("Failed to start Chrome: %v", err)
	}

	// Wait for Chrome to be ready
	if err := controller.waitForChrome(); err != nil {
		log.Fatalf("Chrome failed to start properly: %v", err)
	}

	if err := controller.initCDP(); err != nil {
		log.Fatalf("Failed to initialize CDP connection: %v", err)
	}

	// Log Chrome ready status 
	log.Printf("Chrome ready for session %s on port 9222 (PID: %d)", sessionID, controller.chromeCmd.Process.Pid)

	// Start integrated CDP proxy
	if err := controller.startCDPProxy(); err != nil {
		log.Printf("Failed to start CDP proxy: %v", err)
	} else {
		log.Printf("CDP proxy ready for session %s on port 9223", sessionID)
	}

	// Listen for session events (LLM operations)
	go controller.listenForSessionEvents(context.Background())

	// Setup graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	// Keep alive and handle shutdown
	<-sigChan
	log.Println("Shutting down controller...")
	controller.cleanup()
}

func (c *Controller) startChrome() error {
	// Chrome command line arguments for remote debugging
	args := []string{
		"--no-sandbox",
		"--disable-setuid-sandbox",
		"--disable-dev-shm-usage",
		"--disable-gpu",
		"--disable-background-timer-throttling",
		"--disable-backgrounding-occluded-windows",
		"--disable-renderer-backgrounding",
		"--disable-features=TranslateUI",
		"--disable-extensions",
		"--disable-component-extensions-with-background-pages",
		"--disable-default-apps",
		"--disable-web-security",
		"--disable-features=VizDisplayCompositor",
		"--run-all-compositor-stages-before-draw",
		"--disable-background-networking",
		"--enable-features=NetworkService,NetworkServiceLogging",
		"--disable-background-timer-throttling",
		"--disable-renderer-backgrounding",
		"--disable-backgrounding-occluded-windows",
		"--disable-client-side-phishing-detection",
		"--disable-crash-reporter",
		"--disable-oom-killer",
		"--disable-hang-monitor",
		"--disable-prompt-on-repost",
		"--disable-domain-reliability",
		"--disable-component-update",
		"--disable-background-networking",
		"--disable-breakpad",
		// Remote debugging settings - SECURITY: localhost only, proxy will handle external access
		"--remote-debugging-port=9222",
		"--remote-debugging-address=127.0.0.1",
		"--headless=new",
		"--window-size=1920,1080",
		"--virtual-time-budget=5000",
		// Use about:blank as default
		"about:blank",
	}

	// Start Chrome process
	c.chromeCmd = exec.Command("google-chrome", args...)

	// Set environment
	c.chromeCmd.Env = append(os.Environ(),
		"DISPLAY=:99",
		"CHROME_DEVEL_SANDBOX=/opt/google/chrome/chrome-sandbox",
	)

	// Start the process
	if err := c.chromeCmd.Start(); err != nil {
		return fmt.Errorf("failed to start Chrome: %v", err)
	}

	log.Printf("Chrome started with PID %d", c.chromeCmd.Process.Pid)
	return nil
}

func (c *Controller) waitForChrome() error {
	// Wait for Chrome to be ready by checking the DevTools endpoint
	for i := 0; i < 30; i++ { // Wait up to 30 seconds
		resp, err := http.Get("http://localhost:9222/json/version")
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == 200 {
				log.Printf("Chrome DevTools Protocol ready on port 9222")
				return nil
			}
		}
		log.Printf("Waiting for Chrome to be ready... (attempt %d/30)", i+1)
		time.Sleep(1 * time.Second)
	}

	return fmt.Errorf("chrome failed to start within 30 seconds")
}

func (c *Controller) initCDP() error {
	wsURL := "ws://127.0.0.1:9222/devtools/browser"
	c.allocator, c.allocatorCancel = chromedp.NewRemoteAllocator(context.Background(), wsURL)
	tempCtx, tempCancel := chromedp.NewContext(c.allocator)
	defer tempCancel()

	targets, err := target.GetTargets().Do(tempCtx)
	if err != nil {
		return fmt.Errorf("failed to get targets: %v", err)
	}

	var pageTargetID target.ID
	for _, t := range targets {
		if t.Type == "page" {
			pageTargetID = t.TargetID
			break
		}
	}
	if pageTargetID == "" {
		return fmt.Errorf("no page target found")
	}

	c.ctx, c.cancel = chromedp.NewContext(c.allocator, chromedp.WithTargetID(pageTargetID))
	return nil
}

func (c *Controller) startCDPProxy() error {
	// Initialize the integrated CDP proxy
	c.cdpProxy = cdpproxy.NewCDPProxy("127.0.0.1:9222")

	// Get port from environment
	port := os.Getenv("CDP_PROXY_PORT")
	if port == "" {
		port = "9223"
	}

	// Start the CDP proxy
	if err := c.cdpProxy.Start(port); err != nil {
		return fmt.Errorf("failed to start CDP proxy: %v", err)
	}

	log.Printf("Integrated CDP proxy ready for session %s on port %s", c.sessionID, port)
	return nil
}

func (c *Controller) listenForSessionEvents(ctx context.Context) {
	// Subscribe to session events via Redis for LLM operations
	// Events include: extract, observe, navigate, agentExecute, act
	eventChannel := fmt.Sprintf("session:%s:events", c.sessionID)
	pubsub := c.redisClient.Subscribe(ctx, eventChannel)
	defer pubsub.Close()

	log.Printf("Listening for session events on channel: %s", eventChannel)

	for {
		select {
		case <-ctx.Done():
			return
		default:
			msg, err := pubsub.ReceiveMessage(ctx)
			if err != nil {
				log.Printf("Error receiving message: %v", err)
				time.Sleep(1 * time.Second)
				continue
			}

			var event map[string]interface{}
			if err := json.Unmarshal([]byte(msg.Payload), &event); err != nil {
				log.Printf("Error parsing event: %v", err)
				continue
			}

			action, ok := event["action"].(string)
			if !ok {
				continue
			}

			switch action {
			// LLM processing handlers
			case "extract":
				go c.handleExtractRequest(ctx, event)
			case "observe":
				go c.handleObserveRequest(ctx, event)
			case "navigate":
				go c.handleNavigateRequest(ctx, event)
			case "agentExecute":
				go c.handleAgentExecuteRequest(ctx, event)
			case "act":
				go c.handleActRequest(ctx, event)
			}
		}
	}
}

// handleExtractRequest processes data extraction with LLM
func (c *Controller) handleExtractRequest(ctx context.Context, event map[string]interface{}) {
	log.Printf("Processing extract request for session %s", c.sessionID)

	// TODO: Implement actual extraction logic
	// 1. Get accessibility tree via CDP
	// 2. Send to LLM with instruction and schema
	// 3. Parse LLM response
	// 4. Return structured data via Redis pub/sub

	// For now, return placeholder
	result := map[string]interface{}{
		"success": true,
		"data": map[string]interface{}{
			"extracted": "Sample data - implement actual LLM processing",
		},
	}

	c.publishResult(ctx, "extract_result", result)
}

// handleObserveRequest processes DOM observation with LLM
func (c *Controller) handleObserveRequest(ctx context.Context, event map[string]interface{}) {
	log.Printf("Processing observe request for session %s", c.sessionID)

	// TODO: Implement actual observation logic
	// 1. Get accessibility tree via CDP
	// 2. Send to LLM with instruction
	// 3. Parse LLM response for element identification
	// 4. Return element selectors and actions via Redis pub/sub

	// For now, return placeholder
	result := map[string]interface{}{
		"success": true,
		"elements": []map[string]interface{}{
			{
				"selector":    "#sample-element",
				"description": "Sample element - implement actual LLM processing",
				"method":      "click",
				"arguments":   []string{},
			},
		},
	}

	c.publishResult(ctx, "observe_result", result)
}

// handleNavigateRequest processes navigation with options
func (c *Controller) handleNavigateRequest(ctx context.Context, event map[string]interface{}) {
	log.Printf("Processing navigate request for session %s", c.sessionID)

	url, ok := event["url"].(string)
	if !ok {
		log.Printf("Invalid URL in navigate request")
		return
	}

	// TODO: Implement actual navigation logic via CDP
	// 1. Use CDP Page.navigate
	// 2. Wait for page load events
	// 3. Handle navigation options (timeout, waitUntil)
	// 4. Return navigation result via Redis pub/sub

	log.Printf("Navigating to URL: %s", url)

	// For now, return placeholder
	result := map[string]interface{}{
		"success":    true,
		"url":        url,
		"finalUrl":   url,
		"statusCode": 200,
	}

	c.publishResult(ctx, "navigate_result", result)
}

// handleAgentExecuteRequest processes autonomous agent workflows
func (c *Controller) handleAgentExecuteRequest(ctx context.Context, event map[string]interface{}) {
	log.Printf("Processing agent execute request for session %s", c.sessionID)

	// TODO: Implement actual agent execution logic
	// 1. Multi-step workflow with observe -> act cycles
	// 2. LLM planning and decision making
	// 3. Action execution and result evaluation
	// 4. Stream progress updates via Redis pub/sub

	// For now, return placeholder
	result := map[string]interface{}{
		"success":   true,
		"message":   "Agent workflow completed - implement actual LLM processing",
		"actions":   []map[string]interface{}{},
		"completed": true,
	}

	c.publishResult(ctx, "agent_result", result)
}

// handleActRequest processes action execution
func (c *Controller) handleActRequest(ctx context.Context, event map[string]interface{}) {
	log.Printf("Processing act request for session %s", c.sessionID)

	action, ok := event["action"].(string)
	if !ok {
		log.Printf("Invalid action in act request")
		return
	}

	// TODO: Implement actual action execution logic
	// 1. Use observe to find elements based on action description
	// 2. Execute action via CDP
	// 3. Return execution result via Redis pub/sub

	log.Printf("Executing action: %s", action)

	// For now, return placeholder
	result := map[string]interface{}{
		"success": true,
		"message": "Action completed - implement actual LLM processing",
		"action":  action,
	}

	c.publishResult(ctx, "act_result", result)
}

// publishResult publishes operation results via Redis pub/sub
func (c *Controller) publishResult(ctx context.Context, resultType string, result map[string]interface{}) {
	resultChannel := fmt.Sprintf("session:%s:results", c.sessionID)

	resultData := map[string]interface{}{
		"type":      resultType,
		"sessionId": c.sessionID,
		"result":    result,
		"timestamp": time.Now().UnixMilli(),
	}

	resultJSON, err := json.Marshal(resultData)
	if err != nil {
		log.Printf("Error marshaling result: %v", err)
		return
	}

	if err := c.redisClient.Publish(ctx, resultChannel, string(resultJSON)).Err(); err != nil {
		log.Printf("Error publishing result: %v", err)
	}
}

// Native Chrome screencast is now handled via direct CDP connections through the CDP proxy
// Custom frame capture has been removed in favor of Chrome's built-in DevTools screencast
// Clients can connect directly to Chrome's screencast via signed CDP URLs

func (c *Controller) cleanup() {
	log.Printf("Cleaning up controller for session %s", c.sessionID)

	// Shutdown CDP proxy server
	if c.cdpProxy != nil {
		if err := c.cdpProxy.Stop(); err != nil {
			log.Printf("CDP proxy shutdown error: %v", err)
		} else {
			log.Printf("CDP proxy shut down gracefully")
		}
	}

	if c.cancel != nil {
		c.cancel()
	}
	if c.allocatorCancel != nil {
		c.allocatorCancel()
	}

	// ✅ REMOVED: Session status updates are now handled by ecs-task-processor via EventBridge
	// When ECS task stops, ecs-task-processor will update session status to STOPPED

	// Log cleanup completion (no EventBridge needed - was only used for logging)
	log.Printf("Container cleanup completed for session %s (resources cleaned, Chrome shutdown, proxy shutdown)", c.sessionID)

	// Stop Chrome process
	if c.chromeCmd != nil && c.chromeCmd.Process != nil {
		log.Printf("Terminating Chrome process %d", c.chromeCmd.Process.Pid)

		// Try graceful shutdown first
		if err := c.chromeCmd.Process.Signal(syscall.SIGTERM); err != nil {
			log.Printf("Failed to send SIGTERM: %v", err)
		}

		// Wait a bit for graceful shutdown
		done := make(chan error, 1)
		go func() {
			done <- c.chromeCmd.Wait()
		}()

		select {
		case <-time.After(5 * time.Second):
			// Force kill if not stopped gracefully
			log.Printf("Force killing Chrome process")
			c.chromeCmd.Process.Kill()
		case err := <-done:
			if err != nil {
				log.Printf("Chrome process exited with error: %v", err)
			} else {
				log.Printf("Chrome process exited gracefully")
			}
		}
	}

	// Close Redis connection
	if c.redisClient != nil {
		c.redisClient.Close()
	}

	log.Printf("Controller shutdown complete for session %s", c.sessionID)
}
