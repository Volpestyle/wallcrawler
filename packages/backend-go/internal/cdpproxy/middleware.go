package cdpproxy

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/wallcrawler/backend-go/internal/utils"
)

// loggingMiddleware logs all requests
func (p *CDPProxy) loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		log.Printf("CDP Proxy: %s %s from %s", r.Method, r.URL.Path, r.RemoteAddr)
		next.ServeHTTP(w, r)
		log.Printf("CDP Proxy: %s %s completed in %v", r.Method, r.URL.Path, time.Since(start))
	})
}

// metricsMiddleware tracks request metrics
func (p *CDPProxy) metricsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p.metrics.mutex.Lock()
		p.metrics.TotalRequests++
		p.metrics.mutex.Unlock()

		start := time.Now()
		next.ServeHTTP(w, r)

		duration := time.Since(start)
		p.metrics.mutex.Lock()
		p.metrics.ConnectionDuration += duration
		p.metrics.mutex.Unlock()
	})
}

// rateLimitMiddleware enforces rate limiting
func (p *CDPProxy) rateLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip rate limiting for management endpoints
		if r.URL.Path == "/health" || r.URL.Path == "/metrics" {
			next.ServeHTTP(w, r)
			return
		}

		signingKey := p.extractSigningKey(r)
		if signingKey != "" {
			if payload, err := utils.ValidateCDPToken(signingKey); err == nil {
				if !p.rateLimiter.CheckRateLimit(payload.SessionID, payload.ProjectID) {
					p.errorTracker.RecordError("rate_limit_exceeded", payload.SessionID)
					log.Printf("CDP Proxy: Rate limit exceeded for session %s", payload.SessionID)
					http.Error(w, "Rate limit exceeded", 429)
					return
				}
			}
		}

		next.ServeHTTP(w, r)
	})
}

// circuitBreakerMiddleware implements circuit breaker pattern
func (p *CDPProxy) circuitBreakerMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip circuit breaker for management endpoints
		if r.URL.Path == "/health" || r.URL.Path == "/metrics" {
			next.ServeHTTP(w, r)
			return
		}

		if !p.circuitBreaker.CanExecute() {
			p.errorTracker.RecordError("circuit_breaker_open", "chrome_unavailable")
			log.Printf("CDP Proxy: Circuit breaker is open, rejecting request")
			http.Error(w, "Service temporarily unavailable", 503)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// authMiddleware handles authentication for all requests
func (p *CDPProxy) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip auth for health check and metrics
		if r.URL.Path == "/health" || r.URL.Path == "/metrics" {
			next.ServeHTTP(w, r)
			return
		}

		signingKey := p.extractSigningKey(r)
		if signingKey == "" {
			p.metrics.mutex.Lock()
			p.metrics.AuthFailures++
			p.metrics.mutex.Unlock()

			p.errorTracker.RecordError("missing_auth_token", r.RemoteAddr)
			log.Printf("CDP Proxy: Missing signing key for %s %s", r.Method, r.URL.Path)
			http.Error(w, "Unauthorized: Missing signing key", 401)
			return
		}

		payload, err := utils.ValidateCDPToken(signingKey)
		if err != nil {
			p.metrics.mutex.Lock()
			p.metrics.AuthFailures++
			p.metrics.mutex.Unlock()

			p.errorTracker.RecordError("invalid_auth_token", err.Error())
			log.Printf("CDP Proxy: Invalid signing key: %v", err)
			http.Error(w, "Unauthorized: Invalid signing key", 401)
			return
		}

		ctx := context.WithValue(r.Context(), "cdp_payload", payload)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
