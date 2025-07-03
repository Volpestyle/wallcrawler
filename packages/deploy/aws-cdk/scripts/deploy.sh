#!/bin/bash

# WallCrawler Infrastructure Deployment Script
# Usage: ./scripts/deploy.sh [environment] [region]

set -e

# Default values
ENVIRONMENT=${1:-dev}
REGION=${2:-us-east-1}
PROJECT_NAME="wallcrawler"

echo "🚀 Deploying WallCrawler infrastructure..."
echo "Environment: $ENVIRONMENT"
echo "Region: $REGION"
echo "Project: $PROJECT_NAME"
echo ""

# Set AWS region
export AWS_DEFAULT_REGION=$REGION
export CDK_DEFAULT_REGION=$REGION

# Environment-specific configurations
case $ENVIRONMENT in
  "dev")
    VPC_CIDR="10.0.0.0/16"
    MAX_AZS=2
    REDIS_NODE_TYPE="cache.t3.micro"
    REDIS_REPLICAS=0
    ECS_CPU=512
    ECS_MEMORY=1024
    ;;
  "staging")
    VPC_CIDR="10.1.0.0/16"
    MAX_AZS=2
    REDIS_NODE_TYPE="cache.t3.small"
    REDIS_REPLICAS=1
    ECS_CPU=1024
    ECS_MEMORY=2048
    ;;
  "prod")
    VPC_CIDR="10.2.0.0/16"
    MAX_AZS=3
    REDIS_NODE_TYPE="cache.r7g.large"
    REDIS_REPLICAS=2
    ECS_CPU=1024
    ECS_MEMORY=2048
    ;;
  *)
    echo "❌ Invalid environment: $ENVIRONMENT"
    echo "Valid options: dev, staging, prod"
    exit 1
    ;;
esac

echo "📋 Configuration:"
echo "  VPC CIDR: $VPC_CIDR"
echo "  Max AZs: $MAX_AZS"
echo "  Redis Node: $REDIS_NODE_TYPE"
echo "  Redis Replicas: $REDIS_REPLICAS"
echo "  ECS CPU: $ECS_CPU"
echo "  ECS Memory: $ECS_MEMORY"
echo ""

# Check if AWS CLI is configured
if ! aws sts get-caller-identity >/dev/null 2>&1; then
    echo "❌ AWS CLI not configured or credentials invalid"
    echo "Please run: aws configure"
    exit 1
fi

# Check if CDK is bootstrapped
echo "🔍 Checking CDK bootstrap status..."
if ! aws cloudformation describe-stacks --stack-name CDKToolkit >/dev/null 2>&1; then
    echo "⚠️  CDK not bootstrapped in this region"
    echo "🔧 Bootstrapping CDK..."
    pnpm run bootstrap
fi

# Build the project
echo "🔨 Building CDK project..."
pnpm run build

# Generate CloudFormation template
echo "📄 Generating CloudFormation template..."
pnpm run synth -- \
  -c environment=$ENVIRONMENT \
  -c projectName=$PROJECT_NAME \
  -c vpcCidr=$VPC_CIDR \
  -c maxAzs=$MAX_AZS \
  -c redisNodeType=$REDIS_NODE_TYPE \
  -c redisReplicas=$REDIS_REPLICAS \
  -c ecsTaskCpu=$ECS_CPU \
  -c ecsTaskMemory=$ECS_MEMORY

# Show differences (if stack exists)
echo "🔍 Checking for differences..."
if aws cloudformation describe-stacks --stack-name "$PROJECT_NAME-infra-$ENVIRONMENT" >/dev/null 2>&1; then
    echo "📊 Stack differences:"
    pnpm run diff -- \
      -c environment=$ENVIRONMENT \
      -c projectName=$PROJECT_NAME \
      -c vpcCidr=$VPC_CIDR \
      -c maxAzs=$MAX_AZS \
      -c redisNodeType=$REDIS_NODE_TYPE \
      -c redisReplicas=$REDIS_REPLICAS \
      -c ecsTaskCpu=$ECS_CPU \
      -c ecsTaskMemory=$ECS_MEMORY || true
    echo ""
fi

# Confirmation for production
if [ "$ENVIRONMENT" == "prod" ]; then
    echo "⚠️  You are about to deploy to PRODUCTION!"
    echo "This will create/update production infrastructure."
    read -p "Are you sure you want to continue? (yes/no): " -r
    if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
        echo "❌ Deployment cancelled"
        exit 1
    fi
fi

# Deploy the stack
echo "🚀 Deploying stack..."
pnpm run deploy -- \
  -c environment=$ENVIRONMENT \
  -c projectName=$PROJECT_NAME \
  -c vpcCidr=$VPC_CIDR \
  -c maxAzs=$MAX_AZS \
  -c redisNodeType=$REDIS_NODE_TYPE \
  -c redisReplicas=$REDIS_REPLICAS \
  -c ecsTaskCpu=$ECS_CPU \
  -c ecsTaskMemory=$ECS_MEMORY \
  --require-approval never

echo ""
echo "✅ Deployment completed successfully!"
echo ""
echo "📋 Stack Information:"
echo "  Stack Name: $PROJECT_NAME-infra-$ENVIRONMENT"
echo "  Region: $REGION"
echo "  Environment: $ENVIRONMENT"
echo ""
echo "🔗 Useful commands:"
echo "  View stack: aws cloudformation describe-stacks --stack-name $PROJECT_NAME-infra-$ENVIRONMENT"
echo "  View outputs: aws cloudformation describe-stacks --stack-name $PROJECT_NAME-infra-$ENVIRONMENT --query 'Stacks[0].Outputs'"
echo "  Delete stack: pnpm run destroy -- -c environment=$ENVIRONMENT -c projectName=$PROJECT_NAME"
echo ""
echo "🎉 Happy coding!"