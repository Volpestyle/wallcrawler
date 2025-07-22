package validation

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/aws/aws-lambda-go/events"
)

// ValidateSessionID validates session ID format
func ValidateSessionID(sessionID string) error {
	if sessionID == "" {
		return fmt.Errorf("session ID is required")
	}

	// Session IDs should match pattern: ses_timestamp_randomstring
	matched, _ := regexp.MatchString(`^ses_\d+_[a-z0-9]+$`, sessionID)
	if !matched {
		return fmt.Errorf("invalid session ID format")
	}

	return nil
}

// ValidateBrowserSettings validates browser settings from request
func ValidateBrowserSettings(settings map[string]interface{}) error {
	if settings == nil {
		return nil // Browser settings are optional
	}

	// Validate viewport if present
	if viewport, ok := settings["viewport"].(map[string]interface{}); ok {
		if width, exists := viewport["width"]; exists {
			if w, ok := width.(float64); !ok || w <= 0 || w > 3840 {
				return fmt.Errorf("viewport width must be between 1 and 3840")
			}
		}
		if height, exists := viewport["height"]; exists {
			if h, ok := height.(float64); !ok || h <= 0 || h > 2160 {
				return fmt.Errorf("viewport height must be between 1 and 2160")
			}
		}
	}

	// Validate user agent if present
	if userAgent, ok := settings["userAgent"].(string); ok {
		if len(userAgent) > 512 {
			return fmt.Errorf("user agent string too long (max 512 characters)")
		}
	}

	return nil
}

// ValidateTimeout validates timeout parameter
func ValidateTimeout(timeout int) error {
	if timeout < 0 {
		return fmt.Errorf("timeout cannot be negative")
	}
	if timeout > 3600 { // 1 hour max
		return fmt.Errorf("timeout cannot exceed 3600 seconds")
	}
	return nil
}

// ValidateCreateSessionRequest validates the entire create session request
func ValidateCreateSessionRequest(event events.APIGatewayProxyRequest) error {
	// Validate HTTP method
	if event.HTTPMethod != "POST" {
		return fmt.Errorf("method not allowed: %s", event.HTTPMethod)
	}

	// Validate Content-Type for POST requests with body
	if event.Body != "" {
		contentType := event.Headers["Content-Type"]
		if contentType == "" {
			contentType = event.Headers["content-type"]
		}
		if !strings.Contains(contentType, "application/json") {
			return fmt.Errorf("invalid content type: %s", contentType)
		}
	}

	return nil
}

// ValidateWebSocketEvent validates WebSocket events
func ValidateWebSocketEvent(event events.APIGatewayWebsocketProxyRequest) error {
	if event.RequestContext.ConnectionID == "" {
		return fmt.Errorf("missing connection ID")
	}

	if event.RequestContext.RouteKey == "" {
		return fmt.Errorf("missing route key")
	}

	return nil
}

// ValidateWebSocketMessage validates WebSocket message structure
func ValidateWebSocketMessage(msgType string, body string) error {
	if msgType == "" {
		return fmt.Errorf("message type is required")
	}

	allowedTypes := map[string]bool{
		"CDP_COMMAND":      true,
		"AI_ACTION":        true,
		"INPUT_EVENT":      true,
		"SCREENCAST_START": true,
		"SCREENCAST_STOP":  true,
		"PING":             true,
	}

	if !allowedTypes[msgType] {
		return fmt.Errorf("invalid message type: %s", msgType)
	}

	if len(body) > 1024*1024 { // 1MB max
		return fmt.Errorf("message body too large")
	}

	return nil
}
