# WallCrawler AWS CDK Infrastructure

AWS CDK infrastructure for deploying WallCrawler with human intervention system.

## Overview

This project contains the AWS CDK infrastructure code to deploy the complete WallCrawler human intervention system, including:

- Lambda functions for intervention detection
- WebSocket API for real-time browser control
- DynamoDB tables for state management
- S3 buckets for artifacts and portal hosting
- CloudFront distribution for the intervention portal
- SNS topics for multi-channel notifications

## Prerequisites

- AWS Account with appropriate permissions
- Node.js 18+
- AWS CDK CLI: `npm install -g aws-cdk`
- AWS credentials configured
- pnpm package manager

## Installation

```bash
# Install dependencies
pnpm install

# Build the TypeScript
pnpm run build
```

## Configuration

Before deploying, ensure you have:

1. AWS credentials configured:

   ```bash
   aws configure
   ```

2. CDK bootstrapped in your AWS account:

   ```bash
   pnpm run bootstrap
   ```

3. Built the @wallcrawler/aws package:
   ```bash
   cd ../wallcrawler-aws
   pnpm run build
   ```

## Deployment

```bash
# Synthesize CloudFormation template
pnpm run synth

# Deploy the stack
pnpm run deploy

# Or deploy with specific AWS profile
AWS_PROFILE=myprofile pnpm run deploy
```

## Stack Outputs

After deployment, the stack will output:

- **InterventionHandlerArn**: Lambda function ARN for handling interventions
- **WebSocketApiUrl**: WebSocket API endpoint for real-time communication
- **PortalUrl**: CloudFront URL for the intervention portal
- **ArtifactsBucketName**: S3 bucket name for storing artifacts

Save these values as they're needed to configure the WallCrawler AWS extension.

## Architecture

The infrastructure includes:

### Core Services

- **Lambda Functions**: Intervention detection, WebSocket handlers
- **API Gateway**: WebSocket API for real-time browser control
- **DynamoDB Tables**: Sessions, interventions, device tokens, connections
- **S3 Buckets**: Artifacts storage, portal static files

### Security

- **Secrets Manager**: JWT secrets, push notification credentials
- **IAM Roles**: Least-privilege access for all services
- **CloudFront**: Secure portal delivery with Lambda@Edge auth

### Monitoring

- **CloudWatch Logs**: Centralized logging for all Lambda functions
- **CloudWatch Metrics**: Performance and error tracking

## Usage with WallCrawler

After deploying, use the outputs to configure WallCrawler:

```typescript
import { WallCrawlerAWSProvider } from '@wallcrawler/aws';

const AWSProvider = new WallCrawlerAWSProvider(sessionId, userId, {
  region: 'us-east-1',
  interventionLambdaArn: '<InterventionHandlerArn from outputs>',
  artifactsBucket: '<ArtifactsBucketName from outputs>',
});
```

## Customization

### Modify Lambda Memory/Timeout

Edit `lib/wallcrawler-stack.ts`:

```typescript
const interventionDetectorFn = new lambda.Function(
  this,
  'InterventionDetector',
  {
    // ...
    timeout: cdk.Duration.minutes(2), // Increase timeout
    memorySize: 2048, // Increase memory
  }
);
```

### Add Custom Domain

Add to the CloudFront distribution:

```typescript
const portalDistribution = new cloudfront.Distribution(
  this,
  'PortalDistribution',
  {
    // ...
    domainNames: ['intervention.yourdomain.com'],
    certificate: acm.Certificate.fromCertificateArn(
      this,
      'Cert',
      'arn:aws:acm:...'
    ),
  }
);
```

## Cleanup

To remove all resources:

```bash
pnpm run destroy
```

⚠️ **Warning**: This will delete all data in DynamoDB tables and S3 buckets.

## Troubleshooting

### CDK Bootstrap Error

If you see "This stack uses assets", run:

```bash
cdk bootstrap aws://ACCOUNT-NUMBER/REGION
```

### Lambda Timeout

Increase the timeout in the stack definition if intervention detection takes longer.

### WebSocket Connection Issues

Check CloudWatch logs for the WebSocket Lambda functions for detailed error messages.

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT - see [LICENSE](../LICENSE) for details.
