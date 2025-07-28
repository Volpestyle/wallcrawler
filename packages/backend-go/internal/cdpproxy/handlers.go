package cdpproxy

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// handleMetrics provides comprehensive metrics endpoint
func (p *CDPProxy) handleMetrics(w http.ResponseWriter, r *http.Request) {
	p.metrics.mutex.RLock()
	avgDuration := float64(0)
	if p.metrics.TotalConnections > 0 {
		avgDuration = p.metrics.ConnectionDuration.Seconds() / float64(p.metrics.TotalConnections)
	}

	metrics := map[string]interface{}{
		"total_connections":       p.metrics.TotalConnections,
		"active_connections":      p.metrics.ActiveConnections,
		"total_requests":          p.metrics.TotalRequests,
		"failed_requests":         p.metrics.FailedRequests,
		"auth_failures":           p.metrics.AuthFailures,
		"bytes_transferred":       p.metrics.BytesTransferred,
		"avg_connection_duration": avgDuration,
	}
	p.metrics.mutex.RUnlock()

	p.circuitBreaker.mutex.RLock()
	circuitBreakerStatus := map[string]interface{}{
		"state":             p.circuitBreaker.State,
		"failure_count":     p.circuitBreaker.FailureCount,
		"last_failure_time": p.circuitBreaker.LastFailureTime,
	}
	p.circuitBreaker.mutex.RUnlock()

	// Add error tracking information
	p.errorTracker.mutex.RLock()
	errorPatterns := make(map[string]interface{})
	for errorType, pattern := range p.errorTracker.errors {
		errorPatterns[errorType] = map[string]interface{}{
			"count":           pattern.Count,
			"last_occurrence": pattern.LastOccurrence,
			"recovery_action": pattern.RecoveryAction,
		}
	}
	p.errorTracker.mutex.RUnlock()

	// Add rate limiting status
	p.rateLimiter.mutex.RLock()
	rateLimitStatus := map[string]interface{}{
		"active_limits": len(p.rateLimiter.limits),
	}

	// Add details of currently rate-limited sessions
	blockedSessions := make([]map[string]interface{}, 0)
	for sessionID, limit := range p.rateLimiter.limits {
		if limit.IsBlocked {
			blockedSessions = append(blockedSessions, map[string]interface{}{
				"session_id":    sessionID,
				"request_count": limit.RequestCount,
				"blocked_until": limit.BlockedUntil,
				"window_start":  limit.WindowStart,
			})
		}
	}
	rateLimitStatus["blocked_sessions"] = blockedSessions
	p.rateLimiter.mutex.RUnlock()

	// Add active connection details
	p.connectionsMutex.RLock()
	connections := make([]map[string]interface{}, 0, len(p.activeConnections))
	for _, conn := range p.activeConnections {
		connections = append(connections, map[string]interface{}{
			"id":            conn.ID,
			"session_id":    conn.SessionID,
			"project_id":    conn.ProjectID,
			"client_ip":     conn.ClientIP,
			"connected_at":  conn.ConnectedAt,
			"last_activity": conn.LastActivity,
			"duration":      time.Since(conn.ConnectedAt).Seconds(),
		})
	}
	p.connectionsMutex.RUnlock()

	response := map[string]interface{}{
		"status":             "healthy",
		"metrics":            metrics,
		"circuit_breaker":    circuitBreakerStatus,
		"error_patterns":     errorPatterns,
		"rate_limiting":      rateLimitStatus,
		"active_connections": connections,
		"timestamp":          time.Now(),
		"chrome_address":     p.chromeAddr,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleHealth provides health check endpoint
func (p *CDPProxy) handleHealth(w http.ResponseWriter, r *http.Request) {
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
