# Wallcrawler CDK Deployment Guide

## Quick Start

```bash
# Development
npm run deploy:dev

# Staging
npm run deploy:staging

# Production
npm run deploy:prod
```

## What Happens During Deployment

1. **Pre-deployment Checks**
   - ✅ AWS credentials validation
   - ✅ Docker daemon running
   - ✅ Go functions built automatically
   - ✅ CDK bootstrap verification
   - ⚠️ Production requires explicit confirmation

2. **Deployment**
   - Builds TypeScript CDK code
   - Deploys infrastructure to AWS
   - Creates/updates all resources

3. **Post-deployment** (Automatic)
   - Generates `wallcrawler-config.txt` with all configuration values

## Environment Configurations

| Environment | API Endpoint | Features | Cost Optimizations |
|------------|--------------|----------|-------------------|
| **dev** | `https://xxx.execute-api.{region}.amazonaws.com/dev` | - No NAT Gateway<br>- DynamoDB on-demand<br>- Minimal Redis (t3.micro) | ~$10/month |
| **staging** | `https://xxx.execute-api.{region}.amazonaws.com/staging` | - Same as dev<br>- For integration testing | ~$10/month |
| **prod** | `https://xxx.execute-api.{region}.amazonaws.com/prod` | - NAT Gateway enabled<br>- Production security<br>- Optional custom domain | ~$60/month + usage |

## Generated Configuration File

### `wallcrawler-config.txt`
```bash
# API Access
WALLCRAWLER_API_URL=https://xxx.execute-api.us-east-1.amazonaws.com/dev
WALLCRAWLER_AWS_API_KEY=7j9km0WaXj...
WALLCRAWLER_PROJECT_ID=default

# JWT Authentication (for Direct Mode)
WALLCRAWLER_JWT_SIGNING_KEY=base64-encoded-key

# AWS Resources (internal use)
WALLCRAWLER_DYNAMODB_TABLE=wallcrawler-sessions
# ... other AWS resources
```

Copy the variables you need to your application's `.env` file.

## Prerequisites

- AWS CLI configured (`aws configure`)
- Docker Desktop running
- Node.js 18+ and npm
- Go 1.20+ (for Lambda functions)
- CDK bootstrapped: `cdk bootstrap aws://ACCOUNT-ID/REGION`

## First Time Setup

```bash
# Install dependencies
npm install

# Bootstrap CDK (one time per account/region)
npm run bootstrap

# Deploy to dev
npm run deploy:dev
```

## Destroy Stack

```bash
# Development/Staging
npm run destroy:dev
npm run destroy:staging

# Production (requires manual confirmation)
cdk destroy --all --context environment=prod
```

## Custom Domain (Optional)

For production with custom domain:
```bash
export CDK_CONTEXT_DOMAIN_NAME=api.wallcrawler.com
npm run deploy:prod
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Docker daemon not running" | Start Docker Desktop |
| "CDK not bootstrapped" | Run `npm run bootstrap` |
| "Go build failed" | Check Go installation: `go version` |
| "JWT secret not found" | Will be created automatically on first deploy |

## Cost Breakdown

- **Dev/Staging**: ~$10/month (no NAT Gateway, minimal resources)
- **Production**: ~$60/month base + usage costs
  - NAT Gateway: $45/month
  - Redis: $15/month
  - Lambda/ECS: Pay per use