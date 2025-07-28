# Wallcrawler AWS CDK

This package contains the AWS CDK infrastructure code for deploying Wallcrawler, a remote browser automation platform compatible with Stagehand.

## Architecture Overview

Wallcrawler provides a scalable, cloud-native solution for remote browser automation that integrates seamlessly with the Stagehand library. The infrastructure supports both **API Mode** and **Direct Mode** operations.

### Direct Mode Support

**Direct Mode** allows Stagehand clients to connect securely to remote Chrome browsers via an authenticated CDP proxy. This mode provides:

- **Privacy**: LLM inference happens on client-side
- **Enterprise Security**: JWT-authenticated CDP access with rate limiting
- **Control**: Full customization of prompts and models
- **Performance**: Direct CDP connection through secure proxy
- **Monitoring**: Comprehensive metrics and error tracking
- **Flexibility**: Works with any LLM provider

The infrastructure uses:

- **ECS tasks with public IPs** for authenticated CDP proxy access
- **Chrome on localhost** (127.0.0.1:9222) for security
- **Authenticated CDP proxy** (port 9223) with JWT validation
- **Enterprise features**: Rate limiting, circuit breaker, monitoring
- **Deploy**: `cdk deploy`

### Core Components

- **API Gateway**: REST API endpoints compatible with Stagehand
- **WebSocket API**: Real-time browser screencast streaming
- **Lambda Functions**: Serverless handlers for each operation type
- **ECS Fargate**: Containerized browser instances with Chrome + Go controller
- **Redis ElastiCache**: Session state management and coordination
- **EventBridge**: Asynchronous event processing
- **WAF**: API protection and rate limiting

### API Endpoints

The infrastructure deploys the following endpoints:

#### Session Management

- `POST /start-session` - Create new browser session (Wallcrawler native)
- `POST /sessions/start` - Start session (Stagehand compatible)
- `GET /sessions/{id}/retrieve` - Get session information
- `GET /sessions/{id}/debug` - Get debug/CDP URL for Direct Mode
- `POST /sessions/{id}/cdp-url` - Generate signed CDP URLs (Enterprise security)
- `POST /sessions/{id}/end` - Terminate session

#### Browser Operations (API Mode - Streaming)

- `POST /sessions/{id}/act` - Execute actions with LLM
- `POST /sessions/{id}/extract` - Extract structured data
- `POST /sessions/{id}/observe` - Observe page elements
- `POST /sessions/{id}/navigate` - Navigate to URLs
- `POST /sessions/{id}/agentExecute` - Multi-step agent workflows

#### Real-time Features

- `WebSocket /screencast` - Live browser streaming

## Prerequisites

- Node.js 18+ and pnpm
- AWS CLI configured with appropriate permissions
- AWS CDK CLI: `npm install -g aws-cdk`

## Quick Start

### 1. Install Dependencies

```bash
cd packages/aws-cdk
npm install
```

### 2. Deploy Infrastructure

🔐 **Automatic JWT Key Management**: The CDK automatically generates and stores a secure JWT signing key in AWS Secrets Manager. No manual key generation required!

#### Basic Deployment

```bash
cdk bootstrap  # First time only
cdk deploy
```

#### With Custom Domain

```bash
cdk deploy -c domainName=api.yourdomain.com
```

#### With Automatic Key Rotation (Recommended for Production)

```bash
# Enable 30-day automatic key rotation
cdk deploy -c enableJwtRotation=true
```

#### Development Override (Manual Key)

```bash
# For development/testing only - override with manual key
export DEV_JWT_KEY=$(openssl rand -base64 32)
cdk deploy -c jwtSigningKey="$DEV_JWT_KEY"
```

⚠️ **Security Features:**

- 🔐 **Automatically generated 64-character secure key**
- 🔒 **Stored in AWS Secrets Manager (encrypted at rest)**
- 🔄 **Optional 30-day automatic rotation**
- 🚫 **Never exposed in environment variables or logs**
- 🔑 **Proper IAM permissions for Lambda and ECS access**

### 4. Configure Stagehand Client

After deployment, use the stack outputs to configure your Stagehand client:

```typescript
// For Direct Mode (Enterprise Security)
const stagehand = new Stagehand({
  env: 'LOCAL', // Use local CDP connection
});

// 1. Create session
const sessionResponse = await fetch('/sessions/start', {
  method: 'POST',
  headers: { 'x-wc-api-key': process.env.WALLCRAWLER_API_KEY },
  body: JSON.stringify({ modelName: 'gpt-4' }),
});
const { sessionId } = await sessionResponse.json();

// 2. Get signed CDP URL
const cdpResponse = await fetch(`/sessions/${sessionId}/cdp-url`, {
  method: 'POST',
  headers: { 'x-wc-api-key': process.env.WALLCRAWLER_API_KEY },
  body: JSON.stringify({ expiresIn: 600 }),
});
const { cdpUrl } = await cdpResponse.json();

// 3. Connect to authenticated CDP proxy
const page = await stagehand.page(cdpUrl);
await page.goto('https://example.com');
await page.act('click button'); // Local LLM + Secure CDP
```

### 5. Stack Outputs

The deployment provides these important outputs:

- **APIGatewayURL**: Base URL for API endpoints
- **DirectModeSupported**: Direct Mode with enterprise security features
- **SecurityModel**: Chrome localhost-only + authenticated proxy configuration
- **ECSClusterName**: ECS cluster for browser containers
- **RedisEndpoint**: Session state storage
- **ApiKeyId**: API key for authentication
- **WebSocketAPIURL**: WebSocket endpoint for screencast streaming
- **JWTSigningSecretArn**: AWS Secrets Manager ARN containing the JWT signing key

## Security Configuration

### Automatic JWT Signing Key Management

🔐 **Wallcrawler automatically handles JWT signing key securitys!**

#### Default Behavior (Recommended)

```bash
# Deploys with auto-generated secure key in Secrets Manager
cdk deploy
```

**What happens automatically:**

- 📝 **Generates**: 64-character cryptographically secure key
- 🔒 **Stores**: Key encrypted in AWS Secrets Manager
- 🔑 **Configures**: Proper IAM permissions for services
- 🚫 **Protects**: Key never appears in logs or environment variables

#### Enhanced Security (Production)

```bash
# Enable automatic 30-day rotation
cdk deploy -c enableJwtRotation=true
```

**Additional security features:**

- 🔄 **Automatic rotation** every 30 days
- ⚡ **Zero-downtime** key rotation
- 📊 **CloudWatch monitoring** of rotation events
- 🔔 **SNS notifications** on rotation (optional)

### Environment-Specific Deployments

#### Multiple Environments

```bash
# Development (auto-generated key)
cdk deploy WallcrawlerStack-dev

# Staging (auto-generated key)
cdk deploy WallcrawlerStack-staging

# Production (auto-generated key + rotation)
cdk deploy WallcrawlerStack-prod \
  -c enableJwtRotation=true \
  -c domainName=api.wallcrawler.com
```

#### CI/CD Pipeline

```bash
# Simplified CI/CD - no manual key management needed!
cdk deploy --require-approval never \
  -c enableJwtRotation=true \
  -c environment=${ENVIRONMENT}
```

#### Manual Key Override (Development Only)

```bash
# Only for development/testing - not recommended for production
export DEV_JWT_KEY=$(openssl rand -base64 32)
cdk deploy WallcrawlerStack-dev \
  -c jwtSigningKey="$DEV_JWT_KEY"
```

## Configuration Options

### Context Variables

Configure deployment behavior using CDK context:

```bash
# Custom domain
cdk deploy -c domainName=api.yourdomain.com

# Environment name
cdk deploy -c environment=production
```

## Security Considerations

- ECS tasks get public IPs for direct CDP access
- Security group allows port 9222 from any IP
- Suitable for development and production environments
- WAF protection for API endpoints

## Monitoring and Troubleshooting

### CloudWatch Logs

- **Lambda Functions**: `/aws/lambda/[FunctionName]`
- **ECS Tasks**: `/wallcrawler/controller`

### Key Metrics

- **ECS Service**: Running task count
- **Lambda**: Invocation count and errors

### Common Issues

1. **CDP Connection Failed**: Check security groups allow port 9223 (CDP proxy)
2. **JWT Authentication Failed**: Verify JWT signing key is configured correctly
3. **Task IP Resolution**: Verify EC2 permissions for Lambda
4. **Session Creation**: Ensure ECS cluster and task definition are healthy
5. **Signed URL Expired**: JWT tokens expire after 10 minutes, generate new ones

## Required AWS Permissions

Your AWS credentials need the following permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudformation:*",
        "iam:*",
        "lambda:*",
        "apigateway:*",
        "ecs:*",
        "ec2:*",
        "elasticache:*",
        "events:*",
        "logs:*",
        "wafv2:*",
        "route53:*"
      ],
      "Resource": "*"
    }
  ]
}
```

## Deployment

### 1. Install Dependencies

```bash
cd packages/aws-cdk
pnpm install
```

### 2. Bootstrap CDK (First time only)

```bash
pnpm run bootstrap
```

### 3. Deploy Infrastructure

```bash
# Deploy with default settings
pnpm run deploy

# Deploy with custom environment
WALLCRAWLER_ENV=production pnpm run deploy

# Deploy to specific AWS profile
AWS_PROFILE=production pnpm run deploy
```

### 4. Get Deployment Outputs

After successful deployment, you'll see outputs including:

```
✅  WallcrawlerStack

✨  Deployment time: XXXs

Outputs:
WallcrawlerStack.APIGatewayURL = https://xxxxxxxxxx.execute-api.us-west-2.amazonaws.com/prod/
WallcrawlerStack.WebSocketAPIURL = wss://xxxxxxxxxx.execute-api.us-west-2.amazonaws.com/prod/
WallcrawlerStack.ApiKeyId = xxxxxxxxxxxx
WallcrawlerStack.JWTSigningSecretArn = arn:aws:secretsmanager:us-west-2:123456789012:secret:WallcrawlerStack-JWTSigningKey-xxxxxx
WallcrawlerStack.RedisEndpoint = wallcrawler-redis.xxxxxx.cache.amazonaws.com
WallcrawlerStack.ECSClusterName = wallcrawler-browsers
WallcrawlerStack.VPCId = vpc-xxxxxxxxx
```

## Configuration

### Environment Variables

Set these environment variables before deployment:

```bash
export WALLCRAWLER_ENV=development          # Environment name
export CDK_DEFAULT_REGION=us-west-2         # AWS region
export CDK_DEFAULT_ACCOUNT=123456789012     # AWS account ID
```

### Context Variables

You can customize deployment using CDK context:

```bash
# Deploy with custom domain
cdk deploy -c domainName=api.wallcrawler.dev -c environment=production

# Deploy with specific VPC settings
cdk deploy -c maxAzs=3 -c natGateways=2
```

## API Authentication

After deployment, you'll need to configure API authentication:

### 1. Get API Key Value

```bash
aws apigateway get-api-key --api-key <ApiKeyId> --include-value
```

### 2. Configure Stagehand

```typescript
import { Stagehand } from '@wallcrawler/stagehand';

const stagehand = new Stagehand({
  env: 'WALLCRAWLER',
  apiKey: 'your-wallcrawler-api-key',
  projectId: 'your-project-id',
  baseURL: 'https://your-api-gateway-url/prod',
});
```

## Quick Reference

### Essential Commands

```bash
# 1. Deploy with automatic secure key generation
cdk deploy

# 2. Deploy production with key rotation
cdk deploy -c enableJwtRotation=true -c domainName=api.yourdomain.com

# 3. Get API key value
aws apigateway get-api-key --api-key <ApiKeyId> --include-value

# 4. Create session and get signed CDP URL
curl -X POST https://your-api-gateway-url/sessions/start \
  -H "x-wc-api-key: your-api-key" \
  -d '{"modelName":"gpt-4"}'

curl -X POST https://your-api-gateway-url/sessions/<session-id>/cdp-url \
  -H "x-wc-api-key: your-api-key" \
  -d '{"expiresIn":600}'

# 5. View JWT secret in AWS console
aws secretsmanager get-secret-value --secret-id <JWTSigningSecretArn-from-stack-output>
```

### Key Ports

- **9222**: Chrome CDP (localhost only)
- **9223**: Authenticated CDP proxy (public)
- **6379**: Redis (VPC internal)

### Security Model

```
Client → Port 9223 (CDP Proxy) → JWT Validation → Port 9222 (Chrome)
```

## Monitoring and Logging

### CloudWatch Logs

Each Lambda function creates its own log group:

- `/aws/lambda/WallcrawlerStack-StartSessionLambda-xxx`
- `/aws/lambda/WallcrawlerStack-ActLambda-xxx`
- `/aws/lambda/WallcrawlerStack-ExtractLambda-xxx`
- etc.

### CloudWatch Metrics

Monitor key metrics:

- API Gateway request count and latency
- Lambda function invocations and errors
- ECS task CPU and memory utilization
- Redis connection count and cache hit ratio

### WAF Monitoring

Track API protection metrics:

- Blocked requests by rule
- Rate limit violations
- Common attack patterns detected

## Scaling Considerations

### ECS Scaling

The current setup uses Fargate tasks launched on-demand. For high-volume scenarios, consider:

1. **ECS Service with Auto Scaling**: Replace on-demand tasks with a service
2. **Spot Instances**: Use Spot pricing for cost optimization
3. **Multi-AZ Deployment**: Distribute across availability zones

### Lambda Scaling

Lambda functions auto-scale, but consider:

1. **Reserved Concurrency**: Set limits to prevent runaway costs
2. **Provisioned Concurrency**: Reduce cold starts for critical functions
3. **Memory Optimization**: Tune memory allocation for performance

### Redis Scaling

Current setup uses a single-node cluster. For production:

1. **Redis Cluster Mode**: Enable cluster mode for horizontal scaling
2. **Multi-AZ**: Enable replication across zones
3. **Backup Strategy**: Configure automated backups

## Cost Optimization

### Development Environment

```bash
# Use smaller instance types
cdk deploy -c environment=development
```

This automatically configures:

- `cache.t3.micro` for Redis
- Minimal ECS task resources
- Single NAT Gateway

### Production Environment

```bash
cdk deploy -c environment=production
```

This configures:

- `cache.r6g.large` for Redis with replication
- Higher ECS task resources
- Multiple NAT Gateways for redundancy

## Troubleshooting

### Common Issues

1. **Bootstrap Required**: If you get CloudFormation template errors, run `pnpm run bootstrap`

2. **Permission Denied**: Ensure your AWS credentials have sufficient permissions

3. **Resource Limits**: Check AWS service quotas for your region

4. **Docker Build Fails**: Ensure Docker is running for ECS container builds

### Debug Commands

```bash
# Synthesize CloudFormation template
pnpm run synth

# Compare deployed vs. local changes
pnpm run diff

# View stack events
aws cloudformation describe-stack-events --stack-name WallcrawlerStack
```

## Development

### Building

```bash
pnpm run build
```

### Testing

```bash
pnpm run test
```

### Watching for Changes

```bash
pnpm run watch
```

## Cleanup

To remove all infrastructure:

```bash
pnpm run destroy
```

**Warning**: This will delete all resources including databases and stored data.

## Security Considerations

1. **API Keys**: Store API keys securely, never commit to version control
2. **VPC Security**: All resources are deployed in private subnets
3. **WAF Protection**: Automatic protection against common web attacks
4. **IAM Least Privilege**: Lambda functions have minimal required permissions
5. **Encryption**: All data is encrypted in transit and at rest

## Support

For infrastructure issues, check:

1. CloudFormation stack events in AWS Console
2. CloudWatch logs for Lambda function errors
3. VPC Flow Logs for network connectivity issues
4. ECS service logs for container startup problems

## Related Packages

- `@wallcrawler/backend-go` - Go Lambda handlers and ECS controller
- `@wallcrawler/sdk-node` - Node.js SDK for API integration
- `@wallcrawler/stagehand` - Enhanced Stagehand with Wallcrawler support
