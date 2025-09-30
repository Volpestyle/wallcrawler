# DynamoDB Schema

## Overview

Wallcrawler uses four DynamoDB tables to manage multi-tenant browser sessions and configuration:

| Table | Purpose | Primary Key | Notes |
|-------|---------|-------------|-------|
| `wallcrawler-sessions` | Session lifecycle state, connection metadata, audit history | `sessionId` (string) | TTL on `expiresAt`, streams enabled |
| `wallcrawler-projects` | Project configuration (quotas, defaults) | `projectId` (string) | No secondary indexes |
| `wallcrawler-api-keys` | Wallcrawler API keys (hashed) | `apiKeyHash` (string) | GSI on `projectId-index` |
| `wallcrawler-contexts` | Browser context metadata and S3 storage keys | `contextId` (string) | One item per persisted context |

All tables use on-demand billing mode and point-in-time recovery (PITR).

---

## `wallcrawler-sessions`

**Primary key**: `sessionId` (string)  
**TTL attribute**: `expiresAt` (number) – seconds since epoch  
**Stream**: `NEW_AND_OLD_IMAGES` (consumed by `sessions-stream-processor`)  
**Global Secondary Indexes**:
- `projectId-createdAt-index` → PK `projectId` (string), SK `createdAt` (ISO8601 string)
- `status-expiresAt-index` → PK `status` (string), SK `expiresAt` (number, KEYS_ONLY)

| Attribute | Type | Description |
|-----------|------|-------------|
| `sessionId` | `S` | Canonical session identifier (`sess_xxxx`) |
| `status` | `S` | SDK-visible status (`RUNNING`, `COMPLETED`, `ERROR`, `TIMED_OUT`) |
| `internalStatus` | `S` | Detailed lifecycle status (`CREATING`, `PROVISIONING`, `READY`, etc.) |
| `projectId` | `S` | Owning project |
| `createdAt` / `updatedAt` / `startedAt` | `S` | ISO8601 timestamps |
| `expiresAt` | `N` | Unix timestamp used for TTL and status GSI |
| `keepAlive` | `BOOL` | Indicates whether the container should persist beyond default timeout |
| `region` | `S` | Target AWS region (currently informational) |
| `publicIP` | `S` | Public IP assigned to the Fargate task |
| `ecsTaskArn` | `S` | Task ARN for cleanup/diagnostics |
| `connectUrl` | `S` | Signed WebSocket URL for Direct Mode (optional) |
| `signingKey` | `S` | JWT token returned to the client (restricted access) |
| `seleniumRemoteUrl` | `S` | Optional Remote WebDriver endpoint |
| `contextId` | `S` | Associated browser context (if provided) |
| `contextPersist` | `BOOL` | Persist context back to S3 on shutdown |
| `contextStorageKey` | `S` | S3 key (`<projectId>/<contextId>/profile.tar.gz`) |
| `proxyBytes` | `N` | Data transfer usage counter |
| `avgCpuUsage` / `memoryUsage` | `N` | Aggregated resource metrics (optional) |
| `eventHistory` | `L` | Array of EventBridge event envelopes (for auditing) |
| `lastEventTimestamp` | `S` | Last event recorded by the controller/processor |
| `retryCount` | `N` | Automatic retry attempts |
| `userMetadata` | `M` | Arbitrary JSON metadata supplied by clients |

### Lifecycle

1. `sessions-create` seeds the record with `CREATING` status, TTL (`expiresAt`), and signing key.  
2. `ecs-task-processor` updates the record when the ECS task reaches `RUNNING` (public IP, `connectUrl`, `internalStatus=READY`).  
3. The DynamoDB stream notifies `sessions-stream-processor`, which publishes to SNS (`wallcrawler-session-ready`).  
4. `sessions-update` transitions the status to `STOPPED` and stops the task when `REQUEST_RELEASE` is received.  
5. DynamoDB TTL removes the item after the configured timeout window if no manual cleanup occurs.

---

## `wallcrawler-projects`

**Primary key**: `projectId` (string)

| Attribute | Type | Description |
|-----------|------|-------------|
| `projectId` | `S` | Project identifier (`project_default`, etc.) |
| `name` | `S` | Human-friendly name |
| `ownerId` | `S` (optional) | External owner identifier |
| `defaultTimeout` | `N` | Default session timeout (seconds) |
| `concurrency` | `N` | Max concurrent sessions allowed |
| `status` | `S` | `ACTIVE` or `INACTIVE` |
| `createdAt` / `updatedAt` | `S` | ISO8601 timestamps |
| `billingTier` | `S` (optional) | Future pricing tier hook |

The authorizer validates that the selected project is active before issuing an allow policy.

---

## `wallcrawler-api-keys`

**Primary key**: `apiKeyHash` (string, SHA-256 of the raw key)  
**Global Secondary Index**: `projectId-index` (PK `projectId`)

| Attribute | Type | Description |
|-----------|------|-------------|
| `apiKeyHash` | `S` | SHA-256 hash of the customer provided API key |
| `keyId` | `S` (optional) | Friendly identifier for metrics | 
| `projectId` | `S` | Primary project for billing/metrics |
| `projectIds` | `L` | List of additional accessible projects |
| `name` | `S` (optional) | Label for internal use |
| `status` | `S` | `ACTIVE` or `INACTIVE` |
| `createdAt` | `S` | Creation timestamp |
| `lastUsedAt` | `S` (optional) | Populated by the authorizer if enabled |

`sessions-create` and other handlers pull the authorized project list from custom authorizer context rather than querying this table directly.

---

## `wallcrawler-contexts`

**Primary key**: `contextId` (string)

| Attribute | Type | Description |
|-----------|------|-------------|
| `contextId` | `S` | Context identifier (`ctx_xxxx`) |
| `projectId` | `S` | Owning project |
| `storageKey` | `S` | S3 key pointing to the archived Chrome profile |
| `createdAt` / `updatedAt` | `S` | ISO8601 timestamps |
| `status` | `S` | `CREATED`, future lifecycle states |

Associated S3 bucket (`wallcrawler-contexts-*`) stores the serialized profile at `<projectId>/<contextId>/profile.tar.gz`. The ECS controller downloads this archive before Chrome starts and, when `persist=true`, uploads an updated archive on shutdown.

---

## Event-Driven Integrations

- **DynamoDB Streams**: The `wallcrawler-sessions` stream drives the `sessions-stream-processor` Lambda, which publishes `READY` notifications to SNS.  
- **SNS Topic**: `wallcrawler-session-ready` fan-outs to the waiting `sessions-create` Lambda (and any future subscribers).  
- **EventBridge**: ECS task state changes trigger `ecs-task-processor`, which enriches the session record and emits custom events for observability.

---

## TTL & Expiration

- Sessions default to a 3600-second timeout (`SESSION_TIMEOUT_HOURS` environment variable controls the cap).  
- `NormalizeSessionTimeout` enforces the maximum configured timeout.  
- Deleting the DynamoDB item (via TTL or manual cleanup) removes it from all GSIs; no additional cleanup job is required.

---

## Seeding & Administration

After a fresh deployment:

1. **Create a project** in `wallcrawler-projects` (see `docs/deploy/DEPLOYMENT_GUIDE.md`).
2. **Insert an API key** into `wallcrawler-api-keys` with `apiKeyHash`, `projectId`, and optional `projectIds` list.
3. Contexts and sessions are created via the public API; no manual seeding is required for those tables.

These tables form the authoritative source of truth for authentication and session state across the platform.
