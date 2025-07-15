#!/bin/bash

# Build and push WallCrawler custom container to ECR
# Usage: ./build-and-push.sh [AWS_ACCOUNT_ID] [AWS_REGION] [IMAGE_TAG]

set -e

# Default values
AWS_ACCOUNT_ID=${1:-$(aws sts get-caller-identity --query Account --output text)}
AWS_REGION=${2:-us-east-1}
IMAGE_TAG=${3:-latest}

# ECR repository name
REPO_NAME="wallcrawler/browser-container"
ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPO_NAME}"

echo "🏗️  Building WallCrawler container..."
echo "📍 AWS Account: ${AWS_ACCOUNT_ID}"
echo "🌍 Region: ${AWS_REGION}"
echo "🏷️  Tag: ${IMAGE_TAG}"
echo "📦 ECR URI: ${ECR_URI}"

# Create ECR repository if it doesn't exist
echo "📋 Creating ECR repository if needed..."
aws ecr describe-repositories --repository-names ${REPO_NAME} --region ${AWS_REGION} 2>/dev/null || \
aws ecr create-repository --repository-name ${REPO_NAME} --region ${AWS_REGION}

# Get ECR login token
echo "🔐 Logging into ECR..."
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com

# Build the image
echo "🔨 Building Docker image..."
docker build -t ${REPO_NAME}:${IMAGE_TAG} .

# Tag for ECR
echo "🏷️  Tagging image for ECR..."
docker tag ${REPO_NAME}:${IMAGE_TAG} ${ECR_URI}:${IMAGE_TAG}

# Push to ECR
echo "📤 Pushing image to ECR..."
docker push ${ECR_URI}:${IMAGE_TAG}

echo "✅ Container built and pushed successfully!"
echo "🎯 Image URI: ${ECR_URI}:${IMAGE_TAG}"
echo ""
echo "💡 Update your CDK stack to use this image:"
echo "   image: cdk.aws_ecs.ContainerImage.fromRegistry('${ECR_URI}:${IMAGE_TAG}')"