# Wallcrawler API Endpoints Reference

## Quick Reference

### ✅ Production Ready - SDK Endpoints (`/v1/*`)

| Method | Endpoint                      | Purpose                    | Handler                 | Status             |
| ------ | ----------------------------- | -------------------------- | ----------------------- | ------------------ |
| `POST` | `/v1/sessions`                | Create browser session     | `sdk/sessions-create`   | ✅ **Implemented** |
| `GET`  | `/v1/sessions`                | List user sessions         | `sdk/sessions-list`     | ✅ **Implemented** |
| `GET`  | `/v1/sessions/{id}`           | Get session details        | `sdk/sessions-retrieve` | ✅ **Implemented** |
| `POST` | `/v1/sessions/{id}`           | Update session (terminate) | `sdk/sessions-update`   | ✅ **Implemented** |
| `GET`  | `/v1/sessions/{id}/debug`     | Get debug/live URLs        | `sdk/sessions-retrieve` | ✅ **Implemented** |
| `GET`  | `/v1/sessions/{id}/logs`      | Get session logs           | `sdk/sessions-retrieve` | ✅ **Implemented** |
| `GET`  | `/v1/sessions/{id}/recording` | Get session recording      | `sdk/sessions-retrieve` | ✅ **Implemented** |

### 🔄 Stubbed - API Mode Endpoints (`/sessions/*`)

| Method | Endpoint                      | Purpose                   | Handler              | Status         |
| ------ | ----------------------------- | ------------------------- | -------------------- | -------------- |
| `POST` | `/sessions/start`             | Create AI-powered session | `api/sessions-start` | 🔄 **Stubbed** |
| `POST` | `/sessions/{id}/act`          | AI browser actions        | -                    | 🔄 **Stubbed** |
| `POST` | `/sessions/{id}/extract`      | AI data extraction        | -                    | 🔄 **Stubbed** |
| `POST` | `/sessions/{id}/observe`      | AI page observation       | -                    | 🔄 **Stubbed** |
| `POST` | `/sessions/{id}/navigate`     | AI navigation             | -                    | 🔄 **Stubbed** |
| `POST` | `/sessions/{id}/agentExecute` | AI agent workflows        | -                    | 🔄 **Stubbed** |

### ✅ Custom - Wallcrawler Specific Endpoints

| Method | Endpoint                 | Purpose                  | Handler   | Status             |
| ------ | ------------------------ | ------------------------ | --------- | ------------------ |
| `POST` | `/sessions/{id}/cdp-url` | Generate signed CDP URLs | `cdp-url` | ✅ **Implemented** |

## Detailed Endpoint Documentation

### SDK Endpoints (`/v1/*`) - Production Ready

#### `POST /v1/sessions` - Create Session

**Purpose**: Create a new basic browser session (Browserbase-compatible)  
**Handler**: `packages/backend-go/cmd/sdk/sessions-create/`

**Request**:

```typescript
{
  "projectId": "project_123",
  "browserSettings": {
    "viewport": { "width": 1280, "height": 720 }
  },
  "timeout": 3600,
  "userMetadata": { "environment": "test" }
}
```

**Response**:

```typescript
{
  "success": true,
  "data": {
    "id": "sess_abc123",
    "connectUrl": "wss://api.wallcrawler.dev/sessions/sess_abc123/connect"
  }
}
```

#### `POST /v1/sessions/{id}` - Update Session

**Purpose**: Update session (primarily for termination via `REQUEST_RELEASE`)  
**Handler**: `packages/backend-go/cmd/sdk/sessions-update/`

**Request**:

```typescript
{
  "projectId": "project_123",
  "status": "REQUEST_RELEASE"
}
```

**Response**:

```typescript
{
  "success": true,
  "data": {
    "id": "sess_abc123",
    "status": "TERMINATING",
    "projectId": "project_123"
  }
}
```

#### `GET /v1/sessions/{id}` - Retrieve Session

**Purpose**: Get session details and status  
**Handler**: `packages/backend-go/cmd/sdk/sessions-retrieve/`

**Response**:

```typescript
{
  "success": true,
  "data": {
    "id": "sess_abc123",
    "status": "RUNNING",
    "projectId": "project_123",
    "connectUrl": "wss://api.wallcrawler.dev/sessions/sess_abc123/connect",
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-15T10:30:30Z",
    "userMetadata": { "environment": "test" }
  }
}
```

### API Mode Endpoints (`/sessions/*`) - Stubbed

#### `POST /sessions/start` - AI Session Start (Stubbed)

**Purpose**: Create AI-powered session for Stagehand API mode  
**Handler**: `packages/backend-go/cmd/api/sessions-start/`  
**Current Status**: Returns clear "not implemented" message

**Request** (when implemented):

```typescript
{
  "modelName": "gpt-4",
  "modelApiKey": "sk-...",
  "systemPrompt": "You are a helpful browser assistant",
  "domSettleTimeoutMs": 10000
}
```

**Current Response**:

```typescript
{
  "success": false,
  "message": "AI-powered sessions not implemented yet. Use basic sessions via POST /v1/sessions for now."
}
```

### Custom Wallcrawler Endpoints

#### `POST /sessions/{id}/cdp-url` - Generate Signed CDP URL

**Purpose**: Generate JWT-signed CDP URLs for secure Direct Mode access  
**Handler**: `packages/backend-go/cmd/cdp-url/`

**Request**:

```typescript
{
      "expiresIn": 600
}
```

**Response**:

```typescript
{
  "success": true,
  "data": {
    "cdpUrl": "wss://12.34.56.78:9223/session/sess_abc123",
    "signingKey": "jwt-token-here",
    "expiresAt": "2024-01-15T11:30:00Z"
  }
}
```

## Authentication

All endpoints require these headers:

```yaml
x-wc-api-key: 'your-api-key' # Required: API authentication
x-wc-project-id: 'your-project-id' # Required: Project identification
Content-Type: 'application/json' # Required for POST requests
```

## Response Format

All endpoints follow this consistent format:

```typescript
// Success
{
  "success": true,
  "data": { /* endpoint-specific response */ }
}

// Error
{
  "success": false,
  "message": "Descriptive error message"
}
```

## Implementation Roadmap

### ✅ Phase 1: SDK & Direct Mode (Complete)

- All `/v1/*` endpoints implemented and production-ready
- Custom CDP URL generation for Direct Mode
- Full Browserbase API compatibility

### 🔄 Phase 2: API Mode (Future)

- `/sessions/start` implementation with AI configuration
- AI operation endpoints (`/act`, `/extract`, `/observe`, etc.)
- Server-side LLM processing and streaming responses

## Usage Examples

### Basic Session with SDK

```typescript
// 1. Create session
const session = await wallcrawler.sessions.create({
  projectId: 'project_123',
});

// 2. Use with Stagehand
const stagehand = new Stagehand({
  env: 'WALLCRAWLER',
  useAPI: false, // Direct mode
  browserbaseSessionID: session.id,
});

await stagehand.init();
await stagehand.page.goto('https://example.com');
```

### Direct Mode with CDP URL

```typescript
// 1. Create session
const session = await wallcrawler.sessions.create({
  projectId: 'project_123',
});

// 2. Get signed CDP URL
const cdpResponse = await fetch(`/sessions/${session.id}/cdp-url`, {
  method: 'POST',
  headers: { 'x-wc-api-key': 'your-key' },
  body: JSON.stringify({ expiresIn: 600 }),
});
const { cdpUrl } = await cdpResponse.json();

// 3. Use directly with Chrome DevTools Protocol
const browser = await playwright.chromium.connectOverCDP(cdpUrl);
```
