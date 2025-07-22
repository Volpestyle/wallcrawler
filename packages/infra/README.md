# WallCrawler Infrastructure Overview

This directory contains all infrastructure-related components for WallCrawler, including AWS CDK deployment code, browser providers, container definitions, and deployment scripts. It manages the deployment and operation of browser automation services in AWS.

## 📁 Directory Structure

```
infra/
├── aws-cdk/               # AWS CDK deployment code
│   ├── src/               # CDK source code
│   │   ├── app.ts         # Main CDK application entry
│   │   ├── stacks/        # CDK stacks for core and application services
│   │   └── constructs/    # Reusable CDK constructs
│   │       ├── GoLambdaConstruct.ts    # For Go Lambda deployment
│   │       └── GoContainerConstruct.ts # For Go container deployment
│   ├── cdk.json           # CDK configuration
│   └── deploy.sh          # CDK deployment script
├── aws-provider/          # TypeScript AWS browser provider
│   ├── src/               # Provider source code
│   └── package.json       # Dependencies
├── browser-container/     # Original TypeScript browser container
│   ├── src/               # Container source code
│   ├── Dockerfile         # Container build definition
│   └── build-and-push.sh  # Build script
├── go-lambda/             # Go Lambda functions (migration)
│   ├── create-session/    # Session creation Lambda
│   ├── websocket-connect/ # WebSocket connect handler
│   ├── websocket-message/ # Message routing
│   └── websocket-disconnect/ # Disconnect cleanup
├── go-container/          # Go browser container (migration)
│   ├── main.go            # Main entry point
│   ├── session_manager.go # Session handling
│   ├── screencast_manager.go # Screencast features
│   ├── Dockerfile         # Go container build
│   └── build-and-push.sh  # Go-specific build script
├── deploy-go.sh           # Go migration deployment script
├── GO_MIGRATION_README.md # Go migration details
└── README.md              # This file
```

## 🔌 How Packages Connect

WallCrawler's infrastructure is designed as a modular system where components interact through AWS services:

1. **aws-cdk/**: The core deployment engine
   - Deploys all AWS resources (ECS, Lambda, Redis, API Gateway, etc.)
   - Creates ECS clusters for browser containers
   - Deploys Lambda functions for session management
   - Configures networking (VPC, NLB, security groups)
   - Outputs configuration parameters used by other packages

2. **aws-provider/**: Client-side integration
   - TypeScript library that connects to deployed AWS resources
   - Uses API Gateway for session creation
   - Establishes WebSocket connections for real-time control
   - Integrates with Stagehand for browser automation
   - Consumes configuration from CDK outputs (e.g., API endpoints)

3. **browser-container/**: Original runtime environment
   - Docker container running TypeScript code
   - Deployed to ECS via CDK
   - Handles multi-session browser management
   - Communicates with Redis for state
   - Exposes WebSocket endpoints for CDP

4. **go-lambda/** and **go-container/**: Go migration components
   - Replace TypeScript equivalents
   - Deployed alongside originals for parallel operation
   - Use same AWS services (ECS, Lambda, Redis)
   - Managed by CDK constructs

### Communication Flow

- **Session Creation**: Client → API Gateway → Lambda (create-session) → Redis/ECS
- **Real-time Control**: Client → WebSocket API → Lambda (websocket-\*) → Container (via NLB/Redis)
- **State Management**: All components use Redis for sessions/connections
- **Deployment**: CDK deploys infrastructure, scripts build/push code

Visual Diagram:

```
[Client / Stagehand]
          |
    [aws-provider]
          |
   [API Gateway / WebSocket API]
          |
     [Go Lambda Functions]
          |
[Redis] <-> [Go Container in ECS]
          |
     [CloudWatch / Monitoring]
```

## 🧩 How Go Packages Fit into the Architecture

The Go packages provide a performance-optimized replacement for TypeScript components while maintaining the same architecture:

### Integration Points

- **Shared Utilities (go-shared/)**: Used by all Go components for consistency
  - Reduces code duplication across Lambdas and container
  - Handles Redis, JWT, AWS interactions uniformly

- **Go Lambda Functions (go-lambda/)**:
  - Replace TypeScript Lambdas for session management
  - Deployed via GoLambdaConstruct in CDK
  - Use same IAM roles and VPC configuration
  - Interact with Redis and ECS like originals

- **Go Container (go-container/)**:
  - Replaces TypeScript browser-container
  - Deployed to ECS via GoContainerConstruct
  - Uses chromedp for CDP instead of Playwright
  - Maintains same endpoints and Redis integration
  - Adds optimized screencast streaming

### Migration Benefits

- **Parallel Operation**: Go components deploy alongside TypeScript for gradual migration
- **Same Interfaces**: Clients see no difference in API/WebSocket endpoints
- **Improved Performance**: Go's concurrency for better multi-session handling
- **Cost Savings**: Lower resource requirements in ECS/Lambda

### Transition Plan

1. Deploy Go components in parallel
2. Route test traffic to Go endpoints
3. Monitor and optimize
4. Switch production traffic
5. Decommission TypeScript components

## 🛠️ Development Process for Making Changes

Follow this process for consistent and safe development:

### 1. Setup Local Environment

```bash
# Install dependencies
cd packages/infra/aws-cdk
npm install

# Build shared utilities
cd ../go-shared
go mod tidy

# Build Lambda functions
cd ../go-lambda/create-session
go mod tidy && go build -o bootstrap main.go
# Repeat for other Lambdas

# Build container locally
cd ../../go-container
docker build -t wallcrawler-go-dev .
```

### 2. Make Changes

- **Shared Utilities**: Update in go-shared/ and rebuild dependents
- **Lambda Functions**: Edit main.go in function directory
- **Container**: Edit Go files in go-container/
- **CDK**: Modify constructs/stacks in aws-cdk/src/

Always:

- Run `go mod tidy` after changes
- Use `gofmt` for formatting
- Add unit tests in \_test.go files

### 3. Test Locally

- **Lambda**: Use SAM CLI for local testing

  ```bash
  sam local invoke CreateSessionFunction -e event.json
  ```

- **Container**: Run Docker locally

  ```bash
  docker run -p 8080:8080 -p 9222:9222 \
      -e REDIS_ENDPOINT=localhost:6379 \
      wallcrawler-go-dev
  ```

- **Integration**: Use Postman for API testing
- **Unit Tests**: `go test ./...`

### 4. Deploy Changes

- **Lambda/CDK**: Use CDK deploy

  ```bash
  cdk deploy --context environment=development
  ```

- **Container**: Use build script

  ```bash
  ./build-and-push.sh $REPOSITORY_URI $REGION development
  ```

- **Full Deployment**: Use deploy-go.sh
  ```bash
  ./deploy-go.sh development us-east-1
  ```

### 5. Verify and Monitor

- Check CloudWatch logs
- Monitor ECS service health
- Test end-to-end functionality
- Use AWS X-Ray for tracing

### Best Practices

- **Version Control**: Use feature branches
- **CI/CD**: Integrate with GitHub Actions
- **Security**: Scan dependencies regularly
- **Documentation**: Update this README for major changes

For detailed Go migration info, see [GO_MIGRATION_README.md](./GO_MIGRATION_README.md)
