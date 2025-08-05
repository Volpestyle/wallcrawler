# SDK Integration Guide

This document outlines how the Wallcrawler SDK-node integrates with the Go backend services.

## Architecture Overview

```
Jobseek App → SDK-node → Public Proxy → API Gateway → Go Lambda Handlers → DynamoDB/ECS
```

## Endpoint Mapping

| SDK Method | HTTP Request | Go Handler | Purpose |
|------------|--------------|------------|---------|
| `sessions.create()` | `POST /v1/sessions` | `sdk/sessions-create` | Create browser session |
| `sessions.list()` | `GET /v1/sessions` | `sdk/sessions-list` | List user sessions |
| `sessions.retrieve()` | `GET /v1/sessions/{id}` | `sdk/sessions-retrieve` | Get session details |
| `sessions.update()` | `POST /v1/sessions/{id}` | `sdk/sessions-update` | Update session status |
| `sessions.debug()` | `GET /v1/sessions/{id}/debug` | `sdk/sessions-debug` | Get debug URLs |

## Authentication

The SDK requires only the Wallcrawler API key:

```typescript
{
  'x-wc-api-key': 'your-wallcrawler-api-key'
}
```

## Client Configuration

### Environment Variables
```bash
WALLCRAWLER_API_KEY=your-api-key
WALLCRAWLER_API_URL=https://api.wallcrawler.dev
```

### SDK Initialization
```typescript
import { Wallcrawler } from '@wallcrawler/sdk'

const wallcrawler = new Wallcrawler({
  apiKey: process.env.WALLCRAWLER_API_KEY,
  baseURL: process.env.WALLCRAWLER_API_URL
})
```

## Session Filtering

The SDK supports filtering sessions by user metadata using the `q` parameter:

### String Search
```typescript
// Search for any metadata containing "user123"
const sessions = await wallcrawler.sessions.list({
  q: 'user123',
  status: 'RUNNING'
})
```

### JSON Query
```typescript
// Exact match on metadata fields
const sessions = await wallcrawler.sessions.list({
  q: JSON.stringify({ userId: 'user123' }),
  status: 'RUNNING'
})
```

## Request/Response Formats

### Create Session
**Request:**
```typescript
{
  projectId: string,
  userMetadata?: {
    userId: string,
    keywords?: string,
    location?: string,
    jobBoard?: string,
    [key: string]: any
  },
  region?: 'us-east-1' | 'us-west-2' | 'eu-central-1' | 'ap-southeast-1',
  timeout?: number,
  keepAlive?: boolean
}
```

**Response:**
```typescript
{
  id: string,
  connectUrl: string,
  seleniumRemoteUrl: string,
  signingKey: string,
  status: 'RUNNING',
  createdAt: string,
  expiresAt: string,
  // ... other session fields
}
```

### List Sessions
**Response:**
```typescript
[
  {
    id: string,
    status: 'RUNNING' | 'ERROR' | 'TIMED_OUT' | 'COMPLETED',
    createdAt: string,
    updatedAt: string,
    expiresAt: string,
    userMetadata: Record<string, unknown>,
    // ... other session fields
  }
]
```

## Status Mapping

The Go backend maps internal statuses to SDK-compatible statuses:

| Internal Status | SDK Status |
|----------------|------------|
| CREATING, PROVISIONING, STARTING | RUNNING |
| READY, ACTIVE | RUNNING |
| TERMINATING | RUNNING |
| STOPPED | COMPLETED |
| FAILED | ERROR |

## Error Handling

The SDK throws typed errors for different scenarios:

```typescript
try {
  const session = await wallcrawler.sessions.create({ projectId: 'proj123' })
} catch (error) {
  if (error.status === 401) {
    // Authentication error - check API keys
  } else if (error.status === 500) {
    // Server error - retry or check logs
  }
}
```

## Best Practices

1. **Always handle errors** - The SDK throws on non-2xx responses
2. **Use metadata filtering** - Query sessions efficiently with the `q` parameter
3. **Set appropriate timeouts** - Default is 24 hours, adjust based on your needs
4. **Clean up sessions** - Use `sessions.update()` with `status: 'REQUEST_RELEASE'` when done