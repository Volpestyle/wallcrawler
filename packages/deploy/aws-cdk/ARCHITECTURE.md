# WallCrawler AWS CDK Architecture

## Overview

WallCrawler uses a simplified 2-stack CDK architecture for deploying a scalable, secure browser automation platform on AWS.

## Stack Architecture

### 1. Core Infrastructure Stack (`wallcrawler-core-{env}`)

Contains all shared infrastructure resources that change infrequently:

- **Networking**
  - VPC with public, private, and isolated subnets
  - Security groups for ALB, containers, Lambda, and Redis
  - VPC endpoints for AWS services (production only)
  - No NAT Gateway in development (cost optimization)

- **Load Balancing**
  - Application Load Balancer (ALB) for all traffic
  - WAF protection (production only)

- **Storage & Caching**
  - ElastiCache Redis for session state
  - S3 bucket for browser artifacts
  - KMS encryption for all data at rest

- **Security**
  - KMS keys for encryption
  - Secrets Manager for JWE secrets and API keys
  - Service discovery namespace

### 2. Application Services Stack (`wallcrawler-app-{env}`)

Contains all application-specific services:

- **Container Services**
  - ECS Fargate cluster
  - Browser container task definition (multi-session)
  - Proxy service for WebSocket routing
  - ECR repositories for container images

- **API & Functions**
  - API Gateway REST API
  - Lambda functions for session management:
    - Create session
    - Get session
    - Delete session
    - List sessions
    - Cleanup expired sessions
  - EventBridge rule for periodic cleanup

- **Monitoring**
  - CloudWatch log groups
  - CloudWatch dashboard
  - Auto-scaling policies

## Architecture Diagram

![WallCrawler AWS Architecture](./docs/generated-diagrams/wallcrawler-architecture.png)

## Security Features

1. **JWE Authentication**
   - Symmetric encryption using A256GCM algorithm
   - Encryption key derived from secret using SHA-256
   - Tokens provide confidentiality and integrity
   - Stored secrets automatically rotated by AWS

2. **Session Sandboxing**
   - Each session runs in isolated browser context
   - CDP command filtering prevents dangerous operations
   - Session timeout and cleanup mechanisms

3. **CDP Security**
   - Command allowlisting
   - Rate limiting per method
   - Parameter sanitization
   - Audit logging

4. **Network Security**
   - Redis TLS encryption in production
   - Private subnet isolation
   - Security group restrictions
   - WAF protection (production)

## Cost Optimizations

- **Multi-Session Containers**: 20 browser sessions per container (~87.5% cost reduction)
- **No NAT Gateway**: Development environments use public subnets
- **S3 Lifecycle Policies**: Automatic cleanup of old artifacts
- **Right-sized Instances**: Different sizes for dev/prod
- **Spot Instance Support**: For non-critical workloads

## Deployment

```bash
# Deploy both stacks
./deploy.sh

# Deploy individual stacks
cdk deploy wallcrawler-core-dev --context environment=dev --context projectName=wallcrawler
cdk deploy wallcrawler-app-dev --context environment=dev --context projectName=wallcrawler

# With custom configuration
cdk deploy --all \
  --context environment=prod \
  --context projectName=wallcrawler \
  --context allowedApiKeys=key1,key2,key3 \
  --context maxSessionsPerContainer=20 \
  --context customDomain=browser.example.com \
  --context certificateArn=arn:aws:acm:...
```

## Resource Flow

1. **Session Creation**

   ```
   Client → API Gateway → Lambda → Redis
                                 ↘ Returns JWE token
   ```

2. **WebSocket Connection**

   ```
   Client → ALB → Proxy Service → Browser Container
          ↑ JWE validation      ↘ CDP commands
   ```

3. **Browser Lifecycle**
   ```
   Proxy Service → ECS RunTask → Browser Container
                               ↘ Multi-session (1-20)
   ```

## Configuration Options

- `environment`: Deployment environment (dev/prod)
- `projectName`: Project name prefix for resources
- `allowedApiKeys`: Comma-separated API keys
- `maxSessionsPerContainer`: Sessions per container (default: 20)
- `proxyMinContainers`: Minimum proxy containers (default: 2)
- `proxyMaxContainers`: Maximum proxy containers (default: 100)
- `customDomain`: Custom domain for ALB
- `certificateArn`: ACM certificate for HTTPS

## Monitoring

- CloudWatch Dashboard: `wallcrawler-{env}`
- Metrics:
  - Active sessions
  - Container CPU/memory utilization
  - API request rates
  - WebSocket connection counts
  - Error rates
