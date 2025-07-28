package utils

import (
	"fmt"
	"time"

	"github.com/wallcrawler/backend-go/internal/types"
)

// SDKSession matches the SDK's Session interface
type SDKSession struct {
	ID           string                 `json:"id"`
	CreatedAt    string                 `json:"createdAt"`
	ExpiresAt    string                 `json:"expiresAt"`
	KeepAlive    bool                   `json:"keepAlive"`
	ProjectID    string                 `json:"projectId"`
	ProxyBytes   int                    `json:"proxyBytes"`
	Region       string                 `json:"region"`
	StartedAt    string                 `json:"startedAt"`
	Status       string                 `json:"status"`
	UpdatedAt    string                 `json:"updatedAt"`
	AvgCPUUsage  *int                   `json:"avgCpuUsage,omitempty"`
	ContextID    *string                `json:"contextId,omitempty"`
	EndedAt      *string                `json:"endedAt,omitempty"`
	MemoryUsage  *int                   `json:"memoryUsage,omitempty"`
	UserMetadata map[string]interface{} `json:"userMetadata,omitempty"`
}

// SDKSessionCreateResponse matches the SDK's SessionCreateResponse interface
type SDKSessionCreateResponse struct {
	ID                string                 `json:"id"`
	ConnectURL        string                 `json:"connectUrl"`
	CreatedAt         string                 `json:"createdAt"`
	ExpiresAt         string                 `json:"expiresAt"`
	KeepAlive         bool                   `json:"keepAlive"`
	ProjectID         string                 `json:"projectId"`
	ProxyBytes        int                    `json:"proxyBytes"`
	Region            string                 `json:"region"`
	SeleniumRemoteURL string                 `json:"seleniumRemoteUrl"`
	SigningKey        string                 `json:"signingKey"`
	StartedAt         string                 `json:"startedAt"`
	Status            string                 `json:"status"`
	UpdatedAt         string                 `json:"updatedAt"`
	AvgCPUUsage       *int                   `json:"avgCpuUsage,omitempty"`
	ContextID         *string                `json:"contextId,omitempty"`
	EndedAt           *string                `json:"endedAt,omitempty"`
	MemoryUsage       *int                   `json:"memoryUsage,omitempty"`
	UserMetadata      map[string]interface{} `json:"userMetadata,omitempty"`
}

// SDKSessionRetrieveResponse matches the SDK's SessionRetrieveResponse interface
type SDKSessionRetrieveResponse struct {
	ID                string                 `json:"id"`
	CreatedAt         string                 `json:"createdAt"`
	ExpiresAt         string                 `json:"expiresAt"`
	KeepAlive         bool                   `json:"keepAlive"`
	ProjectID         string                 `json:"projectId"`
	ProxyBytes        int                    `json:"proxyBytes"`
	Region            string                 `json:"region"`
	StartedAt         string                 `json:"startedAt"`
	Status            string                 `json:"status"`
	UpdatedAt         string                 `json:"updatedAt"`
	AvgCPUUsage       *int                   `json:"avgCpuUsage,omitempty"`
	ConnectURL        *string                `json:"connectUrl,omitempty"`
	ContextID         *string                `json:"contextId,omitempty"`
	EndedAt           *string                `json:"endedAt,omitempty"`
	MemoryUsage       *int                   `json:"memoryUsage,omitempty"`
	SeleniumRemoteURL *string                `json:"seleniumRemoteUrl,omitempty"`
	SigningKey        *string                `json:"signingKey,omitempty"`
	UserMetadata      map[string]interface{} `json:"userMetadata,omitempty"`
}

// ConvertToSDKSession converts internal SessionState to SDK Session format
func ConvertToSDKSession(sessionState *types.SessionState) SDKSession {
	// Extract metadata values, providing defaults
	keepAlive := false
	region := "us-east-1"
	if sessionState.UserMetadata != nil {
		if ka, exists := sessionState.UserMetadata["keepAlive"]; exists && ka == "true" {
			keepAlive = true
		}
		if r, exists := sessionState.UserMetadata["region"]; exists && r != "" {
			region = r
		}
	}

	session := SDKSession{
		ID:         sessionState.ID,
		CreatedAt:  sessionState.CreatedAt.Format(time.RFC3339),
		ExpiresAt:  sessionState.CreatedAt.Add(24 * time.Hour).Format(time.RFC3339), // Default 24h
		KeepAlive:  keepAlive,
		ProjectID:  sessionState.ProjectID,
		ProxyBytes: 0, // Will be tracked when proxy functionality is implemented
		Region:     region,
		StartedAt:  sessionState.CreatedAt.Format(time.RFC3339),
		Status:     MapStatusToSDK(sessionState.Status), // Use SDK-compatible status
		UpdatedAt:  sessionState.UpdatedAt.Format(time.RFC3339),
	}

	// Add optional fields
	if sessionState.TerminatedAt != nil {
		endedAt := sessionState.TerminatedAt.Format(time.RFC3339)
		session.EndedAt = &endedAt
	}

	// Convert user metadata back to interface{} map
	if sessionState.UserMetadata != nil {
		userMetadata := make(map[string]interface{})
		for k, v := range sessionState.UserMetadata {
			userMetadata[k] = v
		}
		session.UserMetadata = userMetadata
	}

	return session
}

// ConvertToSDKCreateResponse converts internal SessionState to SDK SessionCreateResponse format
func ConvertToSDKCreateResponse(sessionState *types.SessionState, connectURL, seleniumRemoteURL, signingKey string, userMetadata map[string]interface{}) SDKSessionCreateResponse {
	// Extract metadata values, providing defaults
	keepAlive := false
	region := "us-east-1"
	if sessionState.UserMetadata != nil {
		if ka, exists := sessionState.UserMetadata["keepAlive"]; exists && ka == "true" {
			keepAlive = true
		}
		if r, exists := sessionState.UserMetadata["region"]; exists && r != "" {
			region = r
		}
	}

	now := time.Now()
	expiresAt := now.Add(24 * time.Hour) // Default 24h from creation

	return SDKSessionCreateResponse{
		ID:                sessionState.ID,
		ConnectURL:        connectURL,
		CreatedAt:         now.Format(time.RFC3339),
		ExpiresAt:         expiresAt.Format(time.RFC3339),
		KeepAlive:         keepAlive,
		ProjectID:         sessionState.ProjectID,
		ProxyBytes:        0, // Will be updated as proxy is used
		Region:            region,
		SeleniumRemoteURL: seleniumRemoteURL,
		SigningKey:        signingKey,
		StartedAt:         now.Format(time.RFC3339),
		Status:            MapStatusToSDK(sessionState.Status),
		UpdatedAt:         now.Format(time.RFC3339),
		UserMetadata:      userMetadata,
	}
}

// ConvertToSDKRetrieveResponse converts internal SessionState to SDK SessionRetrieveResponse format
func ConvertToSDKRetrieveResponse(sessionState *types.SessionState) SDKSessionRetrieveResponse {
	// Extract metadata values, providing defaults
	keepAlive := false
	region := "us-east-1"
	if sessionState.UserMetadata != nil {
		if ka, exists := sessionState.UserMetadata["keepAlive"]; exists && ka == "true" {
			keepAlive = true
		}
		if r, exists := sessionState.UserMetadata["region"]; exists && r != "" {
			region = r
		}
	}

	response := SDKSessionRetrieveResponse{
		ID:         sessionState.ID,
		CreatedAt:  sessionState.CreatedAt.Format(time.RFC3339),
		ExpiresAt:  sessionState.CreatedAt.Add(24 * time.Hour).Format(time.RFC3339), // Default 24h
		KeepAlive:  keepAlive,
		ProjectID:  sessionState.ProjectID,
		ProxyBytes: 0, // Will be tracked when proxy functionality is implemented
		Region:     region,
		StartedAt:  sessionState.CreatedAt.Format(time.RFC3339),
		Status:     MapStatusToSDK(sessionState.Status), // Use SDK-compatible status
		UpdatedAt:  sessionState.UpdatedAt.Format(time.RFC3339),
	}

	// Add optional fields - generate connectURL if session is ready but URL not set
	if sessionState.ConnectURL != "" {
		response.ConnectURL = &sessionState.ConnectURL
	} else if (sessionState.Status == types.SessionStatusReady || sessionState.Status == types.SessionStatusActive) &&
		sessionState.PublicIP != "" && sessionState.SigningKey != "" {
		// Generate connectURL for ready sessions that might be missing it
		connectURL := CreateAuthenticatedCDPURL(sessionState.PublicIP, sessionState.SigningKey)
		response.ConnectURL = &connectURL
	}

	if sessionState.TerminatedAt != nil {
		endedAt := sessionState.TerminatedAt.Format(time.RFC3339)
		response.EndedAt = &endedAt
	}

	// Generate URLs if session is ready and has public IP
	if (sessionState.Status == types.SessionStatusReady || sessionState.Status == types.SessionStatusActive) && sessionState.PublicIP != "" {
		// Standard Selenium Grid endpoint - /wd/hub is the WebDriver wire protocol endpoint
		seleniumURL := fmt.Sprintf("http://%s:4444/wd/hub", sessionState.PublicIP)
		response.SeleniumRemoteURL = &seleniumURL

		// Get the JWT token from session state
		if sessionState.SigningKey != "" {
			response.SigningKey = &sessionState.SigningKey
		}
	}

	// Convert user metadata back to interface{} map
	if sessionState.UserMetadata != nil {
		userMetadata := make(map[string]interface{})
		for k, v := range sessionState.UserMetadata {
			userMetadata[k] = v
		}
		response.UserMetadata = userMetadata
	}

	return response
}
