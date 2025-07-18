# WallCrawler Lambda Functions

## Overview

This component contains the **serverless API layer** of WallCrawler, implemented as AWS Lambda functions. It handles public-facing requests, such as session creation and authentication, serving as the entry point for clients (e.g., Stagehand via AwsProvider). These functions are lightweight, stateless, and integrated with API Gateway for external access.

Lambdas focus on orchestration: validating requests, generating secure tokens, and storing initial session metadata in Redis. They do not run browsers—that's delegated to containers via the Proxy.

The directory structure includes:

- **functions/**: Individual Lambda handlers (e.g., `create-session.ts` for session creation).
- **utils/**: Shared utilities (e.g., JWT/JWE helpers).
- **layers/**: Lambda layers for shared dependencies if needed.

## Key Features and Details

- **Session Creation**: Validates API keys, generates unique session IDs and JWE tokens, stores metadata in Redis (e.g., timeout, settings).
- **Authentication**: Uses Secrets Manager for API keys and JWE secrets; derives user IDs from keys.
- **Integration**: Returns WebSocket URLs and tokens for clients to connect to the Proxy.
- **Endpoints** (exposed via API Gateway):
  - `/sessions` (or similar): POST to create new sessions.
- **Environment Variables**:
  - `REDIS_ENDPOINT`: For storing session data.
  - `JWE_SECRET_ARN`: ARN for JWE secret in Secrets Manager.
  - `API_KEYS_SECRET_ARN`: ARN for allowed API keys.
  - `ALB_DNS_NAME`: For constructing WebSocket URLs.

Primary entry point: Functions like `create-session.ts` are deployed as separate Lambdas.

## How It Ties Into the Bigger Picture

- **Relationship to Proxy**: Provides session details (ID, token, WS URL) that clients use to connect to the Proxy. The Proxy then selects and communicates with containers.
- **Relationship to Container**: Indirect—containers receive session commands from the Proxy after Lambda initializes metadata in Redis.
- **Overall Flow**:
  1. Client requests session via API Gateway → Lambda validates and creates metadata in Redis.
  2. Lambda returns connection details to client.
  3. Client connects to Proxy with token → Proxy reads Redis and routes to container.
  4. Container executes browser tasks, with Proxy handling traffic.

This serverless design keeps costs low for infrequent requests while offloading heavy work to ECS.

## Deployment Notes

- Deployed as Lambda functions via AWS CDK (in `stacks/`).
- Integrated with API Gateway for HTTP/WS APIs.
- Use Secrets Manager for sensitive data; grant Lambda IAM permissions accordingly.

For local testing: Use SAM CLI or run functions with mock events (e.g., `node create-session.js` with test input).
