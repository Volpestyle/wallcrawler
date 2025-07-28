# Wallcrawler Deployment Guide

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Local Development Setup](#local-development-setup)
3. [AWS Infrastructure Deployment](#aws-infrastructure-deployment)
4. [Environment Configuration](#environment-configuration)
5. [Deployment Commands](#deployment-commands)
6. [Post-Deployment Verification](#post-deployment-verification)
7. [Troubleshooting](#troubleshooting)
8. [CI/CD Pipeline](#cicd-pipeline)

## Prerequisites

### Required Tools

```bash
# Node.js and package manager
node --version  # >= 18.x
pnpm --version  # >= 8.x

# AWS CLI and CDK
aws --version   # >= 2.x
cdk --version   # >= 2.x

# Go for backend builds
go version      # >= 1.21

# Docker for container builds
docker --version # >= 20.x
```

### AWS Account Setup

1. **AWS Account**: Active AWS account with appropriate permissions
2. **AWS CLI Configuration**:
   ```bash
   aws configure
   # Enter: Access Key ID, Secret Access Key, Region (us-east-1), Output (json)
   ```
3. **CDK Bootstrap**:
   ```bash
   cdk bootstrap aws://ACCOUNT-NUMBER/REGION
   ```

### Required AWS Permissions

Your AWS user/role needs permissions for:

- **CloudFormation**: Stack creation/updates
- **ECS**: Cluster and task management
- **VPC**: Network resource creation
- **ElastiCache**: Redis cluster management
- **API Gateway**: REST API creation
- **Lambda**: Function deployment
- **IAM**: Role and policy management
- **Secrets Manager**: JWT key management

## Local Development Setup

### 1. Clone and Install Dependencies

```bash
# Clone repository
git clone https://github.com/your-org/wallcrawler.git
cd wallcrawler

# Install dependencies
pnpm install

# Build all packages
pnpm build
```

### 2. Backend Go Build

```bash
# Build Go Lambda functions
cd packages/backend-go
./build.sh

# Verify builds
ls build/
# Should see: sessions-create, sessions-list, sessions-retrieve, etc.
```

### 3. Local Environment Variables

Create `.env` file in project root:

```bash
# Development settings
ENVIRONMENT=development
AWS_REGION=us-east-1
DEBUG=true

# Optional: Custom JWT key for development
WALLCRAWLER_JWT_SIGNING_KEY=your-dev-key-here
```

## AWS Infrastructure Deployment

### Development Deployment

```bash
# Navigate to CDK package
cd packages/aws-cdk

# Synthesize CloudFormation template (optional verification)
cdk synth --context environment=development

# Deploy infrastructure
cdk deploy --context environment=development

# Note the outputs:
# - APIGatewayURL: Your API endpoint
# - ApiKeyId: API key for authentication
# - RedisEndpoint: Redis cluster endpoint
# - ECSClusterName: ECS cluster name
```

### Staging Deployment

```bash
# Deploy to staging environment
cdk deploy --context environment=staging --context domainName=staging-api.wallcrawler.com

# Additional staging-specific configurations
cdk deploy \
  --context environment=staging \
  --context redisNodeType=cache.r6g.medium \
  --context lambdaMemory=2048
```

### Production Deployment

```bash
# Production deployment with custom domain
cdk deploy \
  --context environment=production \
  --context domainName=api.wallcrawler.com \
  --context enableJwtRotation=true \
  --context redisNodeType=cache.r6g.large \
  --context lambdaMemory=3008

# Verify production deployment
aws cloudformation describe-stacks --stack-name WallcrawlerStack
```

## Environment Configuration

### CDK Context Configuration

Each environment uses CDK context for configuration. Add to `cdk.json`:

```json
{
  "context": {
    "development": {
      "environment": "development",
      "ecsDesiredCount": 0,
      "redisNodeType": "cache.t3.micro",
      "lambdaMemory": 1024,
      "enableJwtRotation": false
    },
    "staging": {
      "environment": "staging",
      "domainName": "staging-api.wallcrawler.com",
      "ecsDesiredCount": 0,
      "redisNodeType": "cache.r6g.medium",
      "lambdaMemory": 2048,
      "enableJwtRotation": true
    },
    "production": {
      "environment": "production",
      "domainName": "api.wallcrawler.com",
      "ecsDesiredCount": 0,
      "redisNodeType": "cache.r6g.large",
      "lambdaMemory": 3008,
      "enableJwtRotation": true,
      "enableWafLogging": true
    }
  }
}
```

### Environment Variables

After deployment, these environment variables are automatically configured:

| Variable                             | Description            | Source          |
| ------------------------------------ | ---------------------- | --------------- |
| `REDIS_ADDR`                         | Redis cluster endpoint | ElastiCache     |
| `ECS_CLUSTER`                        | ECS cluster name       | ECS Service     |
| `ECS_TASK_DEFINITION`                | Task definition ARN    | ECS             |
| `WALLCRAWLER_JWT_SIGNING_SECRET_ARN` | JWT secret ARN         | Secrets Manager |
| `CDP_PROXY_PORT`                     | CDP proxy port (9223)  | Static          |
| `CONNECT_URL_BASE`                   | API base URL           | API Gateway     |

## Deployment Commands

### Quick Reference

```bash
# Full build and deploy
pnpm install && pnpm build && cd packages/backend-go && ./build.sh && cd ../aws-cdk && cdk deploy

# Development deploy
make deploy-dev

# Production deploy
make deploy-prod

# Update only Lambda functions
cdk deploy --hotswap

# Deploy with approval bypass
cdk deploy --require-approval never
```

### Makefile Commands

Create `Makefile` in project root:

```makefile
.PHONY: install build deploy-dev deploy-staging deploy-prod

install:
	pnpm install

build:
	pnpm build
	cd packages/backend-go && ./build.sh

deploy-dev: build
	cd packages/aws-cdk && cdk deploy --context environment=development

deploy-staging: build
	cd packages/aws-cdk && cdk deploy --context environment=staging

deploy-prod: build
	cd packages/aws-cdk && cdk deploy --context environment=production --context domainName=api.wallcrawler.com

destroy-dev:
	cd packages/aws-cdk && cdk destroy --context environment=development

synth:
	cd packages/aws-cdk && cdk synth --context environment=development

diff:
	cd packages/aws-cdk && cdk diff --context environment=development
```

## Post-Deployment Verification

### 1. API Gateway Health Check

```bash
# Get API Gateway URL from stack outputs
export API_URL=$(aws cloudformation describe-stacks --stack-name WallcrawlerStack --query 'Stacks[0].Outputs[?OutputKey==`APIGatewayURL`].OutputValue' --output text)

# Test API connectivity
curl $API_URL/health

# Expected response:
# {"status": "ok", "timestamp": "2024-01-01T00:00:00Z"}
```

### 2. API Key Retrieval

```bash
# Get API Key ID from stack outputs
export API_KEY_ID=$(aws cloudformation describe-stacks --stack-name WallcrawlerStack --query 'Stacks[0].Outputs[?OutputKey==`ApiKeyId`].OutputValue' --output text)

# Get actual API key value
export API_KEY=$(aws apigateway get-api-key --api-key $API_KEY_ID --include-value --query 'value' --output text)

echo "Your API Key: $API_KEY"
```

### 3. Test Session Creation

```bash
# Test basic session creation
curl -X POST $API_URL/v1/sessions \
  -H "x-wc-api-key: $API_KEY" \
  -H "x-wc-project-id: test-project" \
  -H "Content-Type: application/json" \
  -d '{"browserSettings": {"viewport": {"width": 1280, "height": 720}}}'

# Expected response:
# {"success": true, "data": {"id": "sess_...", "status": "provisioning"}}
```

### 4. Redis Connectivity Check

```bash
# Get Redis endpoint
export REDIS_ENDPOINT=$(aws cloudformation describe-stacks --stack-name WallcrawlerStack --query 'Stacks[0].Outputs[?OutputKey==`RedisEndpoint`].OutputValue' --output text)

# Check Redis (requires VPC access or bastion host)
redis-cli -h $REDIS_ENDPOINT ping
# Expected response: PONG
```

### 5. ECS Cluster Verification

```bash
# Get ECS cluster name
export ECS_CLUSTER=$(aws cloudformation describe-stacks --stack-name WallcrawlerStack --query 'Stacks[0].Outputs[?OutputKey==`ECSClusterName`].OutputValue' --output text)

# Check cluster status
aws ecs describe-clusters --clusters $ECS_CLUSTER

# List running tasks
aws ecs list-tasks --cluster $ECS_CLUSTER
```

## Troubleshooting

### Common Deployment Issues

#### 1. **CDK Bootstrap Not Performed**

```bash
Error: Need to perform AWS CDK bootstrap

# Solution:
cdk bootstrap aws://ACCOUNT-NUMBER/REGION
```

#### 2. **Insufficient AWS Permissions**

```bash
Error: User: arn:aws:iam::123456789012:user/username is not authorized

# Solution: Ensure user has required permissions or use admin role
aws sts assume-role --role-arn arn:aws:iam::ACCOUNT:role/AdminRole --role-session-name deploy-session
```

#### 3. **Docker Build Failures**

```bash
Error: docker build failed

# Solution: Ensure Docker is running and has sufficient resources
docker system prune -f
sudo systemctl start docker  # Linux
open -a Docker  # macOS
```

#### 4. **Go Build Failures**

```bash
Error: go build failed

# Solution: Check Go version and dependencies
go version  # Should be >= 1.21
go mod tidy
go mod download
```

#### 5. **Stack Deployment Timeout**

```bash
# Increase timeout for large stacks
cdk deploy --timeout 45

# Or deploy specific constructs
cdk deploy --exclusively WallcrawlerStack/VPC
cdk deploy --exclusively WallcrawlerStack/ECSCluster
```

### Debug Commands

```bash
# View CloudFormation events
aws cloudformation describe-stack-events --stack-name WallcrawlerStack

# Check Lambda function logs
aws logs describe-log-groups --log-group-name-prefix /aws/lambda/WallcrawlerStack

# View ECS service events
aws ecs describe-services --cluster $ECS_CLUSTER --services wallcrawler-browsers

# Check VPC configuration
aws ec2 describe-vpcs --filters "Name=tag:aws:cloudformation:stack-name,Values=WallcrawlerStack"
```

### Performance Optimization

```bash
# Enable CDK hotswap for faster Lambda updates
cdk deploy --hotswap

# Use CDK watch for development
cdk watch --context environment=development

# Parallel deployment (if multiple stacks)
cdk deploy --concurrency 4
```

## CI/CD Pipeline

### GitHub Actions Setup

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy Wallcrawler

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install

      - name: Run tests
        run: pnpm test

      - name: Build packages
        run: pnpm build

  deploy-staging:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'pnpm'

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1

      - name: Install and build
        run: |
          pnpm install
          pnpm build
          cd packages/backend-go && ./build.sh

      - name: Deploy to staging
        run: |
          cd packages/aws-cdk
          cdk deploy --context environment=staging --require-approval never

  deploy-production:
    needs: deploy-staging
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'pnpm'

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.PROD_AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.PROD_AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1

      - name: Install and build
        run: |
          pnpm install
          pnpm build
          cd packages/backend-go && ./build.sh

      - name: Deploy to production
        run: |
          cd packages/aws-cdk
          cdk deploy \
            --context environment=production \
            --context domainName=api.wallcrawler.com \
            --require-approval never
```

### Required GitHub Secrets

Add these secrets to your GitHub repository:

- `AWS_ACCESS_KEY_ID` - Staging AWS access key
- `AWS_SECRET_ACCESS_KEY` - Staging AWS secret key
- `PROD_AWS_ACCESS_KEY_ID` - Production AWS access key
- `PROD_AWS_SECRET_ACCESS_KEY` - Production AWS secret key

### Alternative: AWS CodePipeline

For AWS-native CI/CD, create `buildspec.yml`:

```yaml
version: 0.2

phases:
  install:
    runtime-versions:
      nodejs: 18
      golang: 1.21

  pre_build:
    commands:
      - npm install -g pnpm
      - pnpm install

  build:
    commands:
      - pnpm build
      - cd packages/backend-go && ./build.sh
      - cd ../aws-cdk
      - cdk synth --context environment=$ENVIRONMENT

  post_build:
    commands:
      - cdk deploy --context environment=$ENVIRONMENT --require-approval never

artifacts:
  files:
    - '**/*'
  name: wallcrawler-artifacts
```

---

## Quick Start Summary

1. **Prerequisites**: Install Node.js, pnpm, AWS CLI, CDK, Go, Docker
2. **Setup**: `pnpm install && pnpm build && cd packages/backend-go && ./build.sh`
3. **Deploy**: `cd packages/aws-cdk && cdk deploy --context environment=development`
4. **Verify**: Test API endpoint and create a session
5. **Production**: Use production context with custom domain

For detailed troubleshooting and advanced configuration, refer to the sections above.
