# Wallcrawler Backend (Go)

This package contains the Go-based backend services for Wallcrawler, including AWS Lambda handlers and the ECS controller for browser automation.

## Architecture

```
backend-go/
├── cmd/                     # Lambda function entry points
│   ├── act/                # Execute actions with LLM
│   ├── debug/              # Get CDP debug URLs
│   ├── ecs-controller/     # ECS container controller
│   ├── end/                # Terminate sessions
│   ├── retrieve/           # Get session status
│   ├── screencast/         # WebSocket screencast handler
│   └── sessions-start/     # Create sessions (Stagehand compatible)
├── internal/
│   ├── types/              # Shared Go types
│   └── utils/              # Utility functions
├── build/                  # Build outputs (gitignored)
├── Dockerfile              # ECS container image
├── go.mod                  # Go module dependencies
├── build.sh                # Build script
└── Makefile                # Build automation
```

## Prerequisites

- Go 1.24+
- Docker (for ECS controller)
- AWS CLI configured (for deployment)

## Building

### Quick Start

```bash
# Build all Lambda functions
make build

# Or use the build script directly
./build.sh
```

### Build Options

```bash
# Show all available targets
make help

# Build all functions
make build

# Build only Lambda functions (exclude ECS controller)
make lambda-only

# Build individual functions
make build-screencast
make build-sessions-start
make build-act

# Build for local development (current OS)
make dev-build

# Clean build artifacts
make clean
```

### Build Outputs

Each Lambda function is built into its own directory structure:

```
build/
├── act/
│   └── bootstrap           # Linux binary for AWS Lambda
├── act.zip                 # Deployment package
├── screencast/
│   └── bootstrap
├── screencast.zip
└── ...
```

## Lambda Functions

### Core Session Management

- **sessions-start**: Creates new browser sessions (Stagehand compatible)
- **retrieve**: Gets session status and metadata
- **debug**: Returns CDP debug URLs for Direct Mode
- **end**: Terminates sessions and cleans up resources

### Browser Operations

- **act**: Executes actions with LLM guidance (streaming)
- **screencast**: Handles WebSocket connections for real-time video streaming

### ECS Controller

- **ecs-controller**: Runs in ECS containers to manage Chrome browsers
- Handles frame capture for screencast streaming
- Manages Chrome lifecycle and CDP endpoints

## Environment Variables

All Lambda functions use these environment variables (set by CDK):

```bash
REDIS_ADDR                  # Redis cluster endpoint
ECS_CLUSTER                 # ECS cluster name
ECS_TASK_DEFINITION        # ECS task definition ARN
AWS_REGION                 # AWS region
CONNECT_URL_BASE           # Base URL for CDP connections
WEBSOCKET_API_ENDPOINT     # WebSocket API endpoint for screencast
```

## Dependencies

Key Go modules used:

```go
github.com/aws/aws-lambda-go                     # Lambda runtime
github.com/aws/aws-sdk-go-v2                     # AWS SDK v2
github.com/aws/aws-sdk-go-v2/service/ecs         # ECS service
github.com/aws/aws-sdk-go-v2/service/eventbridge # EventBridge
github.com/aws/aws-sdk-go-v2/service/apigatewaymanagementapi # WebSocket
github.com/redis/go-redis/v9                     # Redis client
github.com/google/uuid                           # UUID generation
```

## Development

### Local Development

```bash
# Build for local testing
make dev-build

# Run tests
make test

# Format code
make fmt

# Run linter (requires golangci-lint)
make lint

# Update dependencies
make deps
```

### Adding New Lambda Functions

1. Create new directory in `cmd/`:

```bash
mkdir cmd/my-new-function
```

2. Add `main.go` with Lambda handler:

```go
package main

import (
    "context"
    "github.com/aws/aws-lambda-go/lambda"
    "github.com/wallcrawler/backend-go/internal/utils"
)

func Handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
    // Your logic here
    return utils.CreateAPIResponse(200, utils.SuccessResponse("OK"))
}

func main() {
    lambda.Start(Handler)
}
```

3. Build automatically includes new functions:

```bash
make build
```

## Deployment

### Using CDK

The CDK stack automatically uses build outputs:

```bash
# Build functions
make build

# Deploy infrastructure (from aws-cdk package)
cd ../aws-cdk
npm run deploy
```

### Manual Deployment

```bash
# Build function
make build-screencast

# Upload to AWS Lambda
aws lambda update-function-code \
  --function-name wallcrawler-screencast \
  --zip-file fileb://build/screencast.zip
```

## Docker (ECS Controller)

The ECS controller runs in Docker containers:

```bash
# Build Docker image
make docker-build

# Or manually
docker build -t wallcrawler-ecs-controller .
```

## API Compatibility

All Lambda functions implement Stagehand-compatible APIs:

- **Headers**: `x-wc-api-key`, `x-wc-project-id`, `x-wc-session-id`
- **Streaming**: Server-Sent Events for real-time responses
- **WebSocket**: API Gateway WebSocket for screencast
- **Response Format**: `{success: boolean, data: ...}`

## Troubleshooting

### Build Issues

```bash
# Clear and rebuild
make clean
make build

# Check Go version
go version

# Update dependencies
make deps
```

### Import Errors

Ensure all imports use the full module path:

```go
"github.com/wallcrawler/backend-go/internal/utils"
"github.com/wallcrawler/backend-go/internal/types"
```

### Missing Dependencies

```bash
# Add new AWS SDK service
go get github.com/aws/aws-sdk-go-v2/service/[service-name]
go mod tidy
```

For more information, see the [Wallcrawler Design Doc](../../docs/wallcrawler-design-doc.md).
