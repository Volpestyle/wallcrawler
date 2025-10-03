#!/bin/bash

# Script to generate .env.local file with Wallcrawler deployment outputs
# Usage: ./scripts/generate-env-local.sh [stack-name] [output-file]

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default values
ENVIRONMENT="${CDK_CONTEXT_ENVIRONMENT:-dev}"
# Capitalize first letter of environment for stack name
STAGE_NAME="$(echo ${ENVIRONMENT:0:1} | tr '[:lower:]' '[:upper:]')${ENVIRONMENT:1}"
STACK_NAME="WallcrawlerStack${STAGE_NAME}"
OUTPUT_FILE="wallcrawler-config.txt"
REGION="us-east-1"

# Override with command line arguments if provided
if [ "$1" ]; then
    STACK_NAME="$1"
fi

if [ "$2" ]; then
    OUTPUT_FILE="$2"
fi

# Get region from AWS config if available
CONFIGURED_REGION=$(aws configure get region 2>/dev/null || echo "")
if [ -n "$CONFIGURED_REGION" ]; then
    REGION="$CONFIGURED_REGION"
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

echo -e "${YELLOW}Fetching outputs from stack: $STACK_NAME in region $REGION...${NC}"

# Get stack outputs
OUTPUTS=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" --query 'Stacks[0].Outputs' 2>/dev/null || echo "[]")

if [ "$OUTPUTS" = "[]" ]; then
    echo "Error: Stack '$STACK_NAME' not found or has no outputs."
    echo "Make sure you've run 'npm run deploy' first."
    exit 1
fi

# Get stack status
STACK_STATUS=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "UNKNOWN")
echo -e "Stack Status: ${GREEN}$STACK_STATUS${NC}"

# Function to get output value by key
get_output() {
    echo "$OUTPUTS" | jq -r ".[] | select(.OutputKey==\"$1\") | .OutputValue // \"\""
}

# Get all output values
API_GATEWAY_URL=$(get_output "APIGatewayURL")
INTERNAL_API_URL=$(get_output "InternalAPIGatewayURL")
API_KEY_ID=$(get_output "ApiKeyId")
DYNAMODB_TABLE=$(get_output "DynamoDBTableName")
ECS_CLUSTER=$(get_output "ECSClusterName")
VPC_ID=$(get_output "VPCId")
TASK_DEFINITION_ARN=$(get_output "TaskDefinitionArn")
JWT_SECRET_ARN=$(get_output "JWTSigningSecretArn")
SESSION_ARTIFACTS_BUCKET=$(get_output "SessionArtifactsBucketName")

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

# Generate configuration file
echo "Generating $OUTPUT_FILE..."

cat > "$OUTPUT_FILE" << EOF
# Wallcrawler Configuration
# Generated on $(date)
# Stack: $STACK_NAME
# Region: $REGION

# API Access - Choose ONE based on your authentication method:

# Option 1: Public API (Recommended) - Only requires Wallcrawler API key
WALLCRAWLER_API_URL=$API_GATEWAY_URL
WALLCRAWLER_API_KEY=<YOUR_WALLCRAWLER_API_KEY>

# Option 2: Internal API - Requires AWS API key
# WALLCRAWLER_API_URL=$INTERNAL_API_URL
# WALLCRAWLER_AWS_API_KEY=$API_KEY_VALUE

# Common settings
WALLCRAWLER_PROJECT_ID=default

# AWS Resources (for internal use)
WALLCRAWLER_DYNAMODB_TABLE=$DYNAMODB_TABLE
WALLCRAWLER_ECS_CLUSTER=$ECS_CLUSTER
WALLCRAWLER_VPC_ID=$VPC_ID
WALLCRAWLER_TASK_DEFINITION_ARN=$TASK_DEFINITION_ARN
WALLCRAWLER_INTERNAL_API_URL=$INTERNAL_API_URL
WALLCRAWLER_PUBLIC_API_URL=$API_GATEWAY_URL
WALLCRAWLER_SESSION_ARTIFACTS_BUCKET=$SESSION_ARTIFACTS_BUCKET

# JWT Authentication (for Direct Mode)
WALLCRAWLER_JWT_SECRET_ARN=$JWT_SECRET_ARN
WALLCRAWLER_JWT_SIGNING_KEY=$JWT_SIGNING_KEY

# AWS Configuration (if not using default profile)
# AWS_REGION=$REGION
# AWS_PROFILE=your-profile-name
EOF

echo ""
echo -e "${GREEN}✅ Successfully generated $OUTPUT_FILE${NC}"
echo ""
echo -e "${YELLOW}Summary:${NC}"
echo "  Public API URL: $API_GATEWAY_URL"
echo "  Internal API URL: $INTERNAL_API_URL"
echo "  AWS API Key: ${API_KEY_VALUE:0:10}..."
echo "  DynamoDB Table: $DYNAMODB_TABLE"
echo "  ECS Cluster: $ECS_CLUSTER"
echo "  JWT Secret ARN: $JWT_SECRET_ARN"
echo "  Session Artifacts Bucket: $SESSION_ARTIFACTS_BUCKET"
echo ""
echo -e "${YELLOW}Usage Instructions:${NC}"
echo ""
echo "1. For Public API access (RECOMMENDED):"
echo "   - Use Public API URL: $API_GATEWAY_URL"
echo "   - Set x-wc-api-key header with your Wallcrawler API key"
echo "   - No AWS API key needed!"
echo ""
echo "2. For Internal API access (advanced users):"
echo "   - Use Internal API URL: $INTERNAL_API_URL"
echo "   - Set x-api-key header with AWS API key: ${API_KEY_VALUE:0:10}..."
echo ""
echo "3. For Direct Mode (CDP) access:"
echo "   - Use WALLCRAWLER_JWT_SIGNING_KEY for authentication"
echo "   - Connect to sessions via the connectUrl returned by the API"
echo ""
echo "4. Copy the relevant variables from $OUTPUT_FILE to your application's .env file"
