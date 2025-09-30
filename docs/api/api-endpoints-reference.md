# Wallcrawler API Endpoints Reference

## Quick Reference

### ✅ Production Ready - SDK Endpoints (`/v1/*`)

| Method | Endpoint                      | Purpose                           | Handler                      | Status                  |
| ------ | ----------------------------- | --------------------------------- | ---------------------------- | ----------------------- |
| `POST` | `/v1/sessions`                | Create browser session            | `sdk/sessions-create`        | ✅ **Implemented**      |
| `GET`  | `/v1/sessions`                | List user sessions                | `sdk/sessions-list`          | ✅ **Implemented**      |
| `GET`  | `/v1/sessions/{id}`           | Get session details               | `sdk/sessions-retrieve`      | ✅ **Implemented**      |
| `POST` | `/v1/sessions/{id}`           | Update session (terminate)        | `sdk/sessions-update`        | ✅ **Implemented**      |
| `GET`  | `/v1/sessions/{id}/debug`     | Get debug/live URLs               | `sdk/sessions-debug`         | ✅ **Implemented**      |
| `GET`  | `/v1/sessions/{id}/logs`      | Session logs                      | `common/not-implemented`     | 🚫 **Not implemented**  |
| `GET`  | `/v1/sessions/{id}/recording` | Session recording                 | `common/not-implemented`     | 🚫 **Not implemented**  |
| `POST` | `/v1/sessions/{id}/uploads`   | Asset uploads                     | `common/not-implemented`     | 🚫 **Not implemented**  |
| `POST` | `/v1/contexts`                | Create reusable browser context   | `sdk/contexts-create`        | ✅ **Implemented**      |
| `GET`  | `/v1/contexts/{id}`           | Retrieve context metadata         | `sdk/contexts-retrieve`      | ✅ **Implemented**      |
| `PUT`  | `/v1/contexts/{id}`           | Refresh context upload URL        | `sdk/contexts-update`        | ✅ **Implemented**      |
| `GET`  | `/v1/projects`                | List accessible projects          | `sdk/projects-list`          | ✅ **Implemented**      |
| `GET`  | `/v1/projects/{id}`           | Retrieve project details          | `sdk/projects-retrieve`      | ✅ **Implemented**      |
| `GET`  | `/v1/projects/{id}/usage`     | Aggregate usage metrics by project| `sdk/projects-usage`         | ✅ **Implemented**      |
| `POST` | `/v1/extensions`              | Upload extension                  | `common/not-implemented`     | 🚫 **Not implemented**  |
| `GET`  | `/v1/extensions/{id}`         | Retrieve extension                | `common/not-implemented`     | 🚫 **Not implemented**  |
| `DELETE` | `/v1/extensions/{id}`       | Delete extension                  | `common/not-implemented`     | 🚫 **Not implemented**  |

### 🔄 Stubbed - API Mode Endpoints (`/sessions/*`)

| Method | Endpoint                      | Purpose                   | Handler              | Status         |
| ------ | ----------------------------- | ------------------------- | -------------------- | -------------- |
| `POST` | `/sessions/start`             | Create AI-powered session | `api/sessions-start` | 🔄 **Stubbed** |
| `POST` | `/sessions/{id}/act`          | AI browser actions        | -                    | 🔄 **Stubbed** |
| `POST` | `/sessions/{id}/extract`      | AI data extraction        | -                    | 🔄 **Stubbed** |
| `POST` | `/sessions/{id}/observe`      | AI page observation       | -                    | 🔄 **Stubbed** |
| `POST` | `/sessions/{id}/navigate`     | AI navigation             | -                    | 🔄 **Stubbed** |
| `POST` | `/sessions/{id}/agentExecute` | AI agent workflows        | -                    | 🔄 **Stubbed** |

### ✅ Direct Mode Support

`POST /v1/sessions` returns `connectUrl`, `signingKey`, and `seleniumRemoteUrl` once the browser is ready. Subsequent `GET /v1/sessions/{id}` requests re-hydrate the same values for reconnects, so no standalone `/sessions/{id}/cdp-url` endpoint is required.

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
    "viewport": { "width": 1280, "height": 720 },
    "context": { "id": "ctx_ab12cd34", "persist": true }
  },
  "keepAlive": false,
  "timeout": 3600,
  "userMetadata": { "environment": "test" }
}
```

**Response**:

```typescript
{
  "id": "sess_abc123",
  "status": "RUNNING",
  "connectUrl": "ws://203.0.113.10:9223?signingKey=eyJhbGci...",
  "publicIp": "203.0.113.10",
  "seleniumRemoteUrl": "http://203.0.113.10:4444/wd/hub",
  "createdAt": "2024-01-15T10:30:00Z",
  "expiresAt": "2024-01-15T11:30:00Z",
  "projectId": "project_123",
  "keepAlive": false,
  "region": "us-east-1",
  "signingKey": "eyJhbGciOi..."
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
    "connectUrl": "ws://203.0.113.10:9223?signingKey=eyJhbGci...",
    "seleniumRemoteUrl": "http://203.0.113.10:4444/wd/hub",
    "publicIP": "203.0.113.10",
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-15T10:30:45Z",
    "expiresAt": "2024-01-15T11:30:00Z",
    "keepAlive": false,
    "region": "us-east-1",
    "signingKey": "eyJhbGciOi...",
    "userMetadata": { "environment": "test" }
  }
}
```

> ⚠️ `GET /v1/sessions/{id}/logs`, `GET /v1/sessions/{id}/recording`, and `POST /v1/sessions/{id}/uploads` currently return `501 Not Implemented` while the capture pipeline is finalized.

#### `POST /v1/contexts` - Create Context

**Purpose**: Create a reusable browser context container and obtain a pre-signed S3 upload URL for the initial profile archive.  
**Handler**: `packages/backend-go/cmd/sdk/contexts-create/`

```typescript
{
  "success": true,
  "data": {
    "id": "ctx_ab12cd34",
    "cipherAlgorithm": "NONE",
    "initializationVectorSize": 0,
    "publicKey": "",
    "uploadUrl": "https://s3.amazonaws.com/..."
  }
}
```

Upload the compressed Chrome profile (tar.gz) to the provided URL within 15 minutes. The archive is stored under `projectId/contextId/profile.tar.gz` in the contexts bucket.

#### `GET /v1/contexts/{id}` - Retrieve Context

Returns the context metadata (project, created/updated timestamps) for the authorized project.  
**Handler**: `packages/backend-go/cmd/sdk/contexts-retrieve/`

#### `PUT /v1/contexts/{id}` - Refresh Context Upload URL

Generates a new pre-signed upload URL so a client can persist the latest browser state.  
**Handler**: `packages/backend-go/cmd/sdk/contexts-update/`

#### `GET /v1/projects` - List Projects

Returns all projects associated with the caller's API key. When a key spans multiple projects the response contains one entry per project.  
**Handler**: `packages/backend-go/cmd/sdk/projects-list/`

```typescript
{
  "success": true,
  "data": [
    {
      "id": "project_default",
      "name": "Default Project",
      "defaultTimeout": 3600,
      "concurrency": 5
    },
    {
      "id": "project_beta",
      "name": "Beta Project",
      "defaultTimeout": 1800,
      "concurrency": 2
    }
  ]
}
```

#### `GET /v1/projects/{id}` - Retrieve Project

Fetches metadata (name, concurrency limit, default timeout) for the specified project. The ID must be one of the projects allowed for the API key; when the key has multiple projects, set `x-wc-project-id` to the project you want to retrieve.  
**Handler**: `packages/backend-go/cmd/sdk/projects-retrieve/`

#### `GET /v1/projects/{id}/usage` - Project Usage

Aggregates session durations (in minutes) and proxy byte consumption for the project using the sessions table. The `{id}` must be an allowed project and can be selected with the `x-wc-project-id` header.  
**Handler**: `packages/backend-go/cmd/sdk/projects-usage/`

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
