# WallCrawler Proxy Service

## Overview

This component is the **routing and orchestration layer** of WallCrawler, running as an ECS service. It acts as a load balancer and proxy between clients (via API Gateway/Lambda) and browser containers. It manages container registrations, routes session requests, proxies WebSocket/CDP traffic, and handles health monitoring.

The Proxy is internal-facing: it exposes endpoints for container registration and uses WebSockets for communication with containers. Public interactions are handled upstream by Lambda/API Gateway.

## Key Features and Details

- **Container Management**: Registers browser containers via `/internal/register`, maintains a pool of available containers, and establishes persistent WebSockets.
- **Session Routing**: Selects optimal containers for new sessions, forwards commands like `CREATE_SESSION` and CDP messages.
- **WebSocket Proxying**: Handles client WebSocket connections, routing to container WebSockets.
- **Health Monitoring**: Receives health updates from containers, stores in Redis for scaling decisions.
- **Authentication**: Verifies container tokens and client JWTs (via `jwe-utils.ts`).
- **Endpoints**:
  - `/internal/register`: POST for container registration (called by containers on startup).
  - `/health`: For ECS health checks.
- **Environment Variables** (examples):
  - `PORT`: Server port (default: 8080).
  - `REDIS_ENDPOINT`: For storing container/session data.
  - `JWE_SECRET_ARN`: ARN for JWT secret in Secrets Manager.
  - `ECS_CLUSTER_NAME`: For managing ECS tasks.

The entry point is `index.ts`, which sets up the server and handlers.

## How It Ties Into the Bigger Picture

- **Relationship to Lambda**: Receives session details from Lambda (after public session creation). Lambda creates metadata in Redis; Proxy reads it to route to containers.
- **Relationship to Container**: Containers register here on startup. Proxy pushes session commands via WebSocket and receives responses (e.g., `SESSION_READY`, CDP responses).
- **Overall Flow**:
  1. Container starts → Registers with Proxy via `/internal/register` → Proxy opens WS.
  2. Client creates session via Lambda → Lambda stores in Redis → Proxy detects and selects container.
  3. Proxy sends `CREATE_SESSION` to container via WS → Container creates browser → Proxy proxies CDP traffic.
  4. Health data from containers synced to Redis for monitoring/auto-scaling.

This enables dynamic scaling: Proxy balances load across registered containers, and can trigger new ECS tasks if needed.

## Deployment Notes

- Deployed as an ECS service via AWS CDK (in `stacks/`).
- Scaled based on CPU/memory via Auto Scaling Groups.
- Monitor via CloudWatch and ECS metrics.

For local testing: `npm run build && npm start`.
