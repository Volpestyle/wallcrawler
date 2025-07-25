# Wallcrawler API Reference

This document outlines the API endpoints that Wallcrawler needs to implement to be compatible with the Stagehand client.

## Overview

Wallcrawler provides a remote browser automation API that's compatible with Stagehand's LLM-powered browser operations. The API supports both session management and streaming browser automation operations.

### Base URL

- Production: `https://api.wallcrawler.dev/v1`
- Development: `http://localhost:8080/v1`

### Authentication

All requests require an API key passed in the `x-wc-api-key` header.

### Response Format

- **Success**: `{success: true, data: <result>}`
- **Error**: `{success: false, message: string}`
- **Streaming**: Server-Sent Events with `system` and `log` event types

## Required Headers for Stagehand Compatibility

Stagehand will need to send these headers that Wallcrawler should expect:

```
x-wc-api-key: <api_key>           # API authentication
x-wc-project-id: <project_id>     # Project identifier
x-wc-session-id: <session_id>     # Session identifier
x-model-api-key: <llm_api_key>    # LLM provider API key
x-stream-response: "true"         # Enable streaming responses
x-sent-at: <iso_timestamp>        # Request timestamp
x-language: "typescript"          # SDK language
x-sdk-version: <version>          # Stagehand version
```

## Core Endpoints

### 1. Session Management

#### Start Session (Stagehand Compatible)

```http
POST /sessions/start
Content-Type: application/json

{
  "modelName": "gpt-4o",
  "modelApiKey": "sk-...",
  "domSettleTimeoutMs": 10000,
  "verbose": 1,
  "debugDom": false,
  "systemPrompt": "optional custom prompt",
  "selfHeal": true,
  "waitForCaptchaSolves": false,
  "actionTimeoutMs": 30000,
  "browserbaseSessionCreateParams": {
    "region": "us-west-2",
    "userMetadata": {}
  },
  "browserbaseSessionID": "optional_existing_session"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "sessionId": "sess_123abc456",
    "available": true
  }
}
```

#### Create Session (Wallcrawler Native)

```http
POST /start-session
Content-Type: application/json

{
  "projectId": "proj_123abc",
  "script": "optional initialization script",
  "userMetadata": {
    "stagehand": "true"
  }
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "sess_123abc456",
    "connectUrl": "wss://session.wallcrawler.dev/sess_123abc456"
  }
}
```

#### Get Session Info

```http
GET /sessions/{sessionId}/retrieve
```

#### Get Debug URL

```http
GET /sessions/{sessionId}/debug
```

#### End Session

```http
POST /sessions/{sessionId}/end
```

### 2. Stagehand Operations (All Streaming)

All these endpoints return Server-Sent Events with the following format:

```
data: {"type": "log", "data": {"message": {"level": "info", "text": "Operation started"}}}

data: {"type": "system", "data": {"status": "finished", "result": {...}}}
```

#### Perform Action

```http
POST /sessions/{sessionId}/act
Content-Type: application/json
x-stream-response: true

{
  "action": "Click the submit button",
  "modelName": "gpt-4o",
  "variables": {},
  "domSettleTimeoutMs": 5000,
  "timeoutMs": 30000,
  "iframes": false
}
```

**Stream Result:**

```json
{
  "success": true,
  "message": "Action completed successfully",
  "action": "Clicked submit button"
}
```

#### Extract Data

```http
POST /sessions/{sessionId}/extract
Content-Type: application/json
x-stream-response: true

{
  "instruction": "Extract all product names and prices",
  "schemaDefinition": {
    "type": "object",
    "properties": {
      "products": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "name": {"type": "string"},
            "price": {"type": "string"}
          }
        }
      }
    }
  },
  "modelName": "gpt-4o",
  "domSettleTimeoutMs": 5000,
  "selector": "optional CSS selector",
  "iframes": false
}
```

#### Observe Elements

```http
POST /sessions/{sessionId}/observe
Content-Type: application/json
x-stream-response: true

{
  "instruction": "Find all clickable buttons",
  "modelName": "gpt-4o",
  "domSettleTimeoutMs": 5000,
  "returnAction": true,
  "drawOverlay": false,
  "iframes": false
}
```

**Stream Result:**

```json
[
  {
    "selector": "#submit-btn",
    "description": "Blue submit button",
    "backendNodeId": 123,
    "method": "click",
    "arguments": []
  }
]
```

#### Navigate

```http
POST /sessions/{sessionId}/navigate
Content-Type: application/json
x-stream-response: true

{
  "url": "https://example.com",
  "options": {
    "timeout": 30000,
    "waitUntil": "networkidle"
  }
}
```

#### Agent Execute

```http
POST /sessions/{sessionId}/agentExecute
Content-Type: application/json
x-stream-response: true

{
  "agentConfig": {
    "provider": "openai",
    "model": "gpt-4o",
    "instructions": "You are a helpful assistant",
    "options": {}
  },
  "executeOptions": {
    "instruction": "Find and book the cheapest flight to Paris",
    "maxSteps": 10,
    "autoScreenshot": true,
    "waitBetweenActions": 1000,
    "context": "additional context"
  }
}
```

**Stream Result:**

```json
{
  "success": true,
  "message": "Agent task completed",
  "actions": [
    { "type": "navigate", "url": "https://flights.com" },
    { "type": "click", "selector": "#search-btn" }
  ],
  "completed": true,
  "metadata": {},
  "usage": {
    "input_tokens": 1500,
    "output_tokens": 500,
    "inference_time_ms": 2000
  }
}
```

## Error Handling

### HTTP Status Codes

- `200`: Success
- `400`: Bad Request (invalid parameters)
- `401`: Unauthorized (invalid API key)
- `404`: Not Found (session doesn't exist)
- `500`: Internal Server Error

### Error Response Format

```json
{
  "success": false,
  "message": "Descriptive error message"
}
```

## Streaming Events

### System Events

```json
{
  "type": "system",
  "data": {
    "status": "finished|error",
    "result": {}, // when status is "finished"
    "error": "error message" // when status is "error"
  }
}
```

### Log Events

```json
{
  "type": "log",
  "data": {
    "message": {
      "level": "debug|info|warn|error",
      "text": "Log message",
      "timestamp": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

## Implementation Notes

1. **Regional Availability**: For Stagehand compatibility, if `browserbaseSessionCreateParams.region` is not "us-west-2", return `{sessionId: null, available: false}`.

2. **Session Lifecycle**: Sessions should support both the Wallcrawler native format (`/start-session`) and Stagehand-compatible format (`/sessions/start`).

3. **Streaming**: All operation endpoints must support streaming responses using Server-Sent Events format.

4. **Error Propagation**: LLM errors and browser errors should be propagated through the streaming interface as system events with `status: "error"`.

5. **Metadata**: Preserve user metadata between session creation and operations.

6. **Timeouts**: Respect timeout parameters for DOM settling, actions, and navigation.

## SDK Integration

The Wallcrawler SDK should provide a `request` method that matches this interface:

```typescript
class Sessions {
  async request(path: string, options?: RequestOptions): Promise<Response>;
}
```

This allows the Stagehand API client to route requests through the SDK seamlessly.
