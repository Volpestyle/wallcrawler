#!/bin/bash

# Pre-deployment checks for CDK

echo "🔍 Running pre-deployment checks..."

# Get environment context (default to dev)
ENVIRONMENT="${CDK_CONTEXT_ENVIRONMENT:-dev}"
echo "📦 Deployment environment: $ENVIRONMENT"

# Check AWS credentials
echo "✓ Checking AWS credentials..."
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    echo "❌ AWS credentials not configured or expired"
    exit 1
fi
echo "✓ AWS credentials valid"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=$(aws configure get region || echo "us-east-1")
echo "  Account: $ACCOUNT_ID"
echo "  Region: $REGION"

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
if ! aws cloudformation describe-stacks \
    --stack-name CDKToolkit \
    --region $REGION > /dev/null 2>&1; then
    echo "⚠️  CDK is not bootstrapped in $REGION"
    echo "💡 Run: cdk bootstrap aws://$ACCOUNT_ID/$REGION"
fi

# Environment-specific checks
echo "✓ Checking environment-specific requirements..."

# Check if JWT secret exists (for all environments)
echo "  Checking JWT signing secret..."
JWT_SECRET_NAME="WallcrawlerStack-JWTSigningKey"
if aws secretsmanager describe-secret --secret-id "$JWT_SECRET_NAME" --region $REGION > /dev/null 2>&1; then
    echo "  ✓ JWT signing secret exists"
else
    echo "  ℹ️  JWT signing secret will be created automatically during deployment"
fi

# Production-specific checks
if [ "$ENVIRONMENT" == "prod" ]; then
    echo ""
    echo "🔒 Production deployment checks:"
    
    # Check if stack already exists
    STACK_NAME="WallcrawlerStack"
    if aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region $REGION > /dev/null 2>&1; then
        echo "  ⚠️  Production stack already exists - this will update it"
        echo "  📊 Current stack status:"
        aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region $REGION \
            --query 'Stacks[0].StackStatus' --output text
    else
        echo "  ℹ️  This will be a new production deployment"
    fi
    
    # Confirmation for production
    echo ""
    echo "  ⚠️  You are about to deploy to PRODUCTION!"
    echo "  Account: $ACCOUNT_ID"
    echo "  Region: $REGION"
    read -p "  Are you sure you want to continue? (yes/no): " CONFIRM
    if [ "$CONFIRM" != "yes" ]; then
        echo "  ❌ Production deployment cancelled"
        exit 1
    fi
fi

# Check for required context values
echo "✓ Checking CDK context values..."
if [ "$ENVIRONMENT" == "prod" ] && [ -z "$CDK_CONTEXT_DOMAIN_NAME" ]; then
    echo "  ⚠️  No domain name set for production"
    echo "  💡 Consider setting: export CDK_CONTEXT_DOMAIN_NAME=api.wallcrawler.com"
fi

echo ""
echo "✅ All pre-deployment checks passed!"
echo "🚀 Ready to deploy with: cdk deploy --context environment=$ENVIRONMENT"