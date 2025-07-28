# Wallcrawler Backend (Go)

This package contains the AWS Lambda functions and infrastructure code for the Wallcrawler browser automation platform.

## Architecture Overview

Our backend follows a clean, organized structure with clear separation of concerns:

```
cmd/
├── sdk/                    # SDK-compatible endpoints (/v1/*)
│   ├── sessions-create/    # POST /v1/sessions - Create browser session
│   ├── sessions-list/      # GET /v1/sessions - List sessions
│   ├── sessions-retrieve/  # GET /v1/sessions/{id} - Get session details
│   └── sessions-update/    # POST /v1/sessions/{id} - Update/terminate session
│
├── api/                    # Stagehand API endpoints (/sessions/*)
│   └── sessions-start/     # POST /sessions/start - AI sessions (stubbed)
│
├── session-provisioner/   # EventBridge session lifecycle management
├── ecs-controller/        # ECS task management for browser containers
└── cdp-url/              # Direct Mode CDP URL generation
```

## Implementation Status

### ✅ Production Ready - SDK & Direct Mode

**SDK Endpoints (`/v1/*`)**:

- Full Browserbase-compatible API implemented
- Session CRUD operations working
- Proper authentication and validation
- EventBridge-driven async provisioning

**Direct Mode**:

- Secure CDP access via JWT-authenticated proxy
- Enterprise monitoring with rate limiting
- Public IP assignment for ECS tasks
- Native Chrome screencast support

### 🔄 Stubbed - API Mode

**API Endpoints (`/sessions/*`)**:

- Infrastructure and routing complete
- Returns clear "not implemented" messages
- Ready for future AI operation implementation

## Development

### Prerequisites

- Go 1.21+
- AWS CLI configured
- Docker (for local testing)

### Building

```bash
# Build all Lambda functions
make build

# Build specific function
make build-sessions-create

# Build for local testing
go build ./cmd/sdk/sessions-create
```

### Project Structure

#### Handler Categories

1. **SDK Handlers** (`cmd/sdk/`):
   - Handle Browserbase-compatible API endpoints
   - Focus on basic browser session management
   - Production-ready and fully tested

2. **API Handlers** (`cmd/api/`):
   - Handle Stagehand AI-powered endpoints
   - Currently stubbed for future implementation
   - Will include server-side LLM processing

3. **Infrastructure Handlers**:
   - `session-provisioner/`: EventBridge lifecycle management
   - `ecs-controller/`: Browser container management
   - `cdp-url/`: Direct Mode security features

#### Shared Components

- `internal/types/`: Common data structures and types
- `internal/utils/`: Shared utilities (Redis, AWS, validation)

### Adding New Endpoints

#### SDK Endpoint

1. Create handler in `cmd/sdk/new-endpoint/`
2. Follow existing patterns for validation and response format
3. Add to CDK stack under SDK section
4. Update API documentation

#### API Endpoint (Future)

1. Create handler in `cmd/api/new-endpoint/`
2. Include LLM processing and streaming support
3. Add to CDK stack under API section
4. Follow EventBridge patterns for async operations

### Configuration

Lambda functions are configured via environment variables:

```yaml
REDIS_ADDR: Redis cluster endpoint
ECS_CLUSTER: ECS cluster name for browser containers
ECS_TASK_DEFINITION: Browser task definition ARN
AWS_REGION: AWS deployment region
CONNECT_URL_BASE: Base URL for session connections
WALLCRAWLER_JWT_SIGNING_SECRET_ARN: JWT signing key from Secrets Manager
```

### Testing

```bash
# Run tests
make test

# Run specific test
go test ./cmd/sdk/sessions-create/...

# Integration tests (requires AWS resources)
make integration-test
```

### Deployment

The backend is deployed via AWS CDK (see `../aws-cdk/`):

```bash
cd ../aws-cdk
cdk deploy
```

This creates:

- Lambda functions for all handlers
- API Gateway with proper routing
- ECS cluster for browser containers
- Redis cluster for session state
- EventBridge for async processing

## API Reference

See [API Endpoints Reference](../../docs/api-endpoints-reference.md) for complete endpoint documentation.

## Development Guidelines

### Code Organization

1. **One Handler Per Endpoint**: Each Lambda function has a single, focused responsibility
2. **Consistent Structure**: All handlers follow the same patterns for validation, processing, and response
3. **Shared Logic**: Common functionality lives in `internal/` packages
4. **Clear Naming**: Handler names clearly indicate their purpose and API endpoint

### Response Format

All handlers return consistent response format:

```go
// Success
utils.CreateAPIResponse(200, utils.SuccessResponse(data))

// Error
utils.CreateAPIResponse(400, utils.ErrorResponse("Error message"))
```

### Error Handling

- Validate all inputs before processing
- Use appropriate HTTP status codes
- Return clear, actionable error messages
- Log errors with context for debugging

### Security

- All endpoints validate required headers (`x-wc-api-key`, `x-wc-project-id`)
- Session access is scoped to the authenticated project
- CDP URLs use JWT signing for secure access
- Rate limiting and monitoring built into infrastructure

## Monitoring & Observability

Each Lambda function includes:

- Structured logging with request context
- Error tracking and alerting
- Performance metrics via CloudWatch
- EventBridge event history for session lifecycle

## Contributing

1. Follow the established patterns for new handlers
2. Update documentation when adding endpoints
3. Include tests for new functionality
4. Use the shared utilities for common operations

## Support

- **Documentation**: See `docs/` for complete technical specifications
- **Architecture**: [Wallcrawler Design Document](../../docs/wallcrawler-design-doc.md)
- **Implementation**: [Implementation Overview](../../docs/implementation-overview.md)
