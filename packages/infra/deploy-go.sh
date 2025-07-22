#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
ENVIRONMENT=${1:-development}
REGION=${2:-us-east-1}
PROJECT_NAME="wallcrawler"

echo -e "${BLUE}🚀 WallCrawler Go Migration Deployment${NC}"
echo -e "${BLUE}Environment: ${ENVIRONMENT}${NC}"
echo -e "${BLUE}Region: ${REGION}${NC}"
echo -e "${BLUE}Project: ${PROJECT_NAME}${NC}"
echo ""

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to print step header
print_step() {
    echo -e "${BLUE}📋 Step $1: $2${NC}"
    echo ""
}

# Function to print success
print_success() {
    echo -e "${GREEN}✅ $1${NC}"
    echo ""
}

# Function to print error and exit
print_error() {
    echo -e "${RED}❌ Error: $1${NC}"
    exit 1
}

# Check prerequisites
print_step "1" "Checking Prerequisites"

if ! command_exists go; then
    print_error "Go is not installed. Please install Go 1.21 or later."
fi

if ! command_exists docker; then
    print_error "Docker is not installed. Please install Docker."
fi

if ! command_exists aws; then
    print_error "AWS CLI is not installed. Please install AWS CLI."
fi

if ! command_exists node; then
    print_error "Node.js is not installed. Please install Node.js for CDK."
fi

if ! command_exists cdk; then
    print_error "AWS CDK is not installed. Please install AWS CDK with 'npm install -g aws-cdk'."
fi

# Check Docker is running
if ! docker info > /dev/null 2>&1; then
    print_error "Docker is not running. Please start Docker."
fi

# Check AWS credentials
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    print_error "AWS CLI is not configured or credentials are invalid."
fi

print_success "All prerequisites checked"

# Build Go Lambda functions
print_step "2" "Building Go Lambda Functions"

# Build create-session function
echo -e "${YELLOW}Building create-session Lambda...${NC}"
cd go-lambda/create-session
go mod tidy
go build -ldflags="-s -w" -o bootstrap main.go
print_success "create-session Lambda built"

# Build websocket-connect function
echo -e "${YELLOW}Building websocket-connect Lambda...${NC}"
cd ../websocket-connect
go mod tidy
go build -ldflags="-s -w" -o bootstrap main.go
print_success "websocket-connect Lambda built"

# Build websocket-message function
echo -e "${YELLOW}Building websocket-message Lambda...${NC}"
cd ../websocket-message
go mod tidy
go build -ldflags="-s -w" -o bootstrap main.go
print_success "websocket-message Lambda built"

cd ../..

print_success "All Go Lambda functions built"

# Build Go shared utilities
print_step "3" "Building Go Shared Utilities"
cd ../go-shared
go mod tidy
go build .
print_success "Go shared utilities built"

cd ../infra

# Deploy CDK Stack
print_step "4" "Deploying CDK Infrastructure"

echo -e "${YELLOW}Installing CDK dependencies...${NC}"
cd aws-cdk
npm install

echo -e "${YELLOW}Synthesizing CDK stack...${NC}"
cdk synth --context environment=$ENVIRONMENT

echo -e "${YELLOW}Deploying CDK stack...${NC}"
cdk deploy --all \
    --context environment=$ENVIRONMENT \
    --require-approval never \
    --outputs-file outputs.json

print_success "CDK infrastructure deployed"

# Extract outputs from CDK deployment
if [ -f "outputs.json" ]; then
    ECR_REPOSITORY_URI=$(jq -r ".\"wallcrawler-app-services-${ENVIRONMENT}\".GoEcrRepositoryUri" outputs.json 2>/dev/null || echo "")
    ECS_CLUSTER_NAME=$(jq -r ".\"wallcrawler-app-services-${ENVIRONMENT}\".GoClusterName" outputs.json 2>/dev/null || echo "")
    ECS_SERVICE_NAME=$(jq -r ".\"wallcrawler-app-services-${ENVIRONMENT}\".GoServiceName" outputs.json 2>/dev/null || echo "")
    
    if [ "$ECR_REPOSITORY_URI" != "" ] && [ "$ECR_REPOSITORY_URI" != "null" ]; then
        echo -e "${GREEN}Retrieved ECR Repository URI: ${ECR_REPOSITORY_URI}${NC}"
    else
        print_error "Could not retrieve ECR Repository URI from CDK outputs"
    fi
else
    print_error "CDK outputs file not found. Cannot proceed with container deployment."
fi

cd ..

# Build and push Go container
print_step "5" "Building and Pushing Go Container"

if [ -n "$ECR_REPOSITORY_URI" ]; then
    cd go-container
    
    # Use the build-and-push script
    ./build-and-push.sh "$ECR_REPOSITORY_URI" "$REGION" "$ENVIRONMENT" "$ECS_CLUSTER_NAME" "$ECS_SERVICE_NAME"
    
    cd ..
    print_success "Go container built and pushed"
else
    print_error "ECR Repository URI not available. Skipping container deployment."
fi

# Verify deployment
print_step "6" "Verifying Deployment"

echo -e "${YELLOW}Checking ECS service status...${NC}"
if [ -n "$ECS_CLUSTER_NAME" ] && [ -n "$ECS_SERVICE_NAME" ]; then
    aws ecs describe-services \
        --cluster "$ECS_CLUSTER_NAME" \
        --services "$ECS_SERVICE_NAME" \
        --region "$REGION" \
        --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount}' \
        --output table
else
    echo -e "${YELLOW}ECS service information not available${NC}"
fi

echo -e "${YELLOW}Checking Lambda functions...${NC}"
aws lambda list-functions \
    --region "$REGION" \
    --query "Functions[?contains(FunctionName, 'wallcrawler') && contains(FunctionName, 'go')].{Name:FunctionName,Runtime:Runtime,Status:State}" \
    --output table

print_success "Deployment verification completed"

# Summary
print_step "7" "Deployment Summary"

echo -e "${GREEN}🎉 WallCrawler Go Migration Deployment Completed Successfully!${NC}"
echo ""
echo -e "${BLUE}📊 Deployment Summary:${NC}"
echo -e "  Environment: ${ENVIRONMENT}"
echo -e "  Region: ${REGION}"
echo -e "  ECR Repository: ${ECR_REPOSITORY_URI:-'Not available'}"
echo -e "  ECS Cluster: ${ECS_CLUSTER_NAME:-'Not available'}"
echo -e "  ECS Service: ${ECS_SERVICE_NAME:-'Not available'}"
echo ""
echo -e "${BLUE}🔗 Next Steps:${NC}"
echo -e "  1. Monitor ECS service deployment in AWS Console"
echo -e "  2. Test Lambda functions via API Gateway"
echo -e "  3. Verify screencast functionality"
echo -e "  4. Check CloudWatch logs for any issues"
echo ""
echo -e "${BLUE}📚 Useful Commands:${NC}"
echo -e "  View ECS logs: aws logs tail /ecs/${PROJECT_NAME}/go-browser-${ENVIRONMENT} --follow"
echo -e "  Test create-session: aws lambda invoke --function-name ${PROJECT_NAME}-create-session-go-${ENVIRONMENT}"
echo -e "  Check service status: aws ecs describe-services --cluster ${ECS_CLUSTER_NAME} --services ${ECS_SERVICE_NAME}"
echo ""

if [ -f "aws-cdk/outputs.json" ]; then
    echo -e "${BLUE}💾 CDK outputs saved to: aws-cdk/outputs.json${NC}"
fi

echo -e "${GREEN}✨ Happy coding with Go! ✨${NC}" 