# WallCrawler Browser Container

## Overview

This component is the **browser execution layer** of WallCrawler, running in AWS ECS Fargate tasks. It manages multiple isolated browser sessions using Playwright, handling tasks like session creation, CDP command proxying, screenshot uploads to S3, and health reporting. Each container can handle up to `MAX_SESSIONS` (default: 20) concurrent browser contexts for scalability.

The container is designed as a worker node: it registers itself with the Proxy Service on startup and communicates via internal WebSockets. It does not expose public APIs—all client interactions are routed through the Proxy.

## Key Features and Details

- **Multi-Session Management**: Creates isolated Playwright browser contexts and pages per session, with sandboxing for security (via `session-sandbox.ts`).
- **CDP Proxying**: Handles Chrome DevTools Protocol (CDP) commands from clients, enabling remote browser control.
- **Artifact Handling**: Uploads screenshots to S3 and manages video recordings if enabled.
- **Health and Cleanup**: Periodic health reports to Redis/Proxy, automatic cleanup of idle sessions.
- **WebSocket Communication**: Listens on `/internal/ws` for commands from the Proxy (e.g., `CREATE_SESSION`, `CLIENT_MESSAGE`).
- **Endpoints**:
  - `/health`: Simple status check for ECS health probes.
- **Environment Variables**:
  - `PORT`: Internal server port (default: 8080).
  - `CONTAINER_ID`: Unique container identifier.
  - `PROXY_ENDPOINT`: URL to register with the Proxy.
  - `MAX_SESSIONS`: Max concurrent sessions per container.
  - `REDIS_ENDPOINT`: Redis connection for metadata.
  - `S3_BUCKET`: Bucket for artifact uploads.
  - `CONTAINER_TOKEN`: Auth token for Proxy registration.

The entry point is `index.ts`, which imports and runs `multi-session.ts`.

## How It Ties Into the Bigger Picture

- **Relationship to Proxy Service**: Registers with the Proxy on startup (via `/internal/register`), establishing a WebSocket for bidirectional communication. The Proxy routes client requests (e.g., session creation) to available containers.
- **Relationship to Lambda**: Doesn't interact directly—Lambdas handle public session creation (storing metadata in Redis). Containers pull from Redis when instructed by the Proxy.
- **Overall Flow**:
  1. ECS launches container → Registers with Proxy.
  2. Client creates session via Lambda → Proxy selects container → Sends `CREATE_SESSION` via WS.
  3. Container runs browser tasks, proxies CDP, uploads artifacts to S3.
  4. Health data synced to Redis for monitoring.

This setup allows horizontal scaling: Add more ECS tasks to handle more sessions, with the Proxy load-balancing.

## Deployment Notes

- Deployed as ECS Fargate tasks via AWS CDK (in `stacks/`).
- Use `build-and-push.sh` to build and push the Docker image to ECR.
- Monitor via CloudWatch (logs) and ECS health checks.

For local testing: `npm run build && npm start` (runs on Node.js).
