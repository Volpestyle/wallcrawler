#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration - these should be set as environment variables or passed as arguments
REPOSITORY_URI=${1:-$ECR_REPOSITORY_URI}
REGION=${2:-$AWS_REGION}
ENVIRONMENT=${3:-development}

if [ -z "$REPOSITORY_URI" ]; then
    echo -e "${RED}Error: ECR Repository URI not provided${NC}"
    echo "Usage: $0 <repository-uri> [region] [environment]"
    echo "Or set ECR_REPOSITORY_URI environment variable"
    exit 1
fi

if [ -z "$REGION" ]; then
    echo -e "${YELLOW}Warning: AWS region not specified, using default region from AWS CLI${NC}"
    REGION=$(aws configure get region)
fi

echo -e "${BLUE}🚀 Building and pushing Go container to ECR...${NC}"
echo -e "${BLUE}Repository URI: ${REPOSITORY_URI}${NC}"
echo -e "${BLUE}Region: ${REGION}${NC}"
echo -e "${BLUE}Environment: ${ENVIRONMENT}${NC}"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}Error: Docker is not running. Please start Docker and try again.${NC}"
    exit 1
fi

# Check if AWS CLI is configured
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    echo -e "${RED}Error: AWS CLI is not configured or credentials are invalid.${NC}"
    exit 1
fi

# Login to ECR
echo -e "${YELLOW}🔐 Logging in to ECR...${NC}"
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $REPOSITORY_URI

# Build the Docker image
echo -e "${YELLOW}🔨 Building Docker image...${NC}"
docker build -t wallcrawler-go-browser .

# Generate timestamp for versioning
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

# Tag the image with multiple tags
echo -e "${YELLOW}🏷️  Tagging image...${NC}"
docker tag wallcrawler-go-browser:latest $REPOSITORY_URI:latest
docker tag wallcrawler-go-browser:latest $REPOSITORY_URI:$TIMESTAMP
docker tag wallcrawler-go-browser:latest $REPOSITORY_URI:$ENVIRONMENT
docker tag wallcrawler-go-browser:latest $REPOSITORY_URI:$ENVIRONMENT-$GIT_COMMIT

# Push all tags
echo -e "${YELLOW}📤 Pushing images to ECR...${NC}"
docker push $REPOSITORY_URI:latest
docker push $REPOSITORY_URI:$TIMESTAMP
docker push $REPOSITORY_URI:$ENVIRONMENT
docker push $REPOSITORY_URI:$ENVIRONMENT-$GIT_COMMIT

echo -e "${GREEN}✅ Successfully pushed Go container to ECR!${NC}"

# Print image details
echo -e "${BLUE}📋 Image Details:${NC}"
echo -e "  Latest: ${REPOSITORY_URI}:latest"
echo -e "  Timestamp: ${REPOSITORY_URI}:$TIMESTAMP"
echo -e "  Environment: ${REPOSITORY_URI}:$ENVIRONMENT"
echo -e "  Commit: ${REPOSITORY_URI}:$ENVIRONMENT-$GIT_COMMIT"

# Optional: Update ECS service if cluster and service names are provided
ECS_CLUSTER=${ECS_CLUSTER:-$4}
ECS_SERVICE=${ECS_SERVICE:-$5}

if [ -n "$ECS_CLUSTER" ] && [ -n "$ECS_SERVICE" ]; then
    echo -e "${YELLOW}🔄 Updating ECS service...${NC}"
    aws ecs update-service \
        --cluster "$ECS_CLUSTER" \
        --service "$ECS_SERVICE" \
        --force-new-deployment \
        --region $REGION > /dev/null

    echo -e "${GREEN}✅ ECS service update initiated!${NC}"
    echo -e "${BLUE}You can monitor the deployment in the AWS ECS console.${NC}"
else
    echo -e "${YELLOW}ℹ️  To update ECS service, provide cluster and service names:${NC}"
    echo -e "  export ECS_CLUSTER=your-cluster-name"
    echo -e "  export ECS_SERVICE=your-service-name"
    echo -e "  Or pass them as arguments 4 and 5"
fi

echo -e "${GREEN}🎉 Build and push completed successfully!${NC}" 