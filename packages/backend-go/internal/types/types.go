package types

import "time"

// Response wrapper types
type SuccessResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data"`
}

type ErrorResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

// Session creation types
type SessionCreateRequest struct {
	ProjectID    string            `json:"projectId"`
	Script       string            `json:"script,omitempty"`
	UserMetadata map[string]string `json:"userMetadata,omitempty"`
}

type SessionCreateResponse struct {
	ID         string `json:"id"`
	ConnectURL string `json:"connectUrl"`
}

type Context struct {
	ID        string `json:"id"`
	ProjectID string `json:"projectId"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type ContextCreateResponse struct {
	ID                       string `json:"id"`
	CipherAlgorithm          string `json:"cipherAlgorithm"`
	InitializationVectorSize int    `json:"initializationVectorSize"`
	PublicKey                string `json:"publicKey"`
	UploadURL                string `json:"uploadUrl"`
}

type ContextUpdateResponse struct {
	ID                       string `json:"id"`
	CipherAlgorithm          string `json:"cipherAlgorithm"`
	InitializationVectorSize int    `json:"initializationVectorSize"`
	PublicKey                string `json:"publicKey"`
	UploadURL                string `json:"uploadUrl"`
}

// Stagehand session start types
type StartSessionRequest struct {
	ModelName                      string                 `json:"modelName"`
	ModelAPIKey                    string                 `json:"modelApiKey"`
	DOMSettleTimeoutMs             int                    `json:"domSettleTimeoutMs"`
	Verbose                        int                    `json:"verbose"`
	DebugDOM                       bool                   `json:"debugDom"`
	SystemPrompt                   string                 `json:"systemPrompt,omitempty"`
	SelfHeal                       bool                   `json:"selfHeal,omitempty"`
	WaitForCaptchaSolves           bool                   `json:"waitForCaptchaSolves,omitempty"`
	ActionTimeoutMs                int                    `json:"actionTimeoutMs,omitempty"`
	BrowserbaseSessionCreateParams map[string]interface{} `json:"browserbaseSessionCreateParams,omitempty"`
	BrowserbaseSessionID           string                 `json:"browserbaseSessionID,omitempty"`
}

type StartSessionResponse struct {
	SessionID string `json:"sessionId"`
	Available bool   `json:"available"`
}

// Session status enum values - SDK compatible
const (
	// Internal statuses (for tracking detailed state)
	SessionStatusCreating     = "CREATING"
	SessionStatusProvisioning = "PROVISIONING"
	SessionStatusStarting     = "STARTING"
	SessionStatusReady        = "READY"
	SessionStatusActive       = "ACTIVE"
	SessionStatusTerminating  = "TERMINATING"
	SessionStatusStopped      = "STOPPED"
	SessionStatusFailed       = "FAILED"

	// SDK-compatible statuses
	SessionStatusRunning   = "RUNNING"
	SessionStatusError     = "ERROR"
	SessionStatusTimedOut  = "TIMED_OUT"
	SessionStatusCompleted = "COMPLETED"
)

// Action types
type ActRequest struct {
	Action             string            `json:"action"`
	ModelName          string            `json:"modelName,omitempty"`
	Variables          map[string]string `json:"variables,omitempty"`
	DOMSettleTimeoutMs int               `json:"domSettleTimeoutMs,omitempty"`
	TimeoutMs          int               `json:"timeoutMs,omitempty"`
	Iframes            bool              `json:"iframes,omitempty"`
}

type ActResult struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Action  string `json:"action"`
}

// Extract types
type ExtractRequest struct {
	Instruction        string      `json:"instruction,omitempty"`
	SchemaDefinition   interface{} `json:"schemaDefinition,omitempty"`
	ModelName          string      `json:"modelName,omitempty"`
	DOMSettleTimeoutMs int         `json:"domSettleTimeoutMs,omitempty"`
	Selector           string      `json:"selector,omitempty"`
	Iframes            bool        `json:"iframes,omitempty"`
}

// Observe types
type ObserveRequest struct {
	Instruction        string `json:"instruction,omitempty"`
	ModelName          string `json:"modelName,omitempty"`
	DOMSettleTimeoutMs int    `json:"domSettleTimeoutMs,omitempty"`
	ReturnAction       bool   `json:"returnAction,omitempty"`
	DrawOverlay        bool   `json:"drawOverlay,omitempty"`
	Iframes            bool   `json:"iframes,omitempty"`
}

type ObserveResult struct {
	Selector      string   `json:"selector"`
	Description   string   `json:"description"`
	BackendNodeID int      `json:"backendNodeId,omitempty"`
	Method        string   `json:"method,omitempty"`
	Arguments     []string `json:"arguments,omitempty"`
}

// Navigate types
type NavigateRequest struct {
	URL     string                 `json:"url"`
	Options map[string]interface{} `json:"options,omitempty"`
}

// Agent types
type AgentExecuteRequest struct {
	AgentConfig    AgentConfig         `json:"agentConfig"`
	ExecuteOptions AgentExecuteOptions `json:"executeOptions"`
}

type AgentConfig struct {
	Provider     string                 `json:"provider"`
	Model        string                 `json:"model"`
	Instructions string                 `json:"instructions,omitempty"`
	Options      map[string]interface{} `json:"options,omitempty"`
}

type AgentExecuteOptions struct {
	Instruction        string `json:"instruction"`
	MaxSteps           int    `json:"maxSteps,omitempty"`
	AutoScreenshot     bool   `json:"autoScreenshot,omitempty"`
	WaitBetweenActions int    `json:"waitBetweenActions,omitempty"`
	Context            string `json:"context,omitempty"`
}

type AgentResult struct {
	Success   bool          `json:"success"`
	Message   string        `json:"message"`
	Actions   []AgentAction `json:"actions"`
	Completed bool          `json:"completed"`
	Metadata  interface{}   `json:"metadata,omitempty"`
	Usage     TokenUsage    `json:"usage,omitempty"`
}

type AgentAction struct {
	Type string                 `json:"type"`
	Data map[string]interface{} `json:",inline"`
}

type TokenUsage struct {
	InputTokens     int `json:"input_tokens,omitempty"`
	OutputTokens    int `json:"output_tokens,omitempty"`
	InferenceTimeMs int `json:"inference_time_ms,omitempty"`
}

// Streaming event types
type StreamEvent struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

type SystemEvent struct {
	Status string      `json:"status"`
	Result interface{} `json:"result,omitempty"`
	Error  string      `json:"error,omitempty"`
}

type LogEvent struct {
	Message LogMessage `json:"message"`
}

type LogMessage struct {
	Level     string    `json:"level"`
	Text      string    `json:"text"`
	Timestamp time.Time `json:"timestamp"`
}

type SessionState struct {
	// SDK-compatible fields
	ID             string                 `json:"id"`
	CreatedAt      string                 `json:"createdAt"`
	ExpiresAt      string                 `json:"expiresAt"`
	ExpiresAtUnix  int64                  `json:"-" dynamodbav:"expiresAt"` // Numeric timestamp for DynamoDB GSI
	KeepAlive      bool                   `json:"keepAlive"`
	ProjectID      string                 `json:"projectId"`
	ProxyBytes     int                    `json:"proxyBytes"`
	Region         string                 `json:"region"`
	StartedAt      string                 `json:"startedAt"`
	Status         string                 `json:"status"` // RUNNING, ERROR, TIMED_OUT, COMPLETED
	UpdatedAt      string                 `json:"updatedAt"`
	AvgCPUUsage    *int                   `json:"avgCpuUsage,omitempty"`
	ContextID      *string                `json:"contextId,omitempty"`
	ContextPersist bool                   `json:"contextPersist,omitempty"`
	EndedAt        *string                `json:"endedAt,omitempty"`
	MemoryUsage    *int                   `json:"memoryUsage,omitempty"`
	UserMetadata   map[string]interface{} `json:"userMetadata,omitempty"`

	// Internal lifecycle tracking (not exposed directly to SDK)
	InternalStatus    string  `json:"-" dynamodbav:"internalStatus,omitempty"`
	ContextStorageKey *string `json:"-" dynamodbav:"contextStorageKey,omitempty"`

	// Additional fields for session creation response
	ConnectURL        *string `json:"connectUrl,omitempty"`
	SeleniumRemoteURL *string `json:"seleniumRemoteUrl,omitempty"`
	SigningKey        *string `json:"signingKey,omitempty"`

	// Internal fields (not exposed in SDK)
	ECSTaskARN  string       `json:"ecsTaskArn,omitempty"`
	PublicIP    string       `json:"publicIP,omitempty"`
	ModelConfig *ModelConfig `json:"modelConfig,omitempty"`

	// EventBridge Integration
	EventHistory       []SessionEvent `json:"eventHistory,omitempty"`
	LastEventTimestamp *string        `json:"lastEventTimestamp,omitempty"`
	RetryCount         int            `json:"retryCount,omitempty"`

	// Performance Tracking (internal)
	ProvisioningStartedAt *string `json:"provisioningStartedAt,omitempty"`
	ReadyAt               *string `json:"readyAt,omitempty"`
	LastActiveAt          *string `json:"lastActiveAt,omitempty"`

	// Resource Management
	ResourceLimits *ResourceLimits `json:"resourceLimits,omitempty"`
	BillingInfo    *BillingInfo    `json:"billingInfo,omitempty"`
}

// SessionEvent tracks EventBridge events for complete audit trail
type SessionEvent struct {
	EventType     string                 `json:"eventType"`
	Timestamp     string                 `json:"timestamp"`
	Source        string                 `json:"source"`
	Detail        map[string]interface{} `json:"detail"`
	CorrelationID string                 `json:"correlationId,omitempty"`
}

type SessionArtifact struct {
	Key              string    `json:"key"`
	FileName         string    `json:"fileName"`
	Size             int64     `json:"size"`
	LastModified     string    `json:"lastModified"`
	DownloadURL      string    `json:"downloadUrl"`
	LastModifiedTime time.Time `json:"-"`
}

// ResourceLimits defines session resource constraints
type ResourceLimits struct {
	MaxCPU      int `json:"maxCPU"`      // Maximum CPU allocation
	MaxMemory   int `json:"maxMemory"`   // Maximum memory (MB)
	MaxDuration int `json:"maxDuration"` // Maximum session duration (seconds)
	MaxActions  int `json:"maxActions"`  // Maximum actions per session
}

// BillingInfo tracks usage for cost allocation
type BillingInfo struct {
	CostCenter    string    `json:"costCenter,omitempty"`
	CPUSeconds    float64   `json:"cpuSeconds"`
	MemoryMBHours float64   `json:"memoryMBHours"`
	ActionsCount  int       `json:"actionsCount"`
	LastBillingAt time.Time `json:"lastBillingAt"`
}

type ModelConfig struct {
	ModelName            string `json:"modelName"`
	ModelAPIKey          string `json:"modelApiKey"`
	DOMSettleTimeoutMs   int    `json:"domSettleTimeoutMs"`
	Verbose              int    `json:"verbose"`
	DebugDOM             bool   `json:"debugDom"`
	SystemPrompt         string `json:"systemPrompt,omitempty"`
	SelfHeal             bool   `json:"selfHeal"`
	WaitForCaptchaSolves bool   `json:"waitForCaptchaSolves"`
	ActionTimeoutMs      int    `json:"actionTimeoutMs"`
}

const (
	APIKeyStatusActive   = "ACTIVE"
	APIKeyStatusInactive = "INACTIVE"
)

type APIKeyMetadata struct {
	APIKeyHash string   `json:"-" dynamodbav:"apiKeyHash"`
	KeyID      *string  `json:"keyId,omitempty" dynamodbav:"keyId,omitempty"`
	ProjectID  string   `json:"projectId" dynamodbav:"projectId"`
	ProjectIDs []string `json:"projectIds,omitempty" dynamodbav:"projectIds,omitempty"`
	Name       *string  `json:"name,omitempty" dynamodbav:"name,omitempty"`
	Status     string   `json:"status" dynamodbav:"status"`
	CreatedAt  string   `json:"createdAt" dynamodbav:"createdAt"`
	LastUsedAt *string  `json:"lastUsedAt,omitempty" dynamodbav:"lastUsedAt,omitempty"`
}

const (
	ProjectStatusActive   = "ACTIVE"
	ProjectStatusInactive = "INACTIVE"
)

type Project struct {
	ID             string  `json:"id" dynamodbav:"projectId"`
	Name           string  `json:"name" dynamodbav:"name"`
	OwnerID        *string `json:"ownerId,omitempty" dynamodbav:"ownerId,omitempty"`
	DefaultTimeout int     `json:"defaultTimeout" dynamodbav:"defaultTimeout"`
	Concurrency    int     `json:"concurrency" dynamodbav:"concurrency"`
	Status         string  `json:"status" dynamodbav:"status"`
	CreatedAt      string  `json:"createdAt" dynamodbav:"createdAt"`
	UpdatedAt      string  `json:"updatedAt" dynamodbav:"updatedAt"`
	BillingTier    *string `json:"billingTier,omitempty" dynamodbav:"billingTier,omitempty"`
}
