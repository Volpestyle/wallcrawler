# Wallcrawler Deployment Outputs and Configuration

## Overview

After deploying Wallcrawler with `pnpm deploy`, you'll receive several outputs that are required to use the service. This guide explains what each output means and how to use them.

## Deployment Outputs

When you run `pnpm deploy`, CDK will output the following values:

### 1. **APIGatewayURL**
- **Description**: The base URL for all Wallcrawler API endpoints
- **Example**: `https://abc123.execute-api.us-east-1.amazonaws.com/dev/`
- **Usage**: Set as `BROWSERBASE_API_URL` to override the SDK's default endpoint

### 2. **ApiKeyId**
- **Description**: The ID of the API key (not the actual key value)
- **Example**: `abc123def456`
- **Usage**: Used to retrieve the actual API key value

### 3. **GetApiKeyCommand**
- **Description**: AWS CLI command to get the actual API key value
- **Example**: `aws apigateway get-api-key --api-key abc123 --include-value --query value --output text --region us-east-1`
- **Usage**: Run this command to get your API key

### 4. **DynamoDBTableName**
- **Description**: Name of the DynamoDB table storing session data
- **Example**: `wallcrawler-sessions`
- **Usage**: For debugging or direct table access

### 5. **RedisEndpoint**
- **Description**: Redis endpoint for pub/sub events
- **Example**: `wallcrawler-pubsub.abc123.cache.amazonaws.com:6379`
- **Usage**: Internal use by Lambda functions

### 6. **ECSClusterName**
- **Description**: ECS cluster running browser containers
- **Example**: `wallcrawler-browsers`
- **Usage**: For monitoring and debugging

### 7. **JWTSigningSecretArn**
- **Description**: AWS Secrets Manager ARN for JWT signing key
- **Example**: `arn:aws:secretsmanager:us-east-1:123456789012:secret:JWTSigningKey-abc123`
- **Usage**: For Direct Mode authentication

## Getting Your API Keys

### Method 1: Automatic Generation (Recommended)

After deployment, run:

```bash
pnpm generate-env
```

This will:
1. Fetch all deployment outputs
2. Retrieve the actual API key value
3. Get the JWT signing key from Secrets Manager
4. Generate a `.env.local` file with all required variables

### Method 2: Manual Retrieval

#### Get API Gateway Key:
```bash
# Use the command from the deployment output
aws apigateway get-api-key --api-key YOUR_API_KEY_ID --include-value --query value --output text --region us-east-1
```

#### Get JWT Signing Key (for Direct Mode):
```bash
# Replace with your secret ARN from deployment output
aws secretsmanager get-secret-value --secret-id YOUR_JWT_SECRET_ARN --region us-east-1 --query SecretString --output text | jq -r '.signingKey'
```

## Required Environment Variables

### For SDK Usage (Browserbase-compatible):
```env
# Required
BROWSERBASE_API_KEY=your-api-key-value
BROWSERBASE_PROJECT_ID=default

# Optional: Use your Wallcrawler deployment instead of official API
BROWSERBASE_API_URL=https://your-api-gateway-url/dev/
```

### For Direct AWS Access:
```env
# API Access
WALLCRAWLER_API_URL=https://your-api-gateway-url/dev/
WALLCRAWLER_API_KEY=your-api-key-value

# AWS Resources
WALLCRAWLER_DYNAMODB_TABLE=wallcrawler-sessions
WALLCRAWLER_REDIS_ENDPOINT=redis-endpoint:6379
WALLCRAWLER_ECS_CLUSTER=wallcrawler-browsers

# Direct Mode Authentication
WALLCRAWLER_JWT_SECRET_ARN=arn:aws:secretsmanager:...
WALLCRAWLER_JWT_SIGNING_KEY=your-jwt-signing-key
```

## Authentication Requirements

### API Gateway Key
- **Required for**: All API requests
- **Header**: `X-Api-Key`
- **Get it**: Run the `GetApiKeyCommand` from deployment output

### Wallcrawler API Key
- **Required for**: Session operations
- **Header**: `x-wc-api-key`
- **Get it**: This is your custom key (e.g., from jobseek)

### JWT Signing Key
- **Required for**: Direct Mode CDP access
- **Usage**: Automatically used by the CDP proxy
- **Get it**: Retrieved from AWS Secrets Manager

## Example Usage

### Using the SDK:
```typescript
import { Browserbase } from '@browserbase/sdk';

const bb = new Browserbase({
  apiKey: process.env.BROWSERBASE_API_KEY,
  // Optional: Use your Wallcrawler deployment
  baseURL: process.env.BROWSERBASE_API_URL
});

const session = await bb.sessions.create({
  projectId: process.env.BROWSERBASE_PROJECT_ID
});
```

### Direct API Call:
```bash
curl -X POST https://your-api-gateway-url/dev/v1/sessions \
  -H "X-Api-Key: your-aws-api-key" \
  -H "x-wc-api-key: your-wallcrawler-key" \
  -H "Content-Type: application/json" \
  -d '{"projectId": "default"}'
```

## Troubleshooting

### Can't retrieve API key
- Ensure your AWS credentials are configured: `aws configure`
- Check you have permissions: `apigateway:GET` on the API key resource

### Can't retrieve JWT signing key
- Ensure you have permissions: `secretsmanager:GetSecretValue` on the secret
- The secret ARN is in the deployment outputs

### Authentication errors
- API Gateway requires the `X-Api-Key` header
- Wallcrawler endpoints also require `x-wc-api-key` header
- Both keys must be valid

## Security Notes

1. **Never commit keys to git** - Use environment variables or secrets management
2. **Rotate keys regularly** - JWT keys can be auto-rotated via CDK context
3. **Use least privilege** - Only grant necessary AWS permissions
4. **Monitor usage** - Check CloudWatch for unusual API activity
