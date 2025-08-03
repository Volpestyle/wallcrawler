#!/bin/bash

# Pre-deployment checks for CDK

echo "🔍 Running pre-deployment checks..."

# Check AWS credentials
echo "✓ Checking AWS credentials..."
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    echo "❌ AWS credentials not configured or expired"
    exit 1
fi
echo "✓ AWS credentials valid"

# Check Docker
echo "✓ Checking Docker daemon..."
if ! docker ps > /dev/null 2>&1; then
    echo "❌ Docker daemon is not running"
    echo "💡 Starting Docker Desktop..."
    open -a Docker
    
    # Wait for Docker to start
    while ! docker ps > /dev/null 2>&1; do
        echo "⏳ Waiting for Docker to start..."
        sleep 2
    done
fi
echo "✓ Docker daemon is running"

# Check Node.js and CDK
echo "✓ Checking Node.js and CDK..."
if ! command -v node > /dev/null 2>&1; then
    echo "❌ Node.js is not installed"
    exit 1
fi

if ! command -v cdk > /dev/null 2>&1; then
    echo "❌ AWS CDK is not installed"
    echo "💡 Install with: npm install -g aws-cdk"
    exit 1
fi
echo "✓ Node.js and CDK are installed"

# Check Go installation
echo "✓ Checking Go installation..."
if ! command -v go > /dev/null 2>&1; then
    echo "❌ Go is not installed"
    echo "💡 Install Go from: https://golang.org/dl/"
    exit 1
fi
echo "✓ Go is installed ($(go version))"

# Build Go packages
echo "✓ Building Go Lambda functions..."
BACKEND_GO_DIR="../backend-go"
if [ ! -d "$BACKEND_GO_DIR" ]; then
    echo "❌ Backend Go directory not found at $BACKEND_GO_DIR"
    exit 1
fi

# Change to backend-go directory and run build
cd "$BACKEND_GO_DIR"
if [ ! -f "build.sh" ]; then
    echo "❌ build.sh not found in $BACKEND_GO_DIR"
    exit 1
fi

# Make build script executable if it isn't already
chmod +x build.sh

# Run the build script
echo "🔨 Running Go build script..."
if ./build.sh; then
    echo "✓ Go packages built successfully"
else
    echo "❌ Go build failed"
    exit 1
fi

# Return to original directory
cd - > /dev/null

# Check CDK bootstrap status
echo "✓ Checking CDK bootstrap..."
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=$(aws configure get region || echo "us-east-1")

if ! aws cloudformation describe-stacks \
    --stack-name CDKToolkit \
    --region $REGION > /dev/null 2>&1; then
    echo "⚠️  CDK is not bootstrapped in $REGION"
    echo "💡 Run: cdk bootstrap aws://$ACCOUNT_ID/$REGION"
fi

echo "✅ All pre-deployment checks passed!"
echo "🚀 Ready to deploy with: cdk deploy"