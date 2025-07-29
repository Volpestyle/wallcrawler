package utils

import (
	"encoding/json"
	"log"
	"os"
	"time"
)

// SessionLogEntry represents a structured log entry for session events
type SessionLogEntry struct {
	Timestamp string                 `json:"timestamp"`
	SessionID string                 `json:"session_id"`
	ProjectID string                 `json:"project_id,omitempty"`
	EventType string                 `json:"event_type"`
	Status    string                 `json:"status,omitempty"`
	Duration  int64                  `json:"duration_ms,omitempty"`
	Error     string                 `json:"error,omitempty"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
}

var (
	// Enable structured logging via environment variable
	structuredLogging = os.Getenv("STRUCTURED_LOGGING") != "false" // Default to true
)

// LogSessionEvent logs a structured session event
func LogSessionEvent(event SessionLogEntry) {
	if event.Timestamp == "" {
		event.Timestamp = time.Now().UTC().Format(time.RFC3339)
	}

	if structuredLogging {
		jsonBytes, err := json.Marshal(event)
		if err != nil {
			log.Printf("Error marshaling log entry: %v", err)
			return
		}
		log.Println(string(jsonBytes))
	} else {
		// Fallback to traditional logging
		if event.Error != "" {
			log.Printf("[%s] Session %s: %s (error: %s)", event.EventType, event.SessionID, event.Status, event.Error)
		} else {
			log.Printf("[%s] Session %s: %s", event.EventType, event.SessionID, event.Status)
		}
	}
}

// LogSessionCreated logs when a session is created
func LogSessionCreated(sessionID, projectID string, metadata map[string]interface{}) {
	LogSessionEvent(SessionLogEntry{
		SessionID: sessionID,
		ProjectID: projectID,
		EventType: "SESSION_CREATED",
		Status:    "CREATING",
		Metadata:  metadata,
	})
}

// LogSessionReady logs when a session becomes ready
func LogSessionReady(sessionID, projectID, publicIP string, provisioningTimeMs int64) {
	LogSessionEvent(SessionLogEntry{
		SessionID: sessionID,
		ProjectID: projectID,
		EventType: "SESSION_READY",
		Status:    "READY",
		Duration:  provisioningTimeMs,
		Metadata: map[string]interface{}{
			"public_ip": publicIP,
		},
	})
}

// LogSessionTerminated logs when a session is terminated
func LogSessionTerminated(sessionID, projectID, reason string, sessionDurationMs int64, metadata map[string]interface{}) {
	if metadata == nil {
		metadata = make(map[string]interface{})
	}
	metadata["reason"] = reason

	LogSessionEvent(SessionLogEntry{
		SessionID: sessionID,
		ProjectID: projectID,
		EventType: "SESSION_TERMINATED",
		Status:    "STOPPED",
		Duration:  sessionDurationMs,
		Metadata:  metadata,
	})
}

// LogSessionError logs session errors
func LogSessionError(sessionID, projectID string, err error, operation string, metadata map[string]interface{}) {
	if metadata == nil {
		metadata = make(map[string]interface{})
	}
	metadata["operation"] = operation

	LogSessionEvent(SessionLogEntry{
		SessionID: sessionID,
		ProjectID: projectID,
		EventType: "SESSION_ERROR",
		Error:     err.Error(),
		Metadata:  metadata,
	})
}

// LogSessionTimeout logs when a session times out
func LogSessionTimeout(sessionID, projectID string, sessionAge time.Duration) {
	LogSessionEvent(SessionLogEntry{
		SessionID: sessionID,
		ProjectID: projectID,
		EventType: "SESSION_TIMEOUT",
		Status:    "TIMED_OUT",
		Duration:  sessionAge.Milliseconds(),
		Metadata: map[string]interface{}{
			"timeout_minutes": sessionAge.Minutes(),
		},
	})
}

// LogBrowserOperation logs browser operations
func LogBrowserOperation(sessionID, projectID, operation string, success bool, metadata map[string]interface{}) {
	if metadata == nil {
		metadata = make(map[string]interface{})
	}
	metadata["operation"] = operation
	metadata["success"] = success

	LogSessionEvent(SessionLogEntry{
		SessionID: sessionID,
		ProjectID: projectID,
		EventType: "BROWSER_OPERATION",
		Metadata:  metadata,
	})
}

// LogResourceMetrics logs resource usage metrics
func LogResourceMetrics(sessionID, projectID string, cpuPercent, memoryMB float64, networkBytes int64) {
	LogSessionEvent(SessionLogEntry{
		SessionID: sessionID,
		ProjectID: projectID,
		EventType: "RESOURCE_METRICS",
		Metadata: map[string]interface{}{
			"cpu_percent":   cpuPercent,
			"memory_mb":     memoryMB,
			"network_bytes": networkBytes,
		},
	})
}

// LogECSTaskEvent logs ECS task state changes
func LogECSTaskEvent(sessionID, taskARN, status string, metadata map[string]interface{}) {
	if metadata == nil {
		metadata = make(map[string]interface{})
	}
	metadata["task_arn"] = taskARN
	metadata["task_status"] = status

	LogSessionEvent(SessionLogEntry{
		SessionID: sessionID,
		EventType: "ECS_TASK_EVENT",
		Status:    status,
		Metadata:  metadata,
	})
}