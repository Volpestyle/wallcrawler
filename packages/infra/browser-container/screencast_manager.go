package main

import (
	"context"
	"crypto/md5"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// ScreencastOptions represents screencast configuration
type ScreencastOptions struct {
	Quality        int  `json:"quality,omitempty"`
	EveryNthFrame  int  `json:"everyNthFrame,omitempty"`
	DetectIdle     bool `json:"detectIdle,omitempty"`
	IdleThreshold  int  `json:"idleThreshold,omitempty"`
	MaxWidth       int  `json:"maxWidth,omitempty"`
	MaxHeight      int  `json:"maxHeight,omitempty"`
}

// ScreencastMetadata represents frame metadata
type ScreencastMetadata struct {
	OffsetTop      float64 `json:"offsetTop"`
	PageScaleFactor float64 `json:"pageScaleFactor"`
	DeviceWidth    int     `json:"deviceWidth"`
	DeviceHeight   int     `json:"deviceHeight"`
	ScrollOffsetX  float64 `json:"scrollOffsetX"`
	ScrollOffsetY  float64 `json:"scrollOffsetY"`
	Timestamp      int64   `json:"timestamp"`
}

// ScreencastFrame represents a screencast frame
type ScreencastFrame struct {
	Data      string             `json:"data"`
	Metadata  ScreencastMetadata `json:"metadata"`
	SessionID string             `json:"sessionId"`
	FrameID   int                `json:"frameId"`
}

// FrameDetectionState tracks frame detection for idle detection
type FrameDetectionState struct {
	LastFrameHash   string                `json:"lastFrameHash"`
	IdleFrameCount  int                   `json:"idleFrameCount"`
	LastForcedTime  int64                 `json:"lastForcedTime"`
	Options         ScreencastOptions     `json:"options"`
}

// ScreencastStats tracks performance statistics
type ScreencastStats struct {
	FramesSent       int     `json:"framesSent"`
	FramesSkipped    int     `json:"framesSkipped"`
	BytesTransmitted int64   `json:"bytesTransmitted"`
	AverageFrameSize int     `json:"averageFrameSize"`
	ActualFPS        float64 `json:"actualFps"`
	SkipPercentage   float64 `json:"skipPercentage"`
}

// ScreencastSession represents an active screencast session
type ScreencastSession struct {
	SessionID       string                   `json:"sessionId"`
	WebSocketConn   *websocket.Conn          `json:"-"`
	Context         context.Context          `json:"-"`
	Cancel          context.CancelFunc       `json:"-"`
	Options         ScreencastOptions        `json:"options"`
	Stats           ScreencastStats          `json:"stats"`
	DetectionState  FrameDetectionState      `json:"detectionState"`
	FrameCounter    int                      `json:"frameCounter"`
	StartTime       time.Time                `json:"startTime"`
	LastFrameTime   time.Time                `json:"lastFrameTime"`
	mutex           sync.RWMutex             `json:"-"`
}

// ScreencastManager manages screencast sessions
type ScreencastManager struct {
	sessions      map[string]*ScreencastSession
	sessionsMutex sync.RWMutex
}

// NewScreencastManager creates a new screencast manager
func NewScreencastManager() *ScreencastManager {
	return &ScreencastManager{
		sessions: make(map[string]*ScreencastSession),
	}
}

// StartScreencast starts screencasting for a session
func (sm *ScreencastManager) StartScreencast(sessionID string, wsConn *websocket.Conn, options *ScreencastOptions) error {
	sm.sessionsMutex.Lock()
	defer sm.sessionsMutex.Unlock()

	// Check if screencast is already active for this session
	if _, exists := sm.sessions[sessionID]; exists {
		return fmt.Errorf("screencast already active for session %s", sessionID)
	}

	// Set default options
	if options == nil {
		options = &ScreencastOptions{
			Quality:       80,
			EveryNthFrame: 1,
			DetectIdle:    true,
			IdleThreshold: 5,
			MaxWidth:      1920,
			MaxHeight:     1080,
		}
	}

	// Create session context
	ctx, cancel := context.WithCancel(context.Background())

	session := &ScreencastSession{
		SessionID:     sessionID,
		WebSocketConn: wsConn,
		Context:       ctx,
		Cancel:        cancel,
		Options:       *options,
		Stats:         ScreencastStats{},
		DetectionState: FrameDetectionState{
			Options: *options,
		},
		FrameCounter:  0,
		StartTime:     time.Now(),
		LastFrameTime: time.Now(),
	}

	sm.sessions[sessionID] = session

	// Start the screencast goroutine
	go sm.captureFrames(session)

	log.Printf("Screencast started for session: %s", sessionID)
	return nil
}

// StopScreencast stops screencasting for a session
func (sm *ScreencastManager) StopScreencast(sessionID string) error {
	sm.sessionsMutex.Lock()
	defer sm.sessionsMutex.Unlock()

	session, exists := sm.sessions[sessionID]
	if !exists {
		return fmt.Errorf("no active screencast for session %s", sessionID)
	}

	// Cancel the context to stop the capture goroutine
	session.Cancel()

	// Send final stats
	sm.sendScreencastStats(session)

	// Remove from sessions
	delete(sm.sessions, sessionID)

	log.Printf("Screencast stopped for session: %s", sessionID)
	return nil
}

// IsScreencastActive checks if screencast is active for a session
func (sm *ScreencastManager) IsScreencastActive(sessionID string) bool {
	sm.sessionsMutex.RLock()
	defer sm.sessionsMutex.RUnlock()
	_, exists := sm.sessions[sessionID]
	return exists
}

// GetScreencastStats returns stats for a session
func (sm *ScreencastManager) GetScreencastStats(sessionID string) (*ScreencastStats, error) {
	sm.sessionsMutex.RLock()
	defer sm.sessionsMutex.RUnlock()

	session, exists := sm.sessions[sessionID]
	if !exists {
		return nil, fmt.Errorf("no active screencast for session %s", sessionID)
	}

	session.mutex.RLock()
	defer session.mutex.RUnlock()
	stats := session.Stats
	return &stats, nil
}

// captureFrames is the main capture loop for a screencast session
func (sm *ScreencastManager) captureFrames(session *ScreencastSession) {
	defer func() {
		log.Printf("Capture loop ended for session: %s", session.SessionID)
	}()

	// Calculate frame interval (FPS = 30, so ~33ms between frames)
	frameInterval := time.Millisecond * 33

	ticker := time.NewTicker(frameInterval)
	defer ticker.Stop()

	for {
		select {
		case <-session.Context.Done():
			return
		case <-ticker.C:
			if err := sm.captureAndSendFrame(session); err != nil {
				log.Printf("Error capturing frame for session %s: %v", session.SessionID, err)
				// Continue on error - don't stop the entire screencast
			}
		}
	}
}

// captureAndSendFrame captures a single frame and sends it via WebSocket
func (sm *ScreencastManager) captureAndSendFrame(session *ScreencastSession) error {
	session.mutex.Lock()
	defer session.mutex.Unlock()

	// Check if we should skip this frame based on everyNthFrame
	if session.FrameCounter%session.Options.EveryNthFrame != 0 {
		session.FrameCounter++
		session.Stats.FramesSkipped++
		return nil
	}

	// Simulate frame capture (in real implementation, this would use chromedp)
	frameData := sm.simulateFrameCapture(session)

	// Check for idle detection if enabled
	if session.Options.DetectIdle && sm.isFrameIdle(session, frameData) {
		session.Stats.FramesSkipped++
		return nil
	}

	// Create frame metadata
	metadata := ScreencastMetadata{
		OffsetTop:       0,
		PageScaleFactor: 1.0,
		DeviceWidth:     session.Options.MaxWidth,
		DeviceHeight:    session.Options.MaxHeight,
		ScrollOffsetX:   0,
		ScrollOffsetY:   0,
		Timestamp:       time.Now().UnixMilli(),
	}

	// Create screencast frame
	frame := ScreencastFrame{
		Data:      frameData,
		Metadata:  metadata,
		SessionID: session.SessionID,
		FrameID:   session.FrameCounter,
	}

	// Send frame via WebSocket
	if err := sm.sendFrame(session, frame); err != nil {
		return err
	}

	// Update stats
	session.Stats.FramesSent++
	session.Stats.BytesTransmitted += int64(len(frameData))
	session.FrameCounter++
	session.LastFrameTime = time.Now()

	// Calculate average frame size
	if session.Stats.FramesSent > 0 {
		session.Stats.AverageFrameSize = int(session.Stats.BytesTransmitted / int64(session.Stats.FramesSent))
	}

	// Calculate actual FPS
	elapsed := time.Since(session.StartTime).Seconds()
	if elapsed > 0 {
		session.Stats.ActualFPS = float64(session.Stats.FramesSent) / elapsed
	}

	// Calculate skip percentage
	totalFrames := session.Stats.FramesSent + session.Stats.FramesSkipped
	if totalFrames > 0 {
		session.Stats.SkipPercentage = float64(session.Stats.FramesSkipped) / float64(totalFrames) * 100
	}

	return nil
}

// simulateFrameCapture simulates frame capture (placeholder for chromedp implementation)
func (sm *ScreencastManager) simulateFrameCapture(session *ScreencastSession) string {
	// In real implementation, this would use chromedp to capture a screenshot
	// For now, return a placeholder base64 encoded image
	placeholder := fmt.Sprintf("frame-%s-%d", session.SessionID, session.FrameCounter)
	return base64.StdEncoding.EncodeToString([]byte(placeholder))
}

// isFrameIdle checks if the current frame is idle (same as previous frame)
func (sm *ScreencastManager) isFrameIdle(session *ScreencastSession, frameData string) bool {
	// Calculate frame hash for comparison
	hasher := md5.New()
	hasher.Write([]byte(frameData))
	frameHash := fmt.Sprintf("%x", hasher.Sum(nil))

	// Compare with last frame
	if session.DetectionState.LastFrameHash == frameHash {
		session.DetectionState.IdleFrameCount++
		
		// Check if we've exceeded idle threshold
		if session.DetectionState.IdleFrameCount >= session.Options.IdleThreshold {
			// Check if we should force a frame (e.g., every 5 seconds)
			now := time.Now().UnixMilli()
			if now-session.DetectionState.LastForcedTime > 5000 {
				session.DetectionState.LastForcedTime = now
				session.DetectionState.IdleFrameCount = 0
				return false // Send this frame
			}
			return true // Skip this frame
		}
	} else {
		// Frame changed, reset idle count
		session.DetectionState.IdleFrameCount = 0
		session.DetectionState.LastFrameHash = frameHash
	}

	return false
}

// sendFrame sends a frame via WebSocket
func (sm *ScreencastManager) sendFrame(session *ScreencastSession, frame ScreencastFrame) error {
	if session.WebSocketConn == nil {
		return fmt.Errorf("no WebSocket connection for session %s", session.SessionID)
	}

	message := map[string]interface{}{
		"type":    "SCREENCAST_FRAME",
		"frame":   frame,
		"stats":   session.Stats,
	}

	return session.WebSocketConn.WriteJSON(message)
}

// sendScreencastStats sends final stats when screencast stops
func (sm *ScreencastManager) sendScreencastStats(session *ScreencastSession) {
	if session.WebSocketConn == nil {
		return
	}

	message := map[string]interface{}{
		"type":      "SCREENCAST_STATS",
		"sessionId": session.SessionID,
		"stats":     session.Stats,
		"duration":  time.Since(session.StartTime).Seconds(),
	}

	session.WebSocketConn.WriteJSON(message)
}

// HandleInput handles user input events for screencast sessions
func (sm *ScreencastManager) HandleInput(sessionID string, event *InputEvent) error {
	sm.sessionsMutex.RLock()
	session, exists := sm.sessions[sessionID]
	sm.sessionsMutex.RUnlock()

	if !exists {
		return fmt.Errorf("no active screencast for session %s", sessionID)
	}

	// Send input event notification
	if session.WebSocketConn != nil {
		message := map[string]interface{}{
			"type":      "INPUT_EVENT",
			"sessionId": sessionID,
			"event":     event,
		}
		session.WebSocketConn.WriteJSON(message)
	}

	return nil
}

// Methods referenced in main.go that need to be implemented
func (c *MultiSessionContainer) handleStartScreencast(w http.ResponseWriter, r *http.Request) {
	// Extract session ID from URL path
	sessionID := extractSessionIDFromPath(r.URL.Path, "/sessions/", "/start-screencast")
	if sessionID == "" {
		http.Error(w, "Invalid session ID", http.StatusBadRequest)
		return
	}

	// Parse options from request body
	var options ScreencastOptions
	if err := json.NewDecoder(r.Body).Decode(&options); err != nil {
		// Use default options if parsing fails
		options = ScreencastOptions{
			Quality:       80,
			EveryNthFrame: 1,
			DetectIdle:    true,
			IdleThreshold: 5,
			MaxWidth:      1920,
			MaxHeight:     1080,
		}
	}

	// Get the WebSocket connection for this session
	c.sessionWSMutex.RLock()
	wsConn, exists := c.sessionWS[sessionID]
	c.sessionWSMutex.RUnlock()

	if !exists {
		http.Error(w, "No WebSocket connection for session", http.StatusBadRequest)
		return
	}

	// Start screencast
	if err := c.screencastMgr.StartScreencast(sessionID, wsConn, &options); err != nil {
		http.Error(w, fmt.Sprintf("Failed to start screencast: %v", err), http.StatusInternalServerError)
		return
	}

	// Return success response with WebSocket URL
	response := map[string]interface{}{
		"success":       true,
		"sessionId":     sessionID,
		"screencastUrl": fmt.Sprintf("ws://localhost:%d/internal/ws?token=your-token", Port),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (c *MultiSessionContainer) handleStopScreencast(w http.ResponseWriter, r *http.Request) {
	// Extract session ID from URL path
	sessionID := extractSessionIDFromPath(r.URL.Path, "/sessions/", "/stop-screencast")
	if sessionID == "" {
		http.Error(w, "Invalid session ID", http.StatusBadRequest)
		return
	}

	// Stop screencast
	if err := c.screencastMgr.StopScreencast(sessionID); err != nil {
		http.Error(w, fmt.Sprintf("Failed to stop screencast: %v", err), http.StatusInternalServerError)
		return
	}

	response := map[string]interface{}{
		"success":   true,
		"sessionId": sessionID,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (c *MultiSessionContainer) handleStartScreencastMessage(conn *websocket.Conn, msg *InternalMessage) {
	options := ScreencastOptions{
		Quality:       80,
		EveryNthFrame: 1,
		DetectIdle:    true,
		IdleThreshold: 5,
		MaxWidth:      1920,
		MaxHeight:     1080,
	}

	if msg.Params != nil {
		// Parse options from params
		if quality, ok := msg.Params["quality"].(float64); ok {
			options.Quality = int(quality)
		}
		if everyNth, ok := msg.Params["everyNthFrame"].(float64); ok {
			options.EveryNthFrame = int(everyNth)
		}
	}

	if err := c.screencastMgr.StartScreencast(msg.SessionID, conn, &options); err != nil {
		conn.WriteJSON(map[string]interface{}{
			"type":      "SCREENCAST_ERROR",
			"sessionId": msg.SessionID,
			"error":     err.Error(),
		})
	}
}

func (c *MultiSessionContainer) handleStopScreencastMessage(msg *InternalMessage) {
	c.screencastMgr.StopScreencast(msg.SessionID)
}

func (c *MultiSessionContainer) handleInputEvent(msg *InternalMessage) {
	if msg.Event != nil {
		c.screencastMgr.HandleInput(msg.SessionID, msg.Event)
	}
}

// Helper function to extract session ID from URL path
func extractSessionIDFromPath(path, prefix, suffix string) string {
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return ""
	}
	start := len(prefix)
	end := len(path) - len(suffix)
	if start >= end {
		return ""
	}
	return path[start:end]
} 