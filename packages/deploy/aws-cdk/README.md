# WallCrawler AWS CDK Infrastructure

This package contains AWS CDK constructs and stacks for deploying WallCrawler infrastructure optimized for browser automation workloads.

## Architecture

The infrastructure includes:

- **VPC**: Multi-AZ VPC with public, private, and isolated subnets
- **Redis ElastiCache**: High-performance Redis cluster for session state management
- **ECS Fargate**: Container orchestration for browser automation tasks
- **Application Load Balancer**: Internal load balancer for ECS services
- **Security Groups**: Least-privilege security configuration
- **VPC Endpoints**: Cost-optimized AWS service access

## Quick Start

### Prerequisites

1. AWS CLI configured with appropriate permissions
2. Node.js 18+ and pnpm installed
3. AWS CDK CLI installed: `npm install -g aws-cdk`

### Installation

```bash
cd packages/deploy/aws-cdk
pnpm install
```

### Bootstrap CDK (first time only)

```bash
pnpm run bootstrap
```

### Deploy

```bash
# Development environment
pnpm run deploy

# Production environment
pnpm run deploy -- -c environment=prod -c projectName=wallcrawler-prod
```

### Useful Commands

```bash
pnpm run build        # Compile TypeScript
pnpm run synth        # Generate CloudFormation template
pnpm run diff         # Show differences with deployed stack
pnpm run destroy      # Destroy the stack
pnpm run lint         # Run ESLint
pnpm run test         # Run tests
```

## Configuration

### Environment Variables

- `CDK_DEFAULT_ACCOUNT`: AWS account ID
- `CDK_DEFAULT_REGION`: AWS region (default: us-east-1)

### Context Variables

You can customize deployment using CDK context:

```bash
cdk deploy -c environment=prod -c projectName=my-project -c vpcCidr=10.1.0.0/16
```

Available context variables:
- `environment`: Deployment environment (dev, staging, prod)
- `projectName`: Project name for resource naming
- `vpcCidr`: VPC CIDR block
- `maxAzs`: Maximum number of Availability Zones
- `redisNodeType`: Redis node instance type
- `redisReplicas`: Number of Redis replica nodes
- `ecsTaskCpu`: ECS task CPU units
- `ecsTaskMemory`: ECS task memory (MB)

## Infrastructure Components

### Networking Stack

Creates a VPC with:
- Public subnets for load balancers
- Private subnets for ECS tasks
- Isolated subnets for databases
- NAT gateways for internet access
- VPC endpoints for AWS services (production)

### Redis Cluster

Deploys ElastiCache Redis with:
- Multi-AZ deployment (production)
- Encryption at rest and in transit
- Automated backups
- CloudWatch logging
- Optimized parameter group for session storage

### ECS Cluster

Provisions Fargate cluster with:
- Browser automation task definition
- Application Load Balancer
- Auto-scaling capabilities
- CloudWatch logging
- Health checks and monitoring

## Security

The infrastructure follows AWS security best practices:

- **Network Security**: Resources deployed in private/isolated subnets
- **Encryption**: All data encrypted at rest and in transit
- **IAM**: Least-privilege roles and policies
- **Security Groups**: Minimal required access
- **VPC Flow Logs**: Network traffic monitoring

## Monitoring

Built-in monitoring includes:

- **CloudWatch Logs**: Centralized logging for all services
- **Container Insights**: ECS performance monitoring (production)
- **VPC Flow Logs**: Network traffic analysis
- **ElastiCache Metrics**: Redis performance monitoring

## Cost Optimization

- **VPC Endpoints**: Reduces NAT gateway costs in production
- **Spot Instances**: Can be enabled for non-critical workloads
- **Auto Scaling**: Scales resources based on demand
- **Environment-specific Sizing**: Smaller instances for dev/test

## Deployment Environments

### Development
- Single AZ deployment
- Minimal instance sizes
- Reduced backup retention
- No Multi-AZ Redis

### Production
- Multi-AZ deployment
- Larger instance sizes
- Extended backup retention
- Multi-AZ Redis with replicas
- VPC endpoints for cost optimization

## Customization

### Adding Custom Constructs

```typescript
import { WallCrawlerInfraStack } from '@wallcrawler/aws-cdk';

const stack = new WallCrawlerInfraStack(app, 'MyStack', {
  environment: 'prod',
  projectName: 'my-project',
});

// Access individual components
const redis = stack.redisCluster;
const ecs = stack.ecsCluster;
const networking = stack.networking;
```

### Environment-specific Configuration

Create environment-specific configuration files:

```typescript
// config/dev.ts
export const devConfig = {
  vpcCidr: '10.0.0.0/16',
  maxAzs: 2,
  redisNodeType: 'cache.t3.micro',
  redisReplicas: 0,
  ecsTaskCpu: 512,
  ecsTaskMemory: 1024,
};

// config/prod.ts
export const prodConfig = {
  vpcCidr: '10.1.0.0/16',
  maxAzs: 3,
  redisNodeType: 'cache.r7g.large',
  redisReplicas: 2,
  ecsTaskCpu: 1024,
  ecsTaskMemory: 2048,
};
```

## Troubleshooting

### Common Issues

1. **Bootstrap Required**: Run `pnpm run bootstrap` if you see bootstrap errors
2. **Permissions**: Ensure your AWS credentials have sufficient permissions
3. **Region**: Verify your AWS region supports all required services
4. **Quotas**: Check AWS service limits for your account

### Debug Mode

Enable debug logging:

```bash
export CDK_DEBUG=true
pnpm run deploy
```

## Contributing

1. Make changes to constructs or stacks
2. Run `pnpm run build` to compile
3. Run `pnpm run test` to validate
4. Run `pnpm run synth` to generate CloudFormation
5. Test in a development environment before production