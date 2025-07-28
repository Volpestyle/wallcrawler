package cdpproxy

import (
	"log"
	"sync"
	"time"
)

// RateLimiter manages rate limiting per session/project
type RateLimiter struct {
	limits map[string]*SessionLimit
	mutex  sync.RWMutex
}

type SessionLimit struct {
	RequestCount int64
	LastRequest  time.Time
	WindowStart  time.Time
	MaxRequests  int64
	IsBlocked    bool
	BlockedUntil time.Time
}

// ErrorTracker tracks and manages error patterns
type ErrorTracker struct {
	errors map[string]*ErrorPattern
	mutex  sync.RWMutex
}

type ErrorPattern struct {
	Count          int64
	LastOccurrence time.Time
	ErrorType      string
	RecoveryAction string
}

// CircuitBreaker implements circuit breaker pattern for Chrome connectivity
type CircuitBreaker struct {
	FailureCount    int64
	LastFailureTime time.Time
	State           CircuitState
	mutex           sync.RWMutex
}

type CircuitState int

const (
	Closed CircuitState = iota
	Open
	HalfOpen
)

// NewRateLimiter creates a new rate limiter
func NewRateLimiter() *RateLimiter {
	rl := &RateLimiter{
		limits: make(map[string]*SessionLimit),
	}
	go rl.cleanup()
	return rl
}

// CheckRateLimit checks if a session/project is within rate limits
func (rl *RateLimiter) CheckRateLimit(sessionID, projectID string) bool {
	rl.mutex.Lock()
	defer rl.mutex.Unlock()

	now := time.Now()
	key := sessionID

	limit, exists := rl.limits[key]
	if !exists {
		limit = &SessionLimit{
			RequestCount: 1,
			LastRequest:  now,
			WindowStart:  now,
			MaxRequests:  100,
		}
		rl.limits[key] = limit
		return true
	}

	if limit.IsBlocked && now.Before(limit.BlockedUntil) {
		return false
	}

	if now.Sub(limit.WindowStart) > time.Minute {
		limit.RequestCount = 1
		limit.WindowStart = now
		limit.IsBlocked = false
		return true
	}

	limit.RequestCount++
	limit.LastRequest = now

	if limit.RequestCount > limit.MaxRequests {
		limit.IsBlocked = true
		limit.BlockedUntil = now.Add(5 * time.Minute)
		return false
	}

	return true
}

// cleanup removes old rate limit entries
func (rl *RateLimiter) cleanup() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		rl.mutex.Lock()
		now := time.Now()
		for key, limit := range rl.limits {
			if now.Sub(limit.LastRequest) > 10*time.Minute {
				delete(rl.limits, key)
			}
		}
		rl.mutex.Unlock()
	}
}

// NewErrorTracker creates a new error tracker
func NewErrorTracker() *ErrorTracker {
	return &ErrorTracker{
		errors: make(map[string]*ErrorPattern),
	}
}

// RecordError records an error pattern
func (et *ErrorTracker) RecordError(errorType, details string) {
	et.mutex.Lock()
	defer et.mutex.Unlock()

	key := errorType
	pattern, exists := et.errors[key]
	if !exists {
		pattern = &ErrorPattern{
			Count:          1,
			LastOccurrence: time.Now(),
			ErrorType:      errorType,
			RecoveryAction: "retry",
		}
		et.errors[key] = pattern
	} else {
		pattern.Count++
		pattern.LastOccurrence = time.Now()
	}

	log.Printf("CDP Proxy Error: %s occurred %d times (last: %v)",
		errorType, pattern.Count, pattern.LastOccurrence)
}

// NewCircuitBreaker creates a new circuit breaker
func NewCircuitBreaker() *CircuitBreaker {
	return &CircuitBreaker{
		State: Closed,
	}
}

// CanExecute checks if requests can be executed (circuit breaker)
func (cb *CircuitBreaker) CanExecute() bool {
	cb.mutex.RLock()
	defer cb.mutex.RUnlock()

	switch cb.State {
	case Open:
		if time.Since(cb.LastFailureTime) > 30*time.Second {
			cb.mutex.RUnlock()
			cb.mutex.Lock()
			cb.State = HalfOpen
			cb.mutex.Unlock()
			cb.mutex.RLock()
			return true
		}
		return false
	case HalfOpen, Closed:
		return true
	default:
		return false
	}
}

// RecordSuccess records a successful operation
func (cb *CircuitBreaker) RecordSuccess() {
	cb.mutex.Lock()
	defer cb.mutex.Unlock()

	cb.FailureCount = 0
	cb.State = Closed
}

// RecordFailure records a failed operation
func (cb *CircuitBreaker) RecordFailure() {
	cb.mutex.Lock()
	defer cb.mutex.Unlock()

	cb.FailureCount++
	cb.LastFailureTime = time.Now()

	if cb.FailureCount >= 5 {
		cb.State = Open
		log.Printf("CDP Proxy: Circuit breaker opened due to %d failures", cb.FailureCount)
	}
}
