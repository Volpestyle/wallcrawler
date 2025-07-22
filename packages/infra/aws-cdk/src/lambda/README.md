# WallCrawler Lambda Functions

This directory contains the Lambda functions that orchestrate browser session management for the WallCrawler AWS infrastructure. These functions implement a serverless, auto-scaling browser automation system.

## Overview

The Lambda functions provide:

- **Session Management**: Create, track, and cleanup browser sessions
- **Auto-Scaling**: Start ECS tasks on-demand based on session demand
- **Session Assignment**: Route sessions to available browser containers
- **WebSocket Proxying**: Handle CDP connections between clients and containers

## Architecture Flow

```
Client (Stagehand) → API Gateway → Lambda Functions → ECS Fargate → Browser Container
                                       ↓
                                   Redis (Session State)
```

## Functions

### Core Session Management

#### `create-session.ts`

**Purpose**: Creates new browser sessions and handles auto-scaling

**Triggered by**: `POST /sessions` from AwsBrowserProvider

**Logic**:

1. Validates API key and parses request
2. Generates unique session ID
3. Stores session metadata in Redis (`session:{id}`)
4. **Auto-Scaling Logic**:
   - Counts active sessions across all containers
   - Checks running ECS task capacity
   - Starts new Fargate task if needed (`ECS.runTask()`)
   - Adds session to `pending-sessions` Redis queue
5. Returns `connectUrl` with sessionId and JWT token

**Environment Variables Required**:

- `ECS_CLUSTER_ARN`, `ECS_SERVICE_NAME`, `ECS_TASK_DEFINITION_ARN`
- `SUBNET_IDS`, `SECURITY_GROUP_ID`
- `MAX_SESSIONS_PER_CONTAINER`, `MAX_CONTAINERS`
- `CDP_ENDPOINT` (NLB DNS) or `WEBSOCKET_API_ID`

#### `session-claim.ts`

**Purpose**: Allows browser containers to claim pending sessions

**Triggered by**: Browser containers polling for work (HTTP POST)

**Logic**:

1. Container provides its ID and current session count
2. Atomically claims sessions from `pending-sessions` queue (LPOP)
3. Updates session status to 'active' in Redis
4. Tracks container assignments
5. Returns list of claimed sessions with browser settings

**Used by**: `@wallcrawler/browser-container` polling loop

#### `get-session.ts`

**Purpose**: Retrieves session status and metadata

**Triggered by**: `GET /sessions/{id}` from AwsBrowserProvider

**Returns**: Session status, container assignment, connection count, etc.

#### `session-end.ts`

**Purpose**: Cleans up sessions and stops ECS tasks

**Triggered by**: `DELETE /sessions/{id}` from AwsBrowserProvider

**Logic**:

1. Stops associated ECS task (`ECS.stopTask()`)
2. Removes session from Redis
3. Cleans up connection mappings

### WebSocket Handling (CDP Proxy)

#### `websocket-connect.ts`

**Purpose**: Handles WebSocket connection establishment

**Triggered by**: `$connect` route on API Gateway WebSocket

**Logic**:

1. Validates JWT token from query params
2. Associates connection with session
3. Stores connection mapping in Redis

#### `websocket-message.ts`

**Purpose**: Proxies CDP messages between client and container

**Triggered by**: WebSocket messages on API Gateway

**Logic**:

1. Routes CDP commands to correct container
2. Handles responses back to client
3. Manages session state updates

#### `websocket-disconnect.ts`

**Purpose**: Cleans up WebSocket connections

**Triggered by**: `$disconnect` route on API Gateway WebSocket

**Logic**:

1. Removes connection from Redis
2. Updates session connection count

## Redis Data Structure

The functions use Redis for coordination:

```
# Session data
session:{sessionId} → Hash {
  sessionId, userId, status, createdAt, lastActivity,
  timeout, browserSettings, containerId, taskArn
}

# Session assignment queue
pending-sessions → List [sessionId1, sessionId2, ...]

# Container tracking
container:{containerId} → Hash {
  lastHeartbeat, activeSessions, maxSessions
}
container:{containerId}:sessions → Set {sessionId1, sessionId2, ...}

# WebSocket connections
session:{sessionId}:connections → Set {connectionId1, connectionId2, ...}
connection:{connectionId} → Hash {sessionId, userId, connectedAt}
```

## Auto-Scaling Logic Implementation

### Session Creation Flow

1. **Client Request**: AwsBrowserProvider calls `create-session.ts`
2. **Capacity Check**: Lambda queries ECS service for running tasks
3. **Session Count**: Lambda counts active sessions in Redis
4. **Decision**: If `activeSessions >= (runningTasks * maxSessions)`, start new task
5. **Task Start**: `ECS.runTask()` with browser-container image
6. **Queue**: Add session to `pending-sessions` for containers to claim

### Container Assignment Flow

1. **Container Startup**: Browser container starts, gets env vars from ECS
2. **Polling**: Container calls `session-claim.ts` every few seconds
3. **Claiming**: Lambda atomically assigns sessions from queue
4. **Browser Start**: Container launches Chrome for claimed sessions
5. **Registration**: Container registers CDP endpoints for routing

### Session Cleanup Flow

1. **Client End**: AwsBrowserProvider calls `session-end.ts`
2. **Task Stop**: Lambda stops the ECS task running the session
3. **Cleanup**: Remove from Redis, close connections

## Environment Variables

All functions require:

- `REDIS_ENDPOINT`: ElastiCache Redis cluster endpoint
- `ENVIRONMENT`: dev/staging/prod
- `JWE_SECRET_ARN`: Secrets Manager ARN for JWT signing

Session management functions additionally require:

- `ECS_CLUSTER_ARN`: ECS cluster where browser tasks run
- `ECS_SERVICE_NAME`: ECS service name for capacity checks
- `ECS_TASK_DEFINITION_ARN`: Task definition for browser containers
- `SUBNET_IDS`: Comma-separated VPC subnet IDs
- `SECURITY_GROUP_ID`: Security group for browser tasks
- `MAX_SESSIONS_PER_CONTAINER`: Browser sessions per container (default: 20)
- `MAX_CONTAINERS`: Maximum ECS tasks (default: 10)

WebSocket functions require:

- `CDP_ENDPOINT`: NLB DNS name for CDP routing
- `WEBSOCKET_API_ID`: API Gateway WebSocket ID (fallback)

## Deployment

These functions are deployed by the CDK stack in `src/stacks/`. The CDK:

1. Creates Lambda functions with appropriate IAM roles
2. Sets environment variables from SSM parameters
3. Configures API Gateway routes and triggers
4. Sets up ECS cluster and task definitions

## Testing

To test the complete flow:

1. Deploy CDK stack: `cdk deploy`
2. Use AwsBrowserProvider to create session
3. Monitor CloudWatch logs for scaling decisions
4. Check Redis for session assignments
5. Verify ECS tasks start as needed

## Performance Characteristics

- **Cold Start**: ~2-3 seconds for session creation
- **Scaling**: New ECS task starts in ~30-60 seconds
- **Capacity**: 20 sessions per container, 10 containers = 200 concurrent sessions
- **Cost**: True serverless - pay only for active sessions
