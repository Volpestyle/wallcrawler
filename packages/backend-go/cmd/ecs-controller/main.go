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
	"github.com/wallcrawler/backend-go/internal/utils"

	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/cdproto/target"
	"github.com/chromedp/chromedp"
)

type Controller struct {
	sessionID       string
	chromeCmd       *exec.Cmd
	redisClient     *redis.Client
	frameCapture    bool
	captureCancel   context.CancelFunc
	allocator       context.Context
	allocatorCancel context.CancelFunc
	ctx             context.Context
	cancel          context.CancelFunc
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
		sessionID: sessionID,
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

	// Update session status to ready
	if err := utils.UpdateSessionStatus(context.Background(), rdb, sessionID, "READY"); err != nil {
		log.Printf("Failed to update session status: %v", err)
	}

	log.Printf("Chrome ready for session %s on port 9222", sessionID)

	// Listen for frame capture events
	go controller.listenForCaptureEvents(context.Background())

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
		// Remote debugging settings - key for Direct Mode
		"--remote-debugging-port=9222",
		"--remote-debugging-address=0.0.0.0",
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

	return fmt.Errorf("Chrome failed to start within 30 seconds")
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

func (c *Controller) listenForCaptureEvents(ctx context.Context) {
	// Subscribe to EventBridge events via Redis (simplified for this implementation)
	// In production, you might use AWS EventBridge directly or Redis Streams
	eventChannel := fmt.Sprintf("session:%s:events", c.sessionID)
	pubsub := c.redisClient.Subscribe(ctx, eventChannel)
	defer pubsub.Close()

	log.Printf("Listening for capture events on channel: %s", eventChannel)

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
			case "start_capture":
				if !c.frameCapture {
					frameRate := 30 // Default frame rate
					if fr, ok := event["frameRate"].(float64); ok {
						frameRate = int(fr)
					}
					c.startFrameCapture(context.Background(), frameRate)
				}
			case "stop_capture":
				if c.frameCapture {
					c.stopFrameCapture()
				}
			}
		}
	}
}

func (c *Controller) startFrameCapture(parentCtx context.Context, frameRate int) {
	if c.frameCapture {
		return // Already capturing
	}

	log.Printf("Starting frame capture at %d FPS for session %s", frameRate, c.sessionID)
	c.frameCapture = true

	captureCtx, cancel := context.WithCancel(parentCtx)
	c.captureCancel = cancel

	assumedFPS := 60
	everyNth := assumedFPS / frameRate
	if everyNth < 1 {
		everyNth = 1
	}

	action := page.StartScreencast().
		WithFormat(page.ScreencastFormatJpeg).
		WithQuality(80).
		WithMaxWidth(1920).
		WithMaxHeight(1080).
		WithEveryNthFrame(int64(everyNth))
	err := chromedp.Run(c.ctx, action)
	if err != nil {
		log.Printf("Failed to start screencast: %v", err)
		c.stopFrameCapture()
		return
	}

	chromedp.ListenTarget(c.ctx, func(ev interface{}) {
		if f, ok := ev.(*page.EventScreencastFrame); ok {
			go func(frame *page.EventScreencastFrame) {
				base64Data := frame.Data
				frameData := map[string]interface{}{
					"type":      "frame",
					"data":      base64Data,
					"timestamp": time.Time(*frame.Metadata.Timestamp).UnixMilli(),
				}

				websocketEndpoint := os.Getenv("WEBSOCKET_API_ENDPOINT")
				if websocketEndpoint == "" {
					log.Printf("WEBSOCKET_API_ENDPOINT not configured")
					return
				}

				if err := utils.BroadcastToSessionViewers(context.Background(), c.redisClient, c.sessionID, frameData, websocketEndpoint); err != nil {
					log.Printf("Error broadcasting frame: %v", err)
				}

				if err := chromedp.Run(c.ctx, page.ScreencastFrameAck(frame.SessionID)); err != nil {
					log.Printf("Error acking frame: %v", err)
				}
			}(f)
		}
	})

	go func() {
		<-captureCtx.Done()
		if err := chromedp.Run(c.ctx, page.StopScreencast()); err != nil {
			log.Printf("Error stopping screencast: %v", err)
		}
		c.frameCapture = false
		log.Printf("Frame capture stopped for session %s", c.sessionID)
	}()
}

func (c *Controller) stopFrameCapture() {
	if !c.frameCapture {
		return
	}

	log.Printf("Stopping frame capture for session %s", c.sessionID)

	if c.captureCancel != nil {
		c.captureCancel()
		c.captureCancel = nil
	}
}

func (c *Controller) cleanup() {
	log.Printf("Cleaning up controller for session %s", c.sessionID)

	// Stop frame capture
	c.stopFrameCapture()

	if c.cancel != nil {
		c.cancel()
	}
	if c.allocatorCancel != nil {
		c.allocatorCancel()
	}

	// Update session status
	if err := utils.UpdateSessionStatus(context.Background(), c.redisClient, c.sessionID, "STOPPED"); err != nil {
		log.Printf("Failed to update session status: %v", err)
	}

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