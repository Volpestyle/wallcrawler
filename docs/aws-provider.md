# AWS Provider Documentation

## Overview

AWS Browser Provider integrates Stagehand with custom AWS infrastructure for serverless browser automation.

## High-Level Data Flow

1. **Initialization**: Create AwsBrowserProvider with config (region, apiKey, loadFromSsm).
2. **Browser Acquisition**: Stagehand calls getBrowser() → Provider calls AWS API (Lambda) to create/resume session → Lambda starts ECS task with browser-container if needed → Returns Playwright browser connected via CDP.
3. **API Configuration**: Provides baseApiUrl for Stagehand to route AI calls to AWS Lambda.
4. **Operations**: Stagehand methods (act, etc.) call AWS endpoints, which coordinate with browser via Redis/WS.

Flow: Stagehand → AwsProvider → API Gateway → Lambda → Redis/ECS → Browser Container.

## Low-Level Data Shapes

### AwsProviderConfig

```ts
interface AwsProviderConfig {
  region: string;
  apiKey: string;
  apiEndpoint?: string;
  websocketEndpoint?: string;
  cdpEndpoint?: string;
  s3?: { bucketName: string; region?: string; keyPrefix?: string };
  loadFromSsm?: boolean;
  projectName?: string;
  environment?: string;
}
```

### BrowserResult (returned by getBrowser)

```ts
type BrowserResult = {
  browser: Browser;
  context: BrowserContext;
  sessionId: string;
  env: 'LOCAL';
  debugUrl?: string;
  sessionUrl?: string;
  contextPath?: string;
};
```

### SessionDetails

```ts
interface SessionDetails {
  id: string;
  browserSettings: { cdpUrl?: string; token?: string };
  taskArn?: string;
}
```
