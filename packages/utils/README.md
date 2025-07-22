# @wallcrawler/utils

Shared utilities for WallCrawler packages.

## Features

- **Authentication**: JWT/JWE validation and token management utilities
- **Redis**: Redis client initialization and management
- **AWS**: Fargate task management and AWS service utilities

## Installation

```bash
pnpm add @wallcrawler/utils
```

## Usage

### Authentication Utilities

```typescript
import { validateToken, createToken, JWETokenManager } from '@wallcrawler/utils/auth';

// Validate JWT token
const sessionId = await validateToken(token, secret);

// Create JWT token
const token = await createToken(payload, secret, '1h');

// Use JWE token manager
const jweManager = new JWETokenManager(jweSecret);
const encryptedToken = await jweManager.createToken(payload, '1h');
```

### Redis Utilities

```typescript
import { initRedisClient, getRedisClient } from '@wallcrawler/utils/redis';

// Initialize Redis client
const redis = await initRedisClient({
  endpoint: 'localhost',
  tlsEnabled: false,
  port: 6379,
});

// Get existing client
const redis = getRedisClient();
```

### AWS Utilities

```typescript
import { ensureFargateTask } from '@wallcrawler/utils/aws';

// Ensure Fargate task is running
const task = await ensureFargateTask('session-123', {
  ecsClusterName: 'my-cluster',
  browserTaskDefinitionArn: 'arn:aws:ecs:...',
  redisEndpoint: 'my-redis.cache.amazonaws.com',
  redisTlsEnabled: true,
  environment: 'production',
});
```

## Package Structure

```
src/
├── auth/           # Authentication utilities
│   ├── jwt-validator.ts
│   ├── jwe-utils.ts
│   └── index.ts
├── redis/          # Redis utilities
│   ├── redis-client.ts
│   └── index.ts
├── aws/            # AWS utilities
│   ├── fargate-manager.ts
│   └── index.ts
└── index.ts        # Main exports
```

## Development

```bash
# Build the package
pnpm build

# Watch for changes
pnpm dev

# Clean build artifacts
pnpm clean
```
