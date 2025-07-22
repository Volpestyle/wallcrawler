# @wallcrawler/aws-cdk

AWS CDK package for deploying WallCrawler's browser automation infrastructure. This package creates a serverless stack using AWS services to run scalable, AI-powered browser sessions. It integrates with `@wallcrawler/browser-container` for running Chrome instances and connects to `@wallcrawler/stagehand` for client-side automation.

## Overview

This CDK app deploys:

- **API Gateway** for REST and WebSocket APIs
- **Lambda Functions** for orchestration and session management
- **ECS Fargate** tasks running the `@wallcrawler/browser-container` Docker image
- **ElastiCache Redis** for session state
- **S3** for artifacts (screenshots, videos)
- **SSM Parameter Store** for configuration

Key benefits:

- True serverless (pay-per-use, auto-scaling)
- Secure CDP/WebSocket connections
- Integration with Stagehand for AI browser control

## Architecture

```mermaid
graph TB
    subgraph "Client (@wallcrawler/stagehand)"
        Stagehand[Stagehand] --> AwsProvider[AwsBrowserProvider]
    end

    subgraph "AWS Infrastructure (this CDK)"
        AwsProvider --> APIGateway[API Gateway REST/WS]
        APIGateway --> LambdaFunctions[Lambda Functions]
        LambdaFunctions --> ECS[ECS Fargate Cluster]
        ECS --> BrowserContainer[@wallcrawler/browser-container]
        LambdaFunctions --> Redis[ElastiCache Redis]
        BrowserContainer --> S3[S3 Artifacts]
        LambdaFunctions --> SSM[SSM Parameters]
    end

    Stagehand -->|AI Calls| LambdaFunctions
    AwsProvider -->|CDP over WS| BrowserContainer
```

Flow:

1. Client calls `AwsProvider.getBrowser()` → Hits API Gateway → Lambda creates session in Redis → Starts ECS task with browser-container.
2. Browser-container connects back via WebSocket for CDP proxying.
3. Stagehand's AI (act/observe) calls hit Lambda, which coordinates with running browser via Redis/WS.
4. Config from SSM is loaded by AwsProvider and passed to Stagehand.

## Components

### Lambda Functions (`src/lambda/functions`)

These are the core orchestrators, called via API Gateway:

- **session-create**: Handles POST /sessions
  - Validates auth
  - Stores session in Redis
  - Starts ECS task with browser-container image
  - Returns session ID and CDP URL

- **session-get**: Handles GET /sessions/{id}
  - Fetches from Redis
  - Checks ECS task status

- **session-end**: Handles DELETE /sessions/{id}
  - Stops ECS task
  - Cleans Redis

- **ws-proxy**: Handles WebSocket connections
  - Proxies CDP between client and browser-container

How they're called:

- Stagehand → AwsProvider → fetch(API Gateway URL)
- Browser-container → WebSocket to API Gateway for registration

### Browser Container Integration (`@wallcrawler/browser-container`)

- **Deployment**: CDK pushes the Docker image to ECR, deploys as ECS task definition.
- **Connection**: Lambda starts ECS task with env vars (Redis endpoint, S3 bucket).
- **Runtime**: Container runs multi-session Chrome, connects to Redis for sessions, exposes CDP ports.
- **Interaction**: Client (Stagehand) connects via proxied CDP URL from API Gateway.

### Stagehand Interaction (`@wallcrawler/stagehand`)

- **AwsBrowserProvider**: Implements Stagehand's `BrowserProvider` interface.
  - `getBrowser()`: Calls your Lambda to create/resume session, returns Playwright context connected via CDP to browser-container.
- **API Calls**: Stagehand's `StagehandAPI` can be configured with your API Gateway URL (via `baseApiUrl`).
- **Full Flow**: Stagehand init → Provider creates session (Lambda → ECS) → Stagehand act/observe → Calls your Lambda for AI processing, which interacts with browser via Redis/WS.

### Role of Redis (ElastiCache)

- **Session State**: Stores active sessions (ID, status, ECS task ARN, CDP details).
- **Coordination**: Lambdas write session data; browser-container polls Redis for new sessions.
- **Scalability**: Enables stateless Lambdas and multi-container scaling.
- **Why Needed**: Coordinates between short-lived Lambdas and long-running ECS tasks.

### Configuration Flow

1. **Generation**: CDK deploys stack and stores config (endpoints, ARNs, secrets) in SSM Parameter Store (e.g., `/wallcrawler/dev/rest-api-endpoint`).
2. **Loading**: `@wallcrawler/aws-provider` (AwsBrowserProvider) loads from SSM via `loadFromSsm: true`.
3. **Propagation**:
   - Provider exposes `getStagehandConfig()` with `baseApiUrl`, `apiKey`, etc.
   - Pass to Stagehand constructor: `{ baseApiUrl: config.baseApiUrl, ... }`
   - Stagehand's `StagehandAPI` uses this for all calls.
4. **Browser Container**: ECS tasks get config via env vars set by CDK/Lambda (e.g., REDIS_ENDPOINT, S3_BUCKET).

This ensures all packages (@wallcrawler/stagehand, browser-container) get config consistently from SSM.

## Deployment

1. **Prerequisites**:
   - AWS CLI configured
   - Docker for building browser-container image
   - pnpm for dependencies

2. **Build Browser Container**:

   ```bash
   cd ../browser-container
   ./build-and-push.sh <ECR_REPO_URI>
   ```

3. **Deploy CDK Stack**:

   ```bash
   pnpm install
   pnpm cdk deploy --all
   ```

   - Outputs SSM path with config

4. **Update Client**:
   - Use AwsBrowserProvider with `loadFromSsm: true`

## Troubleshooting

- **CDP Connection Fails**: Check ECS task logs, ensure container image in ECR.
- **Session Timeout**: Adjust Redis TTL or ECS timeouts in CDK.
- **Config Errors**: Verify SSM parameters after deploy.
- **Scaling Issues**: Monitor AutoScaling groups in CDK config.

For full details, see source code in `src/` (stacks, constructs) and `lambda/` (functions/layers).
