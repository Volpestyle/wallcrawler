package shared

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"math/big"
	"strings"
	"time"
)

// String utilities

// SplitString splits a string by a separator, handling empty strings
func SplitString(s, sep string) []string {
	if s == "" {
		return []string{}
	}
	return strings.Split(s, sep)
}

// StringPtr returns a pointer to a string
func StringPtr(s string) *string {
	return &s
}

// Int32Ptr returns a pointer to an int32
func Int32Ptr(i int32) *int32 {
	return &i
}

// IntPtr returns a pointer to an int
func IntPtr(i int) *int {
	return &i
}

// BoolPtr returns a pointer to a bool
func BoolPtr(b bool) *bool {
	return &b
}

// ID Generation utilities

// GenerateSessionID generates a unique session ID
func GenerateSessionID() string {
	return fmt.Sprintf("ses_%d_%s", time.Now().Unix(), GenerateRandomString(10))
}

// GenerateContainerID generates a unique container ID
func GenerateContainerID() string {
	return fmt.Sprintf("container-%d", time.Now().Unix())
}

// GenerateRandomString generates a random string of specified length
func GenerateRandomString(length int) string {
	const charset = "abcdefghijklmnopqrstuvwxyz0123456789"
	result := make([]byte, length)
	for i := range result {
		num, _ := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		result[i] = charset[num.Int64()]
	}
	return string(result)
}

// GenerateRandomHex generates a random hex string of specified length
func GenerateRandomHex(length int) string {
	bytes := make([]byte, length/2)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

// Time utilities

// FormatTime formats a time as RFC3339 string
func FormatTime(t time.Time) string {
	return t.Format(time.RFC3339)
}

// FormatNow formats the current time as RFC3339 string
func FormatNow() string {
	return FormatTime(time.Now())
}

// ParseTime parses an RFC3339 time string
func ParseTime(s string) (time.Time, error) {
	return time.Parse(time.RFC3339, s)
}

// URL utilities

// ExtractSessionIDFromPath extracts session ID from a URL path like "/sessions/{id}/action"
func ExtractSessionIDFromPath(path, prefix, suffix string) string {
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

// BuildWebSocketURL builds a WebSocket URL with query parameters
func BuildWebSocketURL(baseURL, sessionID, token string) string {
	return fmt.Sprintf("%s?sessionId=%s&token=%s", baseURL, sessionID, token)
}

// Map utilities

// MergeMaps merges multiple maps into a single map
func MergeMaps(maps ...map[string]interface{}) map[string]interface{} {
	result := make(map[string]interface{})
	for _, m := range maps {
		for k, v := range m {
			result[k] = v
		}
	}
	return result
}

// CopyMap creates a shallow copy of a map
func CopyMap(original map[string]interface{}) map[string]interface{} {
	copy := make(map[string]interface{})
	for k, v := range original {
		copy[k] = v
	}
	return copy
}

// Validation utilities

// IsValidSessionID checks if a session ID has the correct format
func IsValidSessionID(sessionID string) bool {
	return strings.HasPrefix(sessionID, "ses_") && len(sessionID) > 15
}

// IsValidUserID checks if a user ID has the correct format
func IsValidUserID(userID string) bool {
	return strings.HasPrefix(userID, "user_") && len(userID) > 8
}

// Conversion utilities

// ToStringSlice converts interface{} to []string if possible
func ToStringSlice(i interface{}) ([]string, bool) {
	switch v := i.(type) {
	case []string:
		return v, true
	case []interface{}:
		result := make([]string, len(v))
		for i, item := range v {
			if str, ok := item.(string); ok {
				result[i] = str
			} else {
				return nil, false
			}
		}
		return result, true
	default:
		return nil, false
	}
}

// ToString converts interface{} to string if possible
func ToString(i interface{}) (string, bool) {
	if s, ok := i.(string); ok {
		return s, true
	}
	return "", false
}

// ToInt converts interface{} to int if possible
func ToInt(i interface{}) (int, bool) {
	switch v := i.(type) {
	case int:
		return v, true
	case float64:
		return int(v), true
	case string:
		// This would require strconv.Atoi, but let's keep it simple
		return 0, false
	default:
		return 0, false
	}
} 