package main

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/s3/manager"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	dynamotypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/aws/aws-sdk-go-v2/service/ecs"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/wallcrawler/backend-go/internal/cdpproxy"

	"github.com/chromedp/cdproto/target"
	"github.com/chromedp/chromedp"
)

type Controller struct {
	sessionID         string
	ddbClient         *dynamodb.Client
	ecsClient         *ecs.Client
	s3Client          *s3.Client
	cdpProxy          *cdpproxy.CDPProxy
	chromeCmd         *exec.Cmd
	disconnectTimeout time.Duration
	shutdownRequested bool
	mu                sync.Mutex
	allocator         context.Context
	allocatorCancel   context.CancelFunc
	ctx               context.Context
	cancel            context.CancelFunc
	contextID         string
	contextsBucket    string
	contextS3Key      string
	contextPersist    bool
	contextEnabled    bool
	profileDir        string
}

func main() {
	sessionID := os.Getenv("SESSION_ID")
	if sessionID == "" {
		log.Fatal("SESSION_ID environment variable is required")
	}

	// Setup AWS config
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		log.Fatalf("Failed to load AWS config: %v", err)
	}

	// Parse disconnect timeout
	disconnectTimeout, _ := time.ParseDuration(os.Getenv("CDP_DISCONNECT_TIMEOUT") + "s")
	if disconnectTimeout == 0 {
		disconnectTimeout = 2 * time.Minute
	}

	log.Printf("Starting ECS controller for session %s", sessionID)

	// Create controller
	controller := &Controller{
		sessionID:         sessionID,
		ddbClient:         dynamodb.NewFromConfig(cfg),
		ecsClient:         ecs.NewFromConfig(cfg),
		disconnectTimeout: disconnectTimeout,
	}
	controller.s3Client = s3.NewFromConfig(cfg)
	controller.contextID = os.Getenv("CONTEXT_ID")
	controller.contextsBucket = os.Getenv("CONTEXTS_BUCKET_NAME")
	controller.contextS3Key = os.Getenv("CONTEXT_S3_KEY")
	controller.contextPersist = strings.EqualFold(os.Getenv("CONTEXT_PERSIST"), "true")
	controller.profileDir = "/home/wallcrawler/.config/chrome-profile"

	if controller.contextID != "" && controller.contextsBucket != "" && controller.contextS3Key != "" {
		controller.contextEnabled = true
	}

	if err := controller.prepareContext(context.Background()); err != nil {
		log.Fatalf("Failed to prepare browser context: %v", err)
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

	// Set disconnect callback
	controller.cdpProxy.SetOnDisconnect(func() {
		log.Printf("CDP proxy reported disconnect")
	})

	// Start health monitor
	ctx := context.Background()
	go controller.startHealthMonitor(ctx)

	// Listen for session events (LLM operations)
	go controller.listenForSessionEvents(ctx)

	// Setup graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	// Keep alive and handle shutdown
	<-sigChan
	log.Println("Shutting down controller...")
	controller.cleanup()
}

func (c *Controller) prepareContext(ctx context.Context) error {
	if c.profileDir == "" {
		return nil
	}

	if err := os.RemoveAll(c.profileDir); err != nil {
		return err
	}
	if err := os.MkdirAll(c.profileDir, 0o755); err != nil {
		return err
	}

	if !c.contextEnabled {
		return nil
	}

	tmpFile, err := os.CreateTemp("", "context-*.tar.gz")
	if err != nil {
		return err
	}
	defer func() {
		tmpFile.Close()
		os.Remove(tmpFile.Name())
	}()

	downloader := manager.NewDownloader(c.s3Client)
	_, err = downloader.Download(ctx, tmpFile, &s3.GetObjectInput{
		Bucket: aws.String(c.contextsBucket),
		Key:    aws.String(c.contextS3Key),
	})
	if err != nil {
		var notFound *s3types.NoSuchKey
		if errors.As(err, &notFound) {
			log.Printf("No existing context archive for %s, starting fresh profile", c.contextID)
			return nil
		}
		return err
	}

	if err := tmpFile.Close(); err != nil {
		return err
	}

	if err := extractTarGz(tmpFile.Name(), c.profileDir); err != nil {
		return err
	}

	log.Printf("Loaded browser context %s from S3", c.contextID)
	return nil
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
	}

	if c.contextEnabled && c.profileDir != "" {
		args = append(args, fmt.Sprintf("--user-data-dir=%s", c.profileDir))
	}

	// Use about:blank as default
	args = append(args, "about:blank")

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

// startHealthMonitor monitors CDP connection health and triggers shutdown after timeout
func (c *Controller) startHealthMonitor(ctx context.Context) {
	checkInterval, _ := time.ParseDuration(os.Getenv("CDP_HEALTH_CHECK_INTERVAL") + "s")
	if checkInterval == 0 {
		checkInterval = 10 * time.Second
	}

	ticker := time.NewTicker(checkInterval)
	defer ticker.Stop()

	var disconnectedSince *time.Time

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.mu.Lock()
			if c.shutdownRequested {
				c.mu.Unlock()
				return
			}
			c.mu.Unlock()

			if c.cdpProxy.IsConnected() {
				// Connection is active, reset timer
				if disconnectedSince != nil {
					log.Printf("CDP connection restored")
					disconnectedSince = nil
				}
			} else {
				// No connection
				if disconnectedSince == nil {
					disconnectedSince = &time.Time{}
					*disconnectedSince = time.Now()
					log.Printf("CDP connection lost, starting %v disconnect timer", c.disconnectTimeout)
				} else {
					elapsed := time.Since(*disconnectedSince)
					if elapsed > c.disconnectTimeout {
						log.Printf("CDP disconnected for %v, initiating self-termination", elapsed)
						c.initiateShutdown(ctx)
						return
					}
					log.Printf("CDP disconnected for %v / %v", elapsed, c.disconnectTimeout)
				}
			}
		}
	}
}

// initiateShutdown performs graceful shutdown and updates DynamoDB
func (c *Controller) initiateShutdown(ctx context.Context) {
	c.mu.Lock()
	if c.shutdownRequested {
		c.mu.Unlock()
		return
	}
	c.shutdownRequested = true
	c.mu.Unlock()

	log.Printf("Initiating graceful shutdown for session %s", c.sessionID)

	// Update session status in DynamoDB
	tableName := os.Getenv("SESSIONS_TABLE_NAME")
	if tableName != "" {
		updateCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		_, err := c.ddbClient.UpdateItem(updateCtx, &dynamodb.UpdateItemInput{
			TableName: aws.String(tableName),
			Key: map[string]dynamotypes.AttributeValue{
				"sessionId": &dynamotypes.AttributeValueMemberS{Value: c.sessionID},
			},
			UpdateExpression: aws.String("SET #status = :status, updatedAt = :now"),
			ExpressionAttributeNames: map[string]string{
				"#status": "status",
			},
			ExpressionAttributeValues: map[string]dynamotypes.AttributeValue{
				":status": &dynamotypes.AttributeValueMemberS{Value: "STOPPED"},
				":now":    &dynamotypes.AttributeValueMemberN{Value: strconv.FormatInt(time.Now().Unix(), 10)},
			},
		})

		if err != nil {
			log.Printf("Error updating session status: %v", err)
		}
	} else {
		log.Printf("Sessions table name not configured; skipping status update")
	}

	// Cleanup and exit
	c.cleanup()

	// Exit cleanly - ECS will detect task exit
	os.Exit(0)
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
	// In the DynamoDB architecture, LLM operations are handled by Lambda functions
	// The ECS controller only manages Chrome and CDP proxy
	// This function is kept for future extensibility
	log.Printf("ECS controller ready for session %s", c.sessionID)

	// Just keep the goroutine alive
	<-ctx.Done()

}

// Native Chrome screencast is now handled via direct CDP connections through the CDP proxy
// LLM operations are handled by Lambda functions, not the ECS controller

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

	// Note: Session status was already updated in initiateShutdown if this was a health monitor termination
	// For other terminations (SIGTERM, etc), the ecs-task-processor will handle status updates

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

	if c.contextEnabled && c.contextPersist && c.contextsBucket != "" && c.contextS3Key != "" {
		if err := c.persistContext(context.Background()); err != nil {
			log.Printf("error persisting browser context: %v", err)
		} else {
			log.Printf("Persisted browser context %s to S3", c.contextID)
		}
	}

	// AWS SDK clients don't need explicit cleanup

	log.Printf("Controller shutdown complete for session %s", c.sessionID)
}

func (c *Controller) persistContext(ctx context.Context) error {
	if c.profileDir == "" {
		return nil
	}

	archivePath, err := createTarGz(c.profileDir)
	if err != nil {
		return err
	}
	defer os.Remove(archivePath)

	file, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer file.Close()

	uploader := manager.NewUploader(c.s3Client)
	_, err = uploader.Upload(ctx, &s3.PutObjectInput{
		Bucket: aws.String(c.contextsBucket),
		Key:    aws.String(c.contextS3Key),
		Body:   file,
	})
	return err
}

func createTarGz(srcDir string) (string, error) {
	archiveFile, err := os.CreateTemp("", "context-*.tar.gz")
	if err != nil {
		return "", err
	}

	gzipWriter := gzip.NewWriter(archiveFile)
	tarWriter := tar.NewWriter(gzipWriter)

	err = filepath.Walk(srcDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		relPath, err := filepath.Rel(srcDir, path)
		if err != nil {
			return err
		}
		if relPath == "." {
			return nil
		}

		header, err := tar.FileInfoHeader(info, "")
		if err != nil {
			return err
		}
		header.Name = relPath

		if err := tarWriter.WriteHeader(header); err != nil {
			return err
		}

		if info.IsDir() {
			return nil
		}

		file, err := os.Open(path)
		if err != nil {
			return err
		}
		_, err = io.Copy(tarWriter, file)
		file.Close()
		if err != nil {
			return err
		}

		return nil
	})

	tarWriter.Close()
	gzipWriter.Close()
	archiveFile.Close()

	if err != nil {
		os.Remove(archiveFile.Name())
		return "", err
	}

	return archiveFile.Name(), nil
}

func extractTarGz(archivePath, destination string) error {
	if err := os.MkdirAll(destination, 0o755); err != nil {
		return err
	}

	file, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer file.Close()

	gzipReader, err := gzip.NewReader(file)
	if err != nil {
		return err
	}
	defer gzipReader.Close()

	tarReader := tar.NewReader(gzipReader)

	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}

		targetPath := filepath.Join(destination, header.Name)

		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(targetPath, os.FileMode(header.Mode)); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
				return err
			}
			outFile, err := os.OpenFile(targetPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, os.FileMode(header.Mode))
			if err != nil {
				return err
			}
			if _, err := io.Copy(outFile, tarReader); err != nil {
				outFile.Close()
				return err
			}
			outFile.Close()
		}
	}

	return nil
}
