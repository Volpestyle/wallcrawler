# Lambda Functions - Monorepo Structure

### 🎯 Code Reuse

- All functions use the same `go-shared` package for cross-module utilities
- Shared Lambda-specific logic in `internal/` packages
- No duplicate Redis/AWS logic

### 📦 Smaller Binaries

- Each function only includes its specific `main.go`
- Shared code is properly deduplicated
- Typical binary size: 5-8MB instead of 15-19MB

### 🔧 Easier Maintenance

- Single `go.mod` to manage
- Consistent dependency versions
- Clear separation: `go-shared` vs `internal/`

### 🚀 Simpler Build Process

```bash
# Build all functions
make build-all

# Build specific function
make build-create-session

# Deploy all functions
make deploy-all
```

## Code Organization: `go-shared` vs `internal/`

### 🌐 **`go-shared` Package (Cross-Module)**

Use for code shared across **multiple Go modules** (Lambda + Container):

```go
// ✅ Perfect for go-shared:
├── types.go        // Session, JWT types used by Lambda + Container
├── redis.go        // Redis operations used by Lambda + Container
├── jwt.go          // JWT operations used by Lambda + Container
├── aws.go          // AWS utilities used by Lambda + Container
├── utils.go        // ID generation used by Lambda + Container
└── env.go          // Environment management used by Lambda + Container
```

**Example usage:**

```go
import shared "github.com/wallcrawler/go-shared"

// ✅ Use go-shared for truly cross-module utilities
redisClient := shared.NewRedisClient()
sessionID := shared.GenerateSessionID()
token, _ := shared.CreateJWTToken(sessionID, userID, settings, 60)
```

### 🔒 **`internal/` Packages (Lambda-Only)**

Use for code shared **only between Lambda functions** (not exported):

```go
// ✅ Perfect for internal/:
├── handlers/        // API Gateway response formatting
├── middleware/      // Lambda-specific auth, logging, CORS
└── validation/      // API Gateway request validation
```

**Example usage:**

```go
import (
    "github.com/wallcrawler/go-lambda/internal/handlers"
    "github.com/wallcrawler/go-lambda/internal/middleware"
    "github.com/wallcrawler/go-lambda/internal/validation"
)

// ✅ Use internal/ for Lambda-specific utilities
resp := handlers.LambdaSuccessResponse(data)
apiKey, err := middleware.ValidateAPIKey(event)
err := validation.ValidateSessionID(sessionID)
```

### 🚫 **Anti-Patterns to Avoid**

**Don't put in `go-shared`:**

- API Gateway specific request/response handling
- Lambda event validation
- WebSocket API specific logic

**Don't put in `internal/`:**

- Redis operations (browser container needs these too)
- JWT operations (browser container needs these too)
- AWS service clients (browser container needs these too)

## Current Structure

```
lambda/
├── go.mod                   # Single module for all functions
├── go.sum                   # Shared dependencies
├── cmd/                     # Function entry points
│   ├── create-session/main.go       # ✅ Uses both go-shared + internal/
│   ├── websocket-connect/main.go    # ✅ Uses both go-shared + internal/
│   └── websocket-message/main.go    # ✅ Uses both go-shared + internal/
├── internal/                # 🔒 Lambda-only shared code
│   ├── handlers/            # API Gateway response utilities
│   │   └── response.go      # LambdaResponse, LambdaErrorResponse
│   ├── middleware/          # Lambda-specific middleware
│   │   └── auth.go          # ValidateAPIKey, ValidateWebSocketToken
│   └── validation/          # Request validation
│       └── requests.go      # ValidateSessionID, ValidateBrowserSettings
├── dist/                    # Build outputs
└── Makefile                 # Build automation
```

## Implementation

### 1. Move Function Code

```bash
mkdir -p cmd/create-session cmd/websocket-connect cmd/websocket-message
mv create-session/main.go cmd/create-session/
mv websocket-connect/main.go cmd/websocket-connect/
mv websocket-message/main.go cmd/websocket-message/
```

### 2. Remove Individual Modules

```bash
rm create-session/go.mod create-session/go.sum
rm websocket-connect/go.mod websocket-connect/go.sum
rm websocket-message/go.mod
```

### 3. Build Process

```makefile
# In Makefile
build-create-session:
	cd cmd/create-session && GOOS=linux GOARCH=amd64 go build -o ../../dist/create-session/bootstrap .

build-websocket-connect:
	cd cmd/websocket-connect && GOOS=linux GOARCH=amd64 go build -o ../../dist/websocket-connect/bootstrap .

build-all: build-create-session build-websocket-connect build-websocket-message
```

### 4. CDK Integration

```typescript
// In your CDK construct
const createSessionFunction = new Function(this, 'CreateSession', {
  runtime: Runtime.PROVIDED_AL2023,
  handler: 'bootstrap',
  code: Code.fromAsset('dist/create-session'),
  // ... other config
});
```

## Migration Steps

1. **Test Current Setup**: Ensure all functions work
2. **Create New Structure**: Set up `cmd/` directories
3. **Move Code**: Relocate `main.go` files
4. **Update Imports**: Fix any import paths
5. **Update Build Scripts**: Modify build process
6. **Test**: Verify all functions still work
7. **Clean Up**: Remove old structure

## Alternative: Go Workspaces (For Complex Cases)

If functions truly need different dependency versions:

```bash
# In lambda/ directory
go work init
go work use ./create-session
go work use ./websocket-connect
go work use ./websocket-message
```

This allows separate modules while sharing common code, but adds complexity.

## Recommendation

**Use the single module approach** for your use case because:

- Your functions are closely related (session management)
- They share the same technology stack
- You already have a `go-shared` package
- Simpler is better for maintenance
