#!/bin/bash

# Script to generate .env.local file with Wallcrawler deployment outputs
# Usage: ./scripts/generate-env-local.sh [stack-name] [output-file]

set -e

# Default values
STACK_NAME="WallcrawlerStack"
OUTPUT_FILE=".env.local"
REGION="us-east-1"

# Override with command line arguments if provided
if [ "$1" ]; then
    STACK_NAME="$1"
fi

if [ "$2" ]; then
    OUTPUT_FILE="$2"
fi

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "Error: AWS CLI is not installed. Please install it first."
    exit 1
fi

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo "Error: jq is not installed. Please install it first."
    echo "On macOS: brew install jq"
    echo "On Ubuntu/Debian: sudo apt-get install jq"
    exit 1
fi

echo "Fetching outputs from stack: $STACK_NAME..."

# Get stack outputs
OUTPUTS=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" --query 'Stacks[0].Outputs' 2>/dev/null || echo "[]")

if [ "$OUTPUTS" = "[]" ]; then
    echo "Error: Stack '$STACK_NAME' not found or has no outputs."
    echo "Make sure you've run 'pnpm deploy' first."
    exit 1
fi

# Function to get output value by key
get_output() {
    echo "$OUTPUTS" | jq -r ".[] | select(.OutputKey==\"$1\") | .OutputValue // \"\""
}

# Get all output values
API_GATEWAY_URL=$(get_output "APIGatewayURL")
API_KEY_ID=$(get_output "ApiKeyId")
DYNAMODB_TABLE=$(get_output "DynamoDBTableName")
REDIS_ENDPOINT=$(get_output "RedisEndpoint")
ECS_CLUSTER=$(get_output "ECSClusterName")
VPC_ID=$(get_output "VPCId")
TASK_DEFINITION_ARN=$(get_output "TaskDefinitionArn")
JWT_SECRET_ARN=$(get_output "JWTSigningSecretArn")

# Get the actual API key value
echo "Retrieving API key value..."
API_KEY_VALUE=$(aws apigateway get-api-key --api-key "$API_KEY_ID" --include-value --query value --output text --region "$REGION" 2>/dev/null || echo "")

if [ -z "$API_KEY_VALUE" ]; then
    echo "Warning: Could not retrieve API key value. You may need to get it manually."
    API_KEY_VALUE="<YOUR_API_KEY_HERE>"
fi

# Get the JWT signing key from Secrets Manager
echo "Retrieving JWT signing key..."
if [ -n "$JWT_SECRET_ARN" ]; then
    JWT_SECRET_JSON=$(aws secretsmanager get-secret-value --secret-id "$JWT_SECRET_ARN" --region "$REGION" --query SecretString --output text 2>/dev/null || echo "{}")
    JWT_SIGNING_KEY=$(echo "$JWT_SECRET_JSON" | jq -r '.signingKey // ""')
else
    JWT_SIGNING_KEY=""
fi

if [ -z "$JWT_SIGNING_KEY" ]; then
    echo "Warning: Could not retrieve JWT signing key. Direct Mode authentication will not work."
    JWT_SIGNING_KEY="<YOUR_JWT_SIGNING_KEY_HERE>"
fi

# Generate .env.local file
echo "Generating $OUTPUT_FILE..."

cat > "$OUTPUT_FILE" << EOF
# Wallcrawler Environment Variables
# Generated on $(date)
# Stack: $STACK_NAME

# API Gateway
WALLCRAWLER_API_URL=$API_GATEWAY_URL
WALLCRAWLER_API_KEY=$API_KEY_VALUE

# AWS Resources
WALLCRAWLER_DYNAMODB_TABLE=$DYNAMODB_TABLE
WALLCRAWLER_REDIS_ENDPOINT=$REDIS_ENDPOINT
WALLCRAWLER_ECS_CLUSTER=$ECS_CLUSTER
WALLCRAWLER_VPC_ID=$VPC_ID
WALLCRAWLER_TASK_DEFINITION_ARN=$TASK_DEFINITION_ARN

# JWT Authentication (for Direct Mode)
WALLCRAWLER_JWT_SECRET_ARN=$JWT_SECRET_ARN
WALLCRAWLER_JWT_SIGNING_KEY=$JWT_SIGNING_KEY

# SDK Configuration
BROWSERBASE_API_KEY=$API_KEY_VALUE
BROWSERBASE_PROJECT_ID=default

# Optional: Override API URL for SDK (defaults to official Browserbase API)
# BROWSERBASE_API_URL=$API_GATEWAY_URL

# AWS Configuration (if not using default profile)
# AWS_REGION=$REGION
# AWS_PROFILE=your-profile-name
EOF

echo ""
echo "✅ Successfully generated $OUTPUT_FILE"
echo ""
echo "Summary:"
echo "  API URL: $API_GATEWAY_URL"
echo "  API Key: ${API_KEY_VALUE:0:10}..."
echo "  DynamoDB Table: $DYNAMODB_TABLE"
echo "  Redis Endpoint: $REDIS_ENDPOINT"
echo "  ECS Cluster: $ECS_CLUSTER"
echo ""
echo "To use Wallcrawler SDK:"
echo "  1. Copy $OUTPUT_FILE to your application directory"
echo "  2. Load it in your application (e.g., with dotenv)"
echo "  3. Initialize the SDK with BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID"
echo ""
echo "Note: The SDK will use the official Browserbase API by default."
echo "      To use your Wallcrawler deployment, set:"
echo "      BROWSERBASE_API_URL=$API_GATEWAY_URL"
