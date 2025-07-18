# @wallcrawler/infra-aws

AWS infrastructure provider for WallCrawler browser automation, supporting both manual configuration and automatic configuration loading from AWS Systems Manager (SSM).

## Features

- **ECS Fargate** for scalable browser containers
- **ElastiCache Redis** for distributed session state
- **S3** for artifact storage
- **API Gateway WebSockets** for real-time communication
- **CDP WebSocket Proxy** for seamless Stagehand integration
- **SSM Parameter Store** for automatic configuration management
- **Auto-scaling** and cost optimization features
- **Unified Provider** supporting both task management and Stagehand browser automation

## Installation

```bash
npm install @wallcrawler/infra-aws
# or
pnpm add @wallcrawler/infra-aws
```

## Usage

### Option 1: Automatic Configuration (Recommended)

When you deploy infrastructure using the `@wallcrawler/deploy/aws-cdk` package, configuration values are automatically stored in AWS Systems Manager Parameter Store. The provider can load these automatically:

```typescript
import { AwsProvider } from '@wallcrawler/infra-aws';
import { Stagehand } from '@wallcrawler/stagehand';

// Simple configuration - everything else loaded from SSM
const provider = new AwsProvider({
  region: 'us-east-1',
  apiKey: process.env.WALLCRAWLER_API_KEY || 'your-api-key',
  loadFromSsm: true,
  projectName: 'wallcrawler', // optional, defaults to 'wallcrawler'
  environment: 'dev', // optional, defaults to 'dev'
});

// Initialize the provider (loads config from SSM)
await provider.initialize();

// Use with Stagehand
const stagehand = new Stagehand({ provider });
await stagehand.init();
```

### Option 2: Manual Configuration

You can still provide all configuration manually:

```typescript
import { AwsProvider } from '@wallcrawler/infra-aws';

const provider = new AwsProvider({
  region: 'us-east-1',
  apiKey: 'your-wallcrawler-api-key',
  ecsClusterName: 'wallcrawler-cluster-dev',
  ecsTaskDefinition: 'arn:aws:ecs:us-east-1:123456789012:task-definition/wallcrawler-browser-dev:1',
  subnetIds: ['subnet-12345', 'subnet-67890'],
  securityGroupIds: ['sg-12345'],
  redis: {
    endpoint: 'wallcrawler-redis-dev.abc123.clustercfg.use1.cache.amazonaws.com',
    port: 6379,
  },
  s3: {
    bucketName: 'wallcrawler-artifacts-dev-123456789012',
  },
});

await provider.initialize();
```

### Option 3: Hybrid Configuration

You can combine SSM loading with manual overrides:

```typescript
const provider = new AwsProvider({
  region: 'us-east-1',
  apiKey: process.env.WALLCRAWLER_API_KEY,
  loadFromSsm: true,
  // Override specific values
  redis: {
    endpoint: 'custom-redis-endpoint.com',
    port: 6380,
  },
});

await provider.initialize();
```

## SSM Parameters

When using `loadFromSsm: true`, the provider expects these parameters in SSM Parameter Store:

| Parameter Path                                             | Description                 | Example Value                                                                  |
| ---------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------ |
| `/{projectName}/{environment}/redis-endpoint`              | ElastiCache Redis endpoint  | `wallcrawler-redis-dev.abc123.clustercfg.use1.cache.amazonaws.com`             |
| `/{projectName}/{environment}/ecs-cluster-name`            | ECS cluster name            | `wallcrawler-cluster-dev`                                                      |
| `/{projectName}/{environment}/ecs-browser-task-definition` | Browser task definition ARN | `arn:aws:ecs:us-east-1:123456789012:task-definition/wallcrawler-browser-dev:1` |
| `/{projectName}/{environment}/vpc-private-subnet-ids`      | JSON array of subnet IDs    | `["subnet-12345", "subnet-67890"]`                                             |
| `/{projectName}/{environment}/container-security-group-id` | Security group ID           | `sg-12345`                                                                     |
| `/{projectName}/{environment}/s3-bucket-name`              | S3 bucket name              | `wallcrawler-artifacts-dev-123456789012`                                       |

These parameters are automatically created when you deploy using the CDK package.

## IAM Permissions

When using SSM-based configuration, ensure your application has the following IAM permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ssm:GetParametersByPath"],
      "Resource": ["arn:aws:ssm:*:*:parameter/wallcrawler/*"]
    }
  ]
}
```

## Configuration Options

### AwsProviderConfig

| Property            | Type       | Required | Description                                        |
| ------------------- | ---------- | -------- | -------------------------------------------------- |
| `region`            | `string`   | Yes      | AWS region                                         |
| `apiKey`            | `string`   | Yes      | WallCrawler API key for authentication             |
| `loadFromSsm`       | `boolean`  | No       | Load configuration from SSM Parameter Store        |
| `projectName`       | `string`   | No       | Project name for SSM path (default: 'wallcrawler') |
| `environment`       | `string`   | No       | Environment for SSM path (default: 'dev')          |
| `ecsClusterName`    | `string`   | No\*     | ECS cluster name                                   |
| `ecsTaskDefinition` | `string`   | No\*     | ECS task definition ARN                            |
| `subnetIds`         | `string[]` | No\*     | VPC subnet IDs                                     |
| `securityGroupIds`  | `string[]` | No\*     | Security group IDs                                 |
| `redis`             | `object`   | No\*     | Redis configuration                                |
| `s3`                | `object`   | No       | S3 configuration                                   |
| `websocket`         | `object`   | No       | WebSocket configuration                            |

\* Required unless `loadFromSsm: true`

## Integration with CDK

This package is designed to work seamlessly with the `@wallcrawler/deploy/aws-cdk` package:

1. Deploy infrastructure using CDK:

   ```bash
   cd packages/deploy/aws-cdk
   ./deploy.sh
   ```

2. Use the provider with SSM configuration:
   ```typescript
   const provider = new AwsProvider({
     region: process.env.AWS_REGION,
     apiKey: process.env.WALLCRAWLER_API_KEY,
     loadFromSsm: true,
   });
   ```

````

## Browser Automation

Once initialized, use with Stagehand for AI-powered automation:

```typescript
// Create Stagehand with the provider
const stagehand = new Stagehand({ provider });
await stagehand.init();

await stagehand.page.goto('https://example.com');
await stagehand.page.act('Click the login button');

const data = await stagehand.page.extract({
  instruction: 'Get the page title and main heading',
  schema: {
    title: 'string',
    heading: 'string',
  },
});

const screenshot = await stagehand.page.screenshot();

// Cleanup
await stagehand.close();
```

## Integration Modes

The AwsProvider supports two primary usage patterns:

### 1. Stagehand-First (Recommended)

The simplest approach - just use Stagehand, and the provider handles everything:

```typescript
import { AwsProvider } from '@wallcrawler/infra-aws';
import { Stagehand } from '@wallcrawler/stagehand';

const provider = new AwsProvider({
  region: 'us-east-1',
  apiKey: process.env.WALLCRAWLER_API_KEY,
  loadFromSsm: true,
});

await provider.initialize();

// Use Stagehand normally - provider handles task creation, CDP proxying, etc.
const stagehand = new Stagehand({ provider });
await stagehand.init();

const page = stagehand.page;
await page.goto('https://example.com');
await page.act('Click the login button');

// Provider automatically manages AWS tasks, Redis sessions, S3 artifacts
const screenshot = await page.screenshot();
await stagehand.close();
```

### 2. Direct Task Management

For advanced use cases requiring direct ECS task control:

```typescript
// Manually start an automation task
const taskInfo = await provider.startAutomationTask({
  sessionId: 'session-123',
  userId: 'user-456',
  environment: 'dev',
  region: 'us-east-1',
});

// Get task endpoint for communication
const endpoint = await provider.getTaskEndpoint(taskInfo.taskId);

// Create session and connect to browser
const session = await provider.createSession({
  userMetadata: { userId: 'user-456', taskId: taskInfo.taskId }
});

const { browser } = await provider.connectToBrowser(session);
// Now use browser for automation
```

## Error Handling

```typescript
try {
  const provider = new AwsProvider({
    region: 'us-east-1',
    apiKey: process.env.WALLCRAWLER_API_KEY,
    loadFromSsm: true,
  });

  await provider.initialize();
} catch (error) {
  if (error.message.includes('API key is required')) {
    console.error('WallCrawler API key is required. Set WALLCRAWLER_API_KEY env var.');
  } else if (error.message.includes('Redis endpoint is required')) {
    console.error('SSM configuration not found. Ensure CDK is deployed.');
  } else if (error.message.includes('must be initialized')) {
    console.error('Call provider.initialize() before using provider methods.');
  } else {
    console.error('Provider initialization failed:', error);
  }
}
```

## Examples

See the `examples/` directory for complete usage examples, including:

- **Stagehand Integration**: Primary usage pattern with AI-powered automation
- **SSM Configuration**: Automatic infrastructure setup via Parameter Store
- **Error Handling**: Comprehensive error scenarios and debugging
- **Advanced Provider Usage**: Direct task management for custom workflows
````
