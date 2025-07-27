package main

import (
	"context"
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
)

type Controller struct {
	sessionID string
	rdb       *redis.Client
	chromeCmd *exec.Cmd
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
		rdb:       rdb,
	}

	// Start Chrome with remote debugging
	if err := controller.startChrome(); err != nil {
		log.Fatalf("Failed to start Chrome: %v", err)
	}

	// Wait for Chrome to be ready
	if err := controller.waitForChrome(); err != nil {
		log.Fatalf("Chrome failed to start properly: %v", err)
	}

	// Update session status to ready
	if err := utils.UpdateSessionStatus(context.Background(), rdb, sessionID, "READY"); err != nil {
		log.Printf("Failed to update session status: %v", err)
	}

	log.Printf("Chrome ready for session %s on port 9222", sessionID)

	// Setup graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	// Keep alive and handle shutdown
	<-sigChan
	log.Println("Shutting down controller...")
	controller.shutdown()
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

func (c *Controller) shutdown() {
	log.Printf("Shutting down controller for session %s", c.sessionID)

	// Update session status
	if err := utils.UpdateSessionStatus(context.Background(), c.rdb, c.sessionID, "STOPPED"); err != nil {
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
	if c.rdb != nil {
		c.rdb.Close()
	}

	log.Printf("Controller shutdown complete for session %s", c.sessionID)
} 