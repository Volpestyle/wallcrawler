# Wallcrawler AWS CDK Deployment Guide

## Quick Start

Deploy Wallcrawler with a single command from the root directory:

```bash
# Deploy to development (default)
pnpm run deploy

# Deploy to staging
pnpm run deploy:staging

# Deploy to production
pnpm run deploy:prod
```

That's it! The `pnpm run deploy` command handles everything:

- ✅ Pre-deployment validation
- ✅ Building Go backend (Lambda functions & ECS containers)
- ✅ Compiling CDK TypeScript
- ✅ Deploying to AWS

## Prerequisites

### 1. Install Required Tools

```bash
# AWS CLI
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip && sudo ./aws/install

# Configure AWS credentials
aws configure

# Node.js 18+ (via nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 18 && nvm use 18

# AWS CDK
npm install -g aws-cdk@2.120.0

# Go 1.24+
wget https://go.dev/dl/go1.24.0.linux-amd64.tar.gz
sudo tar -C /usr/local -xzf go1.24.0.linux-amd64.tar.gz
export PATH=$PATH:/usr/local/go/bin

# Docker - install from https://www.docker.com/products/docker-desktop
```

### 2. Bootstrap CDK (First Time Only)

```bash
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export AWS_REGION=$(aws configure get region || echo "us-east-1")
cdk bootstrap aws://$AWS_ACCOUNT_ID/$AWS_REGION
```

## Environment-Specific Deployments

### Development (Default)

```bash
pnpm run deploy
```

- No NAT Gateway (saves ~$45/month)
- No ElastiCache (saves ~$13/month)
- Minimal resources for cost optimization

### Staging

```bash
pnpm run deploy:staging
```

- Production-like with reduced scale
- Includes NAT Gateway and Redis
- Enhanced monitoring

### Production

```bash
pnpm run deploy:prod

# With custom domain
pnpm run deploy:prod -- --context domainName=api.wallcrawler.com
```

- Multi-AZ deployment
- WAF protection
- Full monitoring and logging
- Automatic JWT key rotation

## What Gets Deployed

1. **API Gateway** - REST API endpoints
2. **Lambda Functions** - Session management functions
3. **ECS Cluster** - Browser automation containers
4. **ElastiCache Redis** - Session state (staging/prod only)
5. **VPC & Networking** - Secure network isolation
6. **CloudWatch** - Logs and monitoring

## Getting Your API Endpoint

After deployment, get your API endpoint:

```bash
# Get all stack outputs
aws cloudformation describe-stacks \
  --stack-name WallcrawlerStack \
  --query 'Stacks[0].Outputs[?OutputKey==`APIGatewayURL`].OutputValue' \
  --output text
```

Example output:

- Development: `https://abc123.execute-api.us-east-1.amazonaws.com/dev`
- Staging: `https://abc123.execute-api.us-east-1.amazonaws.com/staging`
- Production: `https://abc123.execute-api.us-east-1.amazonaws.com/prod`

## Setting Up Your Application

Update your `.env.local` file:

```bash
# Development
WALLCRAWLER_BASE_URL=https://abc123.execute-api.us-east-1.amazonaws.com/dev
WALLCRAWLER_API_KEY=your-api-key-here
WALLCRAWLER_PROJECT_ID=your-project-id

# Production (with custom domain)
WALLCRAWLER_BASE_URL=https://api.wallcrawler.com/v1
```

## Troubleshooting

### Docker Not Running

```bash
# macOS
open -a Docker

# Linux
sudo systemctl start docker
```

### CDK Not Bootstrapped

```bash
cdk bootstrap aws://$AWS_ACCOUNT_ID/$AWS_REGION
```

### Build Failures

```bash
# Clean and rebuild
cd packages/backend-go
rm -rf build/
./build.sh
```

### Check Deployment Status

```bash
# View CloudFormation stack
aws cloudformation describe-stacks --stack-name WallcrawlerStack

# View recent events
aws cloudformation describe-stack-events \
  --stack-name WallcrawlerStack \
  --max-items 10
```

## Cost Optimization

### Development Costs (~$10/month)

- Lambda: ~$5/month
- API Gateway: ~$3.50/month
- ECS Fargate: Pay per use
- CloudWatch: ~$1/month

### Production Costs (~$150-200/month)

- NAT Gateway: ~$45/month
- ElastiCache: ~$50/month
- ECS Fargate: ~$30-50/month
- API Gateway: ~$10/month
- Other services: ~$15/month

### Cost Monitoring

```bash
# Set up billing alarm
aws cloudwatch put-metric-alarm \
  --alarm-name wallcrawler-billing-alarm \
  --alarm-description "Alert when AWS charges exceed $200" \
  --metric-name EstimatedCharges \
  --namespace AWS/Billing \
  --statistic Maximum \
  --period 86400 \
  --threshold 200 \
  --comparison-operator GreaterThanThreshold
```

## Updating Your Stack

```bash
# Update and redeploy
git pull
pnpm install
pnpm run deploy
```

## Destroying the Stack

```bash
# Remove all resources
cd packages/aws-cdk
cdk destroy WallcrawlerStack
```

⚠️ **Warning**: This will delete all resources including data!

## CI/CD Integration

For GitHub Actions, add to `.github/workflows/deploy.yml`:

```yaml
name: Deploy Wallcrawler

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install pnpm
        run: npm install -g pnpm

      - name: Install dependencies
        run: pnpm install

      - name: Configure AWS
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1

      - name: Deploy
        run: pnpm run deploy:${{ github.ref == 'refs/heads/main' && 'prod' || 'staging' }}
```

## Summary

1. **One command deployment**: `pnpm run deploy`
2. **Automatic builds**: Backend and CDK compilation handled
3. **Environment management**: dev/staging/prod configurations
4. **Cost optimized**: Development ~$10/month, Production ~$150/month
5. **Easy updates**: Pull, install, deploy

For help, check the logs:

```bash
# CDK logs
cd packages/aws-cdk
cat cdk.out/*.log

# CloudFormation events
aws cloudformation describe-stack-events --stack-name WallcrawlerStack
```
