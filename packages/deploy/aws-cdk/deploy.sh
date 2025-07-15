#!/bin/bash

# WallCrawler Complete Deployment Script
# Builds container-app, pushes to ECR, then deploys CDK stack

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
AWS_REGION=${AWS_REGION:-us-east-1}
IMAGE_TAG=${IMAGE_TAG:-latest}
ENVIRONMENT=${ENVIRONMENT:-dev}

echo -e "${BLUE}🚀 WallCrawler Complete Deployment${NC}"
echo -e "${BLUE}======================================${NC}"
echo "📍 Region: ${AWS_REGION}"
echo "🏷️  Image Tag: ${IMAGE_TAG}"
echo "🌍 Environment: ${ENVIRONMENT}"
echo ""

# Get AWS Account ID
echo -e "${YELLOW}🔍 Getting AWS Account ID...${NC}"
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to get AWS Account ID. Make sure AWS CLI is configured.${NC}"
    exit 1
fi
echo -e "${GREEN}✅ AWS Account: ${AWS_ACCOUNT_ID}${NC}"

# ECR repository details
REPO_NAME="wallcrawler-browser-container-${ENVIRONMENT}"
ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPO_NAME}"

echo ""
echo -e "${BLUE}📦 Step 1: Building Container & Proxy Applications${NC}"
echo -e "${BLUE}=================================================${NC}"

# Check if directories exist
if [ ! -d "src/container-app" ]; then
    echo -e "${RED}❌ Container app directory not found: src/container-app${NC}"
    exit 1
fi

if [ ! -d "src/proxy-service" ]; then
    echo -e "${RED}❌ Proxy service directory not found: src/proxy-service${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Source directories found${NC}"

echo ""
echo -e "${BLUE}🐳 Step 2: Building & Pushing Docker Images${NC}"
echo -e "${BLUE}============================================${NC}"

# Build and push container app
echo -e "${YELLOW}🏗️  Building multi-session container...${NC}"
cd src/container-app

# Create ECR repository if it doesn't exist
echo -e "${YELLOW}📋 Creating ECR repository if needed...${NC}"
aws ecr describe-repositories --repository-names ${REPO_NAME} --region ${AWS_REGION} 2>/dev/null || {
    echo -e "${YELLOW}📋 Repository doesn't exist, creating...${NC}"
    aws ecr create-repository --repository-name ${REPO_NAME} --region ${AWS_REGION}
    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ Failed to create ECR repository${NC}"
        exit 1
    fi
}

# Get ECR login token
echo -e "${YELLOW}🔐 Logging into ECR...${NC}"
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to login to ECR${NC}"
    exit 1
fi

# Build Docker image
echo -e "${YELLOW}🔨 Building Docker image...${NC}"
docker build -t ${REPO_NAME}:${IMAGE_TAG} .
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to build Docker image${NC}"
    exit 1
fi

# Tag for ECR
echo -e "${YELLOW}🏷️  Tagging image for ECR...${NC}"
docker tag ${REPO_NAME}:${IMAGE_TAG} ${ECR_URI}:${IMAGE_TAG}

# Push to ECR
echo -e "${YELLOW}📤 Pushing image to ECR...${NC}"
docker push ${ECR_URI}:${IMAGE_TAG}
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to push image to ECR${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Docker image pushed successfully${NC}"
echo -e "${GREEN}🎯 Image URI: ${ECR_URI}:${IMAGE_TAG}${NC}"

# Build and push proxy service
echo ""
echo -e "${YELLOW}🏗️  Building proxy service...${NC}"
cd ../../src/proxy-service

# Create proxy ECR repository if needed
PROXY_REPO_NAME="wallcrawler-proxy-${ENVIRONMENT}"
PROXY_ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${PROXY_REPO_NAME}"

echo -e "${YELLOW}📋 Creating proxy ECR repository if needed...${NC}"
aws ecr describe-repositories --repository-names ${PROXY_REPO_NAME} --region ${AWS_REGION} 2>/dev/null || {
    echo -e "${YELLOW}📋 Repository doesn't exist, creating...${NC}"
    aws ecr create-repository --repository-name ${PROXY_REPO_NAME} --region ${AWS_REGION}
    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ Failed to create proxy ECR repository${NC}"
        exit 1
    fi
}

# Build proxy Docker image
echo -e "${YELLOW}🔨 Building proxy Docker image...${NC}"
docker build -t ${PROXY_REPO_NAME}:${IMAGE_TAG} .
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to build proxy Docker image${NC}"
    exit 1
fi

# Tag and push proxy
echo -e "${YELLOW}🏷️  Tagging proxy image for ECR...${NC}"
docker tag ${PROXY_REPO_NAME}:${IMAGE_TAG} ${PROXY_ECR_URI}:${IMAGE_TAG}

echo -e "${YELLOW}📤 Pushing proxy image to ECR...${NC}"
docker push ${PROXY_ECR_URI}:${IMAGE_TAG}
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to push proxy image to ECR${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Proxy image pushed successfully${NC}"
echo -e "${GREEN}🎯 Proxy URI: ${PROXY_ECR_URI}:${IMAGE_TAG}${NC}"

# Go back to CDK directory
cd ../..

echo ""
echo -e "${BLUE}🏗️  Step 3: Building CDK Application${NC}"
echo -e "${BLUE}=====================================${NC}"

# Install CDK dependencies
echo -e "${YELLOW}📥 Installing CDK dependencies...${NC}"
pnpm install
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to install CDK dependencies${NC}"
    exit 1
fi

# Build CDK
echo -e "${YELLOW}🔨 Building CDK application...${NC}"
pnpm run build
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to build CDK application${NC}"
    exit 1
fi

echo -e "${GREEN}✅ CDK application built successfully${NC}"

echo ""
echo -e "${BLUE}☁️  Step 4: Deploying CDK Stack${NC}"
echo -e "${BLUE}================================${NC}"

# Bootstrap CDK if needed
echo -e "${YELLOW}🥾 Bootstrapping CDK (if needed)...${NC}"
pnpm exec cdk bootstrap aws://${AWS_ACCOUNT_ID}/${AWS_REGION}

# Deploy CDK stacks
echo -e "${YELLOW}🚀 Deploying CDK stacks...${NC}"
echo -e "${YELLOW}📍 First deploying Core Infrastructure stack...${NC}"
pnpm exec cdk deploy wallcrawler-core-${ENVIRONMENT} \
    --context environment=${ENVIRONMENT} \
    --context projectName=wallcrawler \
    --require-approval never \
    --progress events

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to deploy Core Infrastructure stack${NC}"
    exit 1
fi

echo -e "${YELLOW}📍 Now deploying Application Services stack...${NC}"
pnpm exec cdk deploy wallcrawler-app-${ENVIRONMENT} \
    --context environment=${ENVIRONMENT} \
    --context projectName=wallcrawler \
    --require-approval never \
    --progress events
    
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to deploy CDK stack${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}🎉 Deployment Complete!${NC}"
echo -e "${GREEN}======================${NC}"
echo ""
echo -e "${GREEN}📋 Deployment Summary:${NC}"
echo -e "   🐳 Container Image: ${ECR_URI}:${IMAGE_TAG}"
echo -e "   🔄 Proxy Image: ${PROXY_ECR_URI}:${IMAGE_TAG}"
echo -e "   ☁️  Environment: ${ENVIRONMENT}"
echo -e "   🌍 Region: ${AWS_REGION}"
echo -e "   🔢 Max Sessions per Container: 20"
echo ""
echo -e "${GREEN}🔗 Next Steps:${NC}"
echo -e "   1. Check CloudFormation outputs for endpoint URLs"
echo -e "   2. Create a session: POST to API Gateway /sessions endpoint"
echo -e "   3. Connect WebSocket: wss://[ALB_DNS]/sessions/{sessionId}/ws"
echo -e "   4. Use Authorization header: Bearer {jwt_token}"
echo ""
echo -e "${BLUE}💡 To get endpoint URLs:${NC}"
echo -e "   pnpm exec cdk output"