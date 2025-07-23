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
REPO_NAME="wallcrawler/browser-container"
ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPO_NAME}"

echo ""
echo -e "${BLUE}📦 Step 1: Building Shared Utils & Container Application${NC}"
echo -e "${BLUE}======================================================${NC}"

# Check if directories exist
if [ ! -d "../utils" ]; then
    echo -e "${RED}❌ Utils package directory not found: ../utils${NC}"
    exit 1
fi

if [ ! -d "../browser-container" ]; then
    echo -e "${RED}❌ Browser container directory not found: ../browser-container${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Package directories found${NC}"

# Build shared utils first
echo -e "${YELLOW}🔧 Building shared utils package...${NC}"
cd ../utils
pnpm install
pnpm build
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to build utils package${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Utils package built successfully${NC}"

# Go back to CDK directory
cd ../aws-cdk

echo ""
echo -e "${BLUE}🐳 Step 2: Building & Pushing Docker Image${NC}"
echo -e "${BLUE}==========================================${NC}"

# Build and push container app using existing Go build script
echo -e "${YELLOW}🏗️  Building Go browser container...${NC}"
cd ../browser-container

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

# Use the existing build-and-push.sh script
echo -e "${YELLOW}🚀 Running Go container build and push script...${NC}"
./build-and-push.sh "${ECR_URI}" "${AWS_REGION}" "${ENVIRONMENT}"
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to build and push Go container${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Go container built and pushed successfully${NC}"
echo -e "${GREEN}🎯 Image URI: ${ECR_URI}:${ENVIRONMENT} (and other tags)${NC}"

# Go back to CDK directory
cd ../aws-cdk

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

# Build CDK (utils package is already built and linked via workspace)
echo -e "${YELLOW}🔨 Building CDK application...${NC}"
pnpm run build
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to build CDK application${NC}"
    exit 1
fi

echo -e "${GREEN}✅ CDK application built successfully${NC}"

echo ""
echo -e "${BLUE}☁️  Step 4: Deploying CDK Stacks${NC}"
echo -e "${BLUE}=================================${NC}"

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
echo -e "   🐳 Container Images: ${ECR_URI}:${ENVIRONMENT}, :latest, and timestamped tags"
echo -e "   ☁️  Environment: ${ENVIRONMENT}"
echo -e "   🌍 Region: ${AWS_REGION}"
echo -e "   🔢 Max Sessions per Container: 20"
echo ""
echo -e "${GREEN}🔗 Next Steps:${NC}"
echo -e "   1. Check CloudFormation outputs for endpoint URLs"
echo -e "   2. Create a session: POST to API Gateway /sessions endpoint"
echo -e "   3. Connect via CDP: Use the connectUrl from session response"
echo -e "   4. JWT token is included in the connectUrl for authentication"
echo ""
echo -e "${BLUE}💡 To get endpoint URLs:${NC}"
echo -e "   pnpm exec cdk output"