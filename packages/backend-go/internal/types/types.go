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

// Stagehand session start types
type StartSessionRequest struct {
	ModelName                       string                 `json:"modelName"`
	ModelAPIKey                     string                 `json:"modelApiKey"`
	DOMSettleTimeoutMs              int                    `json:"domSettleTimeoutMs"`
	Verbose                         int                    `json:"verbose"`
	DebugDOM                        bool                   `json:"debugDom"`
	SystemPrompt                    string                 `json:"systemPrompt,omitempty"`
	SelfHeal                        bool                   `json:"selfHeal,omitempty"`
	WaitForCaptchaSolves            bool                   `json:"waitForCaptchaSolves,omitempty"`
	ActionTimeoutMs                 int                    `json:"actionTimeoutMs,omitempty"`
	BrowserbaseSessionCreateParams  map[string]interface{} `json:"browserbaseSessionCreateParams,omitempty"`
	BrowserbaseSessionID            string                 `json:"browserbaseSessionID,omitempty"`
}

type StartSessionResponse struct {
	SessionID string `json:"sessionId"`
	Available bool   `json:"available"`
}

// Session info types
type Session struct {
	ID         string `json:"id"`
	Status     string `json:"status"`
	ConnectURL string `json:"connectUrl"`
}

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
	Selector     string   `json:"selector"`
	Description  string   `json:"description"`
	BackendNodeID int     `json:"backendNodeId,omitempty"`
	Method       string   `json:"method,omitempty"`
	Arguments    []string `json:"arguments,omitempty"`
}

// Navigate types
type NavigateRequest struct {
	URL     string                 `json:"url"`
	Options map[string]interface{} `json:"options,omitempty"`
}

// Agent types
type AgentExecuteRequest struct {
	AgentConfig    AgentConfig        `json:"agentConfig"`
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

// Session state for Redis
type SessionState struct {
	ID          string            `json:"id"`
	Status      string            `json:"status"`
	ProjectID   string            `json:"projectId"`
	ConnectURL  string            `json:"connectUrl"`
	ECSTaskARN  string            `json:"ecsTaskArn,omitempty"`
	UserMetadata map[string]string `json:"userMetadata,omitempty"`
	ModelConfig  *ModelConfig      `json:"modelConfig,omitempty"`
	CreatedAt   time.Time         `json:"createdAt"`
	UpdatedAt   time.Time         `json:"updatedAt"`
}

type ModelConfig struct {
	ModelName              string `json:"modelName"`
	ModelAPIKey            string `json:"modelApiKey"`
	DOMSettleTimeoutMs     int    `json:"domSettleTimeoutMs"`
	Verbose                int    `json:"verbose"`
	DebugDOM               bool   `json:"debugDom"`
	SystemPrompt           string `json:"systemPrompt,omitempty"`
	SelfHeal               bool   `json:"selfHeal"`
	WaitForCaptchaSolves   bool   `json:"waitForCaptchaSolves"`
	ActionTimeoutMs        int    `json:"actionTimeoutMs"`
} 