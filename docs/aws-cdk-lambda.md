# AWS CDK and Lambda Documentation

## Overview

Deploys serverless infrastructure for browser automation. CDK stacks create API Gateway, Lambda, ECS, Redis, S3. Lambda functions handle session management and CDP proxying.

## High-Level Data Flow

1. **Deployment**: CDK deploys CoreInfrastructureStack (VPC, SG, Redis, S3) and ApplicationServicesStack (ECS, Lambda, API).
2. **Session Creation**: Client → API → create-session Lambda → Store in Redis → Start ECS task → Browser container claims session.
3. **Operations**: act/extract → Lambda → Command to Redis → Container executes → Result to Redis → Lambda returns.
4. **CDP**: Client → WS API → websocket-message Lambda → Proxy to container.

## Low-Level Data Shapes

From Lambda env:

- ECS_CLUSTER_ARN, TASK_DEFINITION_ARN, etc.

Session in Redis:

```json
{
  "sessionId": "string",
  "userId": "string",
  "status": "pending|active|closed",
  "taskArn": "string",
  "containerId": "string",
  "browserSettings": {}
}
```

See lambda/functions for handler params.
