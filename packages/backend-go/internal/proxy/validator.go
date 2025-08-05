package proxy

import (
	"log"
	"strings"
)

// ValidateWallcrawlerAPIKey validates a Wallcrawler API key
// For now, this just checks that the key is provided and has the correct prefix
// In the future, this should check against a database or API key service
func ValidateWallcrawlerAPIKey(apiKey string) bool {
	if apiKey == "" {
		return false
	}

	// Check for expected prefix
	if !strings.HasPrefix(apiKey, "wc_") {
		log.Printf("Invalid API key format: missing 'wc_' prefix")
		return false
	}

	// Check minimum length
	if len(apiKey) < 10 {
		log.Printf("Invalid API key format: too short")
		return false
	}

	// TODO: In production, validate against database:
	// - Check if key exists
	// - Check if key is active/not revoked
	// - Check rate limits
	// - Track usage metrics
	// 
	// Example:
	// keyData, err := db.GetAPIKey(apiKey)
	// if err != nil || keyData == nil {
	//     return false
	// }
	// if keyData.Status != "active" {
	//     return false
	// }
	// if keyData.RateLimitExceeded() {
	//     return false
	// }

	log.Printf("API key validation passed for key: wc_****")
	return true
}

// ExtractProjectID extracts the project ID from a Wallcrawler API key
// This is a placeholder for future implementation
func ExtractProjectID(apiKey string) string {
	// TODO: In production, look up the project ID from the API key
	// For now, return a default
	return "default-project"
}

// GetAPIKeyMetadata returns metadata about an API key
// This is a placeholder for future implementation
type APIKeyMetadata struct {
	ProjectID    string
	UserID       string
	Permissions  []string
	RateLimits   RateLimitConfig
	Active       bool
}

type RateLimitConfig struct {
	RequestsPerMinute int
	RequestsPerHour   int
	RequestsPerDay    int
}

func GetAPIKeyMetadata(apiKey string) (*APIKeyMetadata, error) {
	// TODO: Implement database lookup
	// For now, return mock data
	return &APIKeyMetadata{
		ProjectID:   ExtractProjectID(apiKey),
		UserID:      "user-123",
		Permissions: []string{"sessions.create", "sessions.list", "sessions.retrieve"},
		RateLimits: RateLimitConfig{
			RequestsPerMinute: 60,
			RequestsPerHour:   1000,
			RequestsPerDay:    10000,
		},
		Active: true,
	}, nil
}