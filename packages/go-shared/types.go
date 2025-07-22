package shared

import (
	"time"
	"github.com/golang-jwt/jwt/v5"
)

// Common session and connection types

// SessionOptions represents browser session configuration
type SessionOptions struct {
	Viewport     *Viewport         `json:"viewport,omitempty"`
	UserAgent    string            `json:"userAgent,omitempty"`
	Locale       string            `json:"locale,omitempty"`
	TimezoneID   string            `json:"timezoneId,omitempty"`
	ExtraHeaders map[string]string `json:"extraHTTPHeaders,omitempty"`
}

// Viewport represents browser viewport settings
type Viewport struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

// JWTClaims represents the JWT token claims structure
type JWTClaims struct {
	SessionID       string                 `json:"sessionId"`
	UserID          string                 `json:"userId"`
	BrowserSettings map[string]interface{} `json:"browserSettings,omitempty"`
	jwt.RegisteredClaims
}

// ConnectionMapping represents a WebSocket connection mapping
type ConnectionMapping struct {
	SessionID    string `json:"sessionId"`
	ConnectedAt  string `json:"connectedAt"`
	LastActivity string `json:"lastActivity"`
}

// WebSocketMessage represents incoming WebSocket messages
type WebSocketMessage struct {
	Type      string      `json:"type"`
	ID        *int        `json:"id,omitempty"`
	Method    string      `json:"method,omitempty"`
	Params    interface{} `json:"params,omitempty"`
	SessionID string      `json:"sessionId,omitempty"`
	Data      interface{} `json:"data,omitempty"`
	Event     interface{} `json:"event,omitempty"`
}

// ResponseMessage represents outgoing WebSocket response messages
type ResponseMessage struct {
	Type      string      `json:"type"`
	ID        *int        `json:"id,omitempty"`
	Result    interface{} `json:"result,omitempty"`
	Error     string      `json:"error,omitempty"`
	Timestamp string      `json:"timestamp,omitempty"`
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

// Screencast types

// ScreencastOptions represents screencast configuration
type ScreencastOptions struct {
	Quality       int  `json:"quality,omitempty"`
	EveryNthFrame int  `json:"everyNthFrame,omitempty"`
	DetectIdle    bool `json:"detectIdle,omitempty"`
	IdleThreshold int  `json:"idleThreshold,omitempty"`
	MaxWidth      int  `json:"maxWidth,omitempty"`
	MaxHeight     int  `json:"maxHeight,omitempty"`
}

// ScreencastMetadata represents frame metadata
type ScreencastMetadata struct {
	OffsetTop       float64 `json:"offsetTop"`
	PageScaleFactor float64 `json:"pageScaleFactor"`
	DeviceWidth     int     `json:"deviceWidth"`
	DeviceHeight    int     `json:"deviceHeight"`
	ScrollOffsetX   float64 `json:"scrollOffsetX"`
	ScrollOffsetY   float64 `json:"scrollOffsetY"`
	Timestamp       int64   `json:"timestamp"`
}

// ScreencastFrame represents a screencast frame
type ScreencastFrame struct {
	Data      string             `json:"data"`
	Metadata  ScreencastMetadata `json:"metadata"`
	SessionID string             `json:"sessionId"`
	FrameID   int                `json:"frameId"`
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

// Session represents a browser session
type Session struct {
	ID           string                 `json:"id"`
	UserID       string                 `json:"userId"`
	LastActivity time.Time              `json:"lastActivity"`
	Options      SessionOptions         `json:"options"`
	Status       string                 `json:"status"`
	CreatedAt    time.Time              `json:"createdAt"`
}

// API Response types

// ErrorResponse represents a standard error response
type ErrorResponse struct {
	Success bool   `json:"success"`
	Error   string `json:"error"`
	Details string `json:"details,omitempty"`
}

// SuccessResponse represents a standard success response
type SuccessResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
} 