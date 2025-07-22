# @wallcrawler/aws-provider

AWS Browser Provider for Stagehand in the WallCrawler project. This package provides a pluggable browser provider that integrates Stagehand's AI-powered browser automation with your AWS infrastructure, deployed via `@wallcrawler/aws-cdk` and running browser instances in `@wallcrawler/browser-container`.

## Overview

This provider bridges Stagehand (which handles AI/LLM interactions for browser automation) with the AWS backend:

- **Browser Infrastructure**: Runs headless Chrome instances in ECS Fargate tasks using the `@wallcrawler/browser-container` Docker image.
- **API Layer**: Uses API Gateway and Lambda for session management, CDP connections, and coordination.
- **Configuration**: Loads from AWS SSM or manual config.
- **Integration**: Implements Stagehand's `BrowserProvider` interface, so Stagehand sees it as a "local" browser while running on AWS.

Key benefits:

- Serverless scaling (zero idle costs)
- Secure CDP connections over WebSockets
- Seamless with Stagehand's AI features (act, observe, extract)

## Architecture

```mermaid
graph TB
    subgraph "Client (Your App)"
        Stagehand[Stagehand] --> AwsProvider[AwsBrowserProvider]
    end

    subgraph "AWS Infrastructure (via @wallcrawler/aws-cdk)"
        AwsProvider --> APIGateway[API Gateway]
        APIGateway --> Lambda[Lambda Functions]
        Lambda --> ECS[ECS Fargate]
        ECS --> BrowserContainer[@wallcrawler/browser-container]
        Lambda --> SSM[SSM Parameters]
        Lambda --> Redis[ElastiCache Redis]
        BrowserContainer --> S3[S3 Artifacts]
    end

    Stagehand -->|AI Calls| AwsProvider
    AwsProvider -->|CDP over WS| BrowserContainer
```

1. **Deployment (@wallcrawler/aws-cdk)**: Deploys API Gateway, Lambda, ECS cluster, and supporting services (Redis for sessions, S3 for artifacts).
2. **Browser Runtime (@wallcrawler/browser-container)**: Docker container running Playwright/Chrome, handling multi-session CDP.
3. **Client Integration (this package)**: `AwsBrowserProvider` class that Stagehand uses to create/resume sessions and connect via CDP.
4. **Stagehand Internals**: Stagehand calls `getBrowser()` on the provider to get a Playwright context, then uses its LLM logic on top.

## Installation

```bash
pnpm add @wallcrawler/aws-provider
```

Dependencies:

- `@wallcrawler/stagehand` (for types and integration)
- `playwright` (for CDP connections)
- `@aws-sdk/client-ssm` (for config loading)

## Setup

1. **Deploy Infrastructure**:
   - Use `@wallcrawler/aws-cdk` to deploy your stack.
   - Note the API Gateway endpoint URL (stored in SSM).

2. **Configure Provider**:
   - Automatic (SSM): Loads endpoint/config from AWS SSM.
   - Manual: Provide endpoint and API key.

## Usage

```typescript
import { AwsBrowserProvider } from '@wallcrawler/aws-provider';
import { Stagehand } from '@wallcrawler/stagehand';

// Create provider with automatic SSM config
const awsProvider = new AwsBrowserProvider({
  region: 'us-east-1',
  apiKey: process.env.WALLCRAWLER_API_KEY,
  loadFromSsm: true,
  projectName: 'wallcrawler', // Matches SSM path
  environment: 'dev',
});

await awsProvider.initialize();

// Get API config from provider (for Stagehand's API calls)
const apiConfig = awsProvider.getStagehandConfig();

// Initialize Stagehand with AWS provider
const stagehand = new Stagehand({
  provider: awsProvider, // Browser via AWS
  useAPI: true, // Enable API mode
  baseApiUrl: apiConfig.baseApiUrl, // Your AWS endpoint
  apiKey: apiConfig.apiKey,
  projectId: apiConfig.projectId,
  modelName: 'gpt-4-turbo', // Your LLM
  modelClientOptions: {
    apiKey: process.env.OPENAI_API_KEY,
  },
});

await stagehand.init();

// Use as normal - runs on AWS!
await stagehand.page.goto('https://example.com');
const result = await stagehand.page.act('Click the button');
```

- **Automatic Config**: `loadFromSsm: true` pulls endpoint from SSM (deployed by CDK).
- **Manual Config**: Set `apiEndpoint: 'https://your-api.execute-api...'` in constructor.

## Internals

### Key Methods

- **`initialize()`**: Loads config, sets up endpoint.
- **`getBrowser(options)`**: Creates/resumes AWS session, returns `BrowserResult` with Playwright context connected via CDP. Matches Stagehand's expected format.
- **`getApiEndpoint()` / `getStagehandConfig()`**: Provides config for Stagehand's `baseApiUrl` and auth.

### How It Bridges Components

- **To @wallcrawler/aws-cdk**: Calls API Gateway endpoints deployed by CDK (e.g., `/sessions` Lambda).
- **To @wallcrawler/browser-container**: ECS tasks run the container; provider connects via CDP URLs from API.
- **To Stagehand**: Implements `BrowserProvider` interface exactly, so Stagehand treats it as a native provider. Provides API config so Stagehand's `StagehandAPI` calls your AWS endpoints for AI operations.

### Authentication

- Uses `Authorization: Bearer ${apiKey}` - ensure your API Gateway/Lambda validates this.
- SSM stores sensitive config (endpoints, keys).

## Troubleshooting

- **Session Errors**: Verify ECS tasks are running and CDP ports exposed.
- **API Calls Fail**: Check Lambda logs; ensure endpoints match Stagehand's expected paths.
- **Config Loading**: If SSM fails, set `loadFromSsm: false` and provide manual config.
- **Debugging**: Use `verbose: 2` in Stagehand for detailed logs.

For full deployment instructions, see `@wallcrawler/aws-cdk` README. If issues, check AWS CloudWatch logs for Lambda/ECS.
