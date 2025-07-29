# Wallcrawler AWS CDK Deployment Guide

This guide provides step-by-step instructions for deploying the Wallcrawler infrastructure to AWS for the first time.

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [AWS Account Setup](#aws-account-setup)
3. [Environment Configuration](#environment-configuration)
4. [Building the Backend](#building-the-backend)
5. [CDK Deployment](#cdk-deployment)
6. [Post-Deployment Verification](#post-deployment-verification)
7. [Connecting the Client Application](#connecting-the-client-application)
8. [Troubleshooting](#troubleshooting)

## Prerequisites

Before deploying, ensure you have the following installed:

- **Node.js** (v18+ recommended)
- **AWS CLI** (v2.x)
- **Docker** (for building the ECS container)
- **Go** (1.21+ for building Lambda functions)
- **pnpm** or **npm** (package manager)

### Install AWS CDK CLI
```bash
npm install -g aws-cdk@2.120.0
```

### Verify installations
```bash
node --version
aws --version
docker --version
go version
cdk --version
```

## AWS Account Setup

### 1. Configure AWS Credentials

Set up your AWS credentials using one of these methods:

```bash
# Option 1: Using AWS CLI configure
aws configure
# Enter your AWS Access Key ID, Secret Access Key, region, and output format

# Option 2: Using environment variables
export AWS_ACCESS_KEY_ID=your_access_key_here
export AWS_SECRET_ACCESS_KEY=your_secret_key_here
export AWS_DEFAULT_REGION=us-east-1
```

### 2. Required AWS Permissions

Your AWS IAM user/role needs permissions to create:
- VPC and networking resources
- ECS clusters, task definitions, and services
- Lambda functions
- API Gateway
- ElastiCache (Redis)
- Secrets Manager
- EventBridge
- CloudWatch Logs
- IAM roles and policies
- WAF rules

For initial deployment, using an IAM user with `AdministratorAccess` is recommended. You can restrict permissions later.

### 3. Bootstrap CDK Environment

CDK requires a bootstrap stack in your AWS account:

```bash
cd packages/aws-cdk
cdk bootstrap aws://ACCOUNT_ID/us-east-1
```

Replace `ACCOUNT_ID` with your AWS account ID. You can find it with:
```bash
aws sts get-caller-identity --query Account --output text
```

## Environment Configuration

### 1. Build Configuration

The CDK stack uses several context variables. Create a `cdk.context.json` file in the `packages/aws-cdk` directory:

```json
{
  "environment": "production",
  "domainName": "api.wallcrawler.dev",
  "enableJwtRotation": "false"
}
```

Optional context variables:
- `environment`: Used for tagging resources (development/staging/production)
- `domainName`: Your API domain (defaults to api.wallcrawler.dev)
- `enableJwtRotation`: Enable automatic JWT key rotation (true/false)
- `jwtSigningKey`: Manual JWT key (for development only - production uses Secrets Manager)

### 2. Environment Variables

Set the following environment variables:

```bash
# Required for CDK
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_REGION=us-east-1

# Optional: Environment tag
export WALLCRAWLER_ENV=production
```

## Building the Backend

Before deploying, you need to build the Go Lambda functions:

### 1. Navigate to backend-go directory
```bash
cd packages/backend-go
```

### 2. Build Lambda functions
```bash
# Install dependencies
go mod download

# Build all Lambda functions
make build-lambda

# This creates optimized binaries in the build/ directory
```

### 3. Verify build output
```bash
ls -la build/
# Should show directories for each Lambda function:
# - sdk/sessions-create/
# - sdk/sessions-list/
# - sdk/sessions-retrieve/
# - sdk/sessions-debug/
# - sdk/sessions-update/
# - api/sessions-start/
# - session-cleanup/
# - ecs-task-processor/
```

## CDK Deployment

### 1. Navigate to CDK directory
```bash
cd packages/aws-cdk
```

### 2. Install dependencies
```bash
npm install
```

### 3. Build the CDK TypeScript
```bash
npm run build
```

### 4. Synthesize the CloudFormation template (optional)
```bash
npm run synth
```

This generates the CloudFormation template without deploying. Review `cdk.out/WallcrawlerStack.template.json` to see what will be created.

### 5. Deploy the stack
```bash
npm run deploy
```

Or with manual approval:
```bash
cdk deploy
```

The deployment will:
- Create a VPC with public and private subnets
- Set up an ECS cluster for browser containers
- Deploy Lambda functions for session management
- Create an API Gateway with authentication
- Set up Redis for session state
- Configure EventBridge for async processing
- Generate and store JWT signing keys in Secrets Manager

Deployment typically takes 15-20 minutes.

## Post-Deployment Verification

### 1. Check CloudFormation Outputs

After successful deployment, CDK will output important values:

```
Outputs:
WallcrawlerStack.APIGatewayURL = https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/prod/
WallcrawlerStack.ApiKeyId = xxxxxxxxxx
WallcrawlerStack.RedisEndpoint = wallcrawler-redis.xxxxxx.cache.amazonaws.com
WallcrawlerStack.ECSClusterName = wallcrawler-browsers
WallcrawlerStack.VPCId = vpc-xxxxxxxxxx
WallcrawlerStack.TaskDefinitionArn = arn:aws:ecs:us-east-1:xxxx:task-definition/wallcrawler-browser:1
WallcrawlerStack.JWTSigningSecretArn = arn:aws:secretsmanager:us-east-1:xxxx:secret:JWTSigningKey-xxxxx
```

Save these values - you'll need them for configuration.

### 2. Retrieve API Key

Get the actual API key value:

```bash
# Using the ApiKeyId from the output
aws apigateway get-api-key --api-key YOUR_API_KEY_ID --include-value --query value --output text
```

### 3. Verify ECS Cluster

```bash
aws ecs describe-clusters --clusters wallcrawler-browsers
```

### 4. Check Lambda Functions

```bash
aws lambda list-functions --query "Functions[?starts_with(FunctionName, 'WallcrawlerStack')].[FunctionName,Runtime,State]" --output table
```

### 5. Test API Endpoint

```bash
# Test the API with your key
curl -X GET https://YOUR_API_GATEWAY_URL/v1/sessions \
  -H "x-api-key: YOUR_API_KEY"
```

## Connecting the Client Application

### 1. Configure client-nextjs

Navigate to the client application:
```bash
cd packages/client-nextjs
```

### 2. Create .env.local file

```bash
cp .env.example .env.local
```

### 3. Update .env.local with your values

```env
# Use the API key retrieved above
NEXT_PUBLIC_WALLCRAWLER_API_KEY=your_actual_api_key_here

# Project ID can be any identifier for now
NEXT_PUBLIC_WALLCRAWLER_PROJECT_ID=default

# Use your deployed API Gateway URL
WALLCRAWLER_BASE_URL=https://YOUR_API_GATEWAY_URL/v1
```

### 4. Test the connection

```bash
# Install dependencies
pnpm install

# Run the development server
pnpm dev
```

Visit http://localhost:3000 and test creating a browser session.

## Troubleshooting

### Common Issues

#### 1. CDK Bootstrap Fails
- Ensure your AWS credentials have sufficient permissions
- Check you're in the correct region
- Try deleting the CDKToolkit stack and re-bootstrapping

#### 2. Docker Build Fails
- Ensure Docker daemon is running
- Check Docker has sufficient disk space
- For M1 Macs, ensure Docker is set to use linux/amd64 platform

#### 3. Lambda Functions Not Found
- Verify the backend-go build completed successfully
- Check the build/ directory contains all Lambda function binaries
- Ensure you're in the correct directory when running CDK deploy

#### 4. API Gateway Returns 403
- Verify you're using the correct API key
- Check the API key is associated with the usage plan
- Ensure you're passing the key in the `x-api-key` header

#### 5. ECS Tasks Won't Start
- Check CloudWatch Logs for the ECS task
- Verify the Docker image built successfully
- Ensure the task has sufficient CPU/memory
- Check security group rules allow required ports

### Viewing Logs

```bash
# Lambda logs
aws logs tail /aws/lambda/WallcrawlerStack-SDKSessionsCreateLambda --follow

# ECS logs
aws logs tail /ecs/wallcrawler-controller --follow

# API Gateway logs (if enabled)
aws logs tail API-Gateway-Execution-Logs_YOUR_API_ID/prod --follow
```

### Cost Optimization

To minimize costs during development:

1. **Stop ECS tasks when not in use**:
```bash
aws ecs update-service --cluster wallcrawler-browsers --service wallcrawler-browsers --desired-count 0
```

2. **Consider using smaller instance types**:
- Update `cacheNodeType` in the CDK stack for Redis
- Reduce Lambda memory allocation if not needed

3. **Set up billing alerts**:
```bash
aws cloudwatch put-metric-alarm --alarm-name wallcrawler-billing-alarm \
  --alarm-description "Alert when Wallcrawler costs exceed $50" \
  --metric-name EstimatedCharges --namespace AWS/Billing \
  --statistic Maximum --period 86400 --evaluation-periods 1 \
  --threshold 50 --comparison-operator GreaterThanThreshold
```

## Next Steps

1. **Set up monitoring**: Configure CloudWatch dashboards for your resources
2. **Configure alerts**: Set up SNS topics for operational alerts
3. **Implement backups**: Enable Redis snapshots for session persistence
4. **Security hardening**: Review and restrict IAM permissions
5. **Custom domain**: Set up Route 53 and ACM for a custom API domain

For production deployments, consider:
- Multi-region setup for high availability
- AWS Shield for DDoS protection
- Secrets rotation for JWT keys
- VPC endpoints for private communication
- Application Load Balancer for ECS services