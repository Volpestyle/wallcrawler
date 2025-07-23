To integrate the Wallcrawler platform with the provided requirements, we need to create a `Wallcrawler` package equivalent to the `Browserbase` class shown in the code. This package will serve as a client-side SDK to interact with the AWS-based infrastructure, replacing Browserbase’s functionality while maintaining compatibility with the forked Stagehand library. The `Wallcrawler` package will be a standalone package within the pnpm monorepo, designed to handle session management, CDP connections, and interactions with the AWS API Gateway endpoints for browser automation. It will support the same key operations (e.g., session creation, retrieval, and debugging) as Browserbase, but tailored to the Wallcrawler architecture (AWS Lambda, ECS Fargate, EventBridge, Redis, and API Gateway).

The `Wallcrawler` package will:

- Replace Browserbase’s SDK in `getBrowser` to connect to remote browser sessions in ECS Fargate containers via CDP.
- Provide a TypeScript SDK for session management (`create`, `retrieve`, `debug`, etc.), mirroring Browserbase’s API structure.
- Integrate with the AWS infrastructure, using API Gateway for REST calls and WebSocket for screencasting.
- Be a dependency for the `stagehand` package, ensuring seamless integration with the forked Stagehand.

Below, I’ll update the holistic documentation to include the new `Wallcrawler` package, modify the `getBrowser` function to use it, and provide artifacts for the package implementation, monorepo structure, and necessary infrastructure changes. I’ll also ensure all shared types and utilities are centralized in `packages/util-ts` to avoid duplication, maintaining the serverless, pay-per-use model.

---

### Updated Holistic Product, Infrastructure, and Design Documentation

#### Product Overview

**Wallcrawler** is a serverless browser automation platform that integrates a forked Stagehand (as a git submodule) to process natural language instructions client-side via LLMs, executing them in persistent, remote browser sessions on AWS. It supports decoupled screencasting, pause/resume for user input, and scalable session management. The new `Wallcrawler` package replaces Browserbase as the client-side SDK, interfacing with AWS API Gateway to manage sessions and connect to headless Chrome instances in ECS Fargate containers.

**Key Features**:

- **LLM-Driven Automation**: Stagehand handles client-side LLM calls (e.g., OpenAI, xAI) to translate instructions into browser actions (`act`, `observe`, `agent.execute`).
- **Persistent Sessions**: ECS Fargate containers run Chrome, maintaining state via Redis, even after client disconnects.
- **Screencasting**: WebSocket streams browser frames, independent of automation.
- **Event-Driven**: EventBridge manages `ExecuteScript`, `ResumeSession`, and `PauseNotification` events.
- **Wallcrawler SDK**: A TypeScript package mimicking Browserbase’s API, handling session creation, retrieval, and CDP connections.

**Target Users**: Developers building AI agents, web scrapers, or testing tools with natural language control.

#### Infrastructure Design

Fully serverless, deployed via AWS CDK (TypeScript). Each session runs in an isolated Fargate container, with the `Wallcrawler` SDK interfacing with API Gateway.

##### AWS Services

1. **Amazon API Gateway**:
   - **Purpose**: Exposes REST endpoints (`/start-session`, `/sessions/{sessionId}/{act,observe,agentExecute,end,debug,retrieve}`) and WebSocket for screencasting.
   - **Config**: HTTP API for cost efficiency; WebSocket for frame streaming. Auth via API keys or Cognito.
   - **CDK**:
     ```typescript
     new apigateway.HttpApi(stack, 'WallcrawlerApi', { apiName: 'WallcrawlerApi' });
     new apigateway.WebSocketApi(stack, 'ScreencastApi', { routes: { screencast: screencastLambda } });
     ```
   - **Cost**: ~$3.50/million requests.

2. **AWS Lambda**:
   - **Purpose**: Handles API requests, triggers ECS tasks, manages events.
   - **Handlers** (Go):
     - `StartSessionLambda`: Launches ECS task, stores session metadata in Redis.
     - `ActLambda`: Processes `act` requests (e.g., `click:#button`).
     - `ObserveLambda`: Handles `observe`, returns DOM data.
     - `AgentExecuteLambda`: Executes agent scripts from Stagehand.
     - `ResumeSessionLambda`: Processes user inputs.
     - `StopSessionLambda`: Terminates tasks.
     - `PauseNotificationLambda`: Notifies clients of pauses.
     - `ScreencastLambda`: Routes WebSocket to ECS CDP.
     - `RetrieveSessionLambda`: Fetches session status from Redis.
     - `DebugSessionLambda`: Returns CDP endpoint for debugging.
   - **CDK**:
     ```typescript
     new lambda.Function(stack, 'StartSessionLambda', {
       runtime: lambda.Runtime.GO_1_X,
       code: lambda.Code.fromAsset('packages/backend-go/bin/start-session'),
       handler: 'start-session',
     });
     ```
   - **Cost**: ~$0.20/million invocations.

3. **Amazon ECS (Fargate)**:
   - **Purpose**: Runs headless Chrome + Go controller per session.
   - **Config**: Custom Docker image (`browserless/chrome` + Go app), CDP on port 9222.
   - **CDK**:
     ```typescript
     const taskDef = new ecs.FargateTaskDefinition(stack, 'ChromeTask', { cpu: 512, memoryLimitMiB: 1024 });
     taskDef.addContainer('ChromeContainer', {
       image: ecs.ContainerImage.fromAsset('../backend-go'),
       environment: { REDIS_ADDR: 'redis-endpoint' },
     });
     ```
   - **Cost**: ~$0.01/hour per task (spot instances).

4. **Amazon ElastiCache (Redis)**:
   - **Purpose**: Stores session state (`id`, `script`, `state`, `cdpEndpoint`, `results`, `pauseReason`).
   - **Config**: Serverless Redis, VPC-private, pub/sub for events.
   - **CDK**:
     ```typescript
     new elasticache.CfnServerlessCache(stack, 'WallcrawlerRedis', {
       engine: 'redis',
       cacheUsageLimits: { dataStorage: { maximum: 10 } },
     });
     ```
   - **Cost**: ~$0.017/hour.

5. **AWS EventBridge**:
   - **Purpose**: Triggers `ExecuteScript`, `ResumeSession`, `PauseNotification`.
   - **CDK**:
     ```typescript
     new events.Rule(stack, 'ExecuteScriptRule', {
       eventPattern: { source: ['browser.automation'], detailType: ['ExecuteScript'] },
       targets: [new targets.EcsTask({ cluster, taskDefinition })],
     });
     ```
   - **Cost**: ~$1/million events.

6. **Amazon CloudWatch**:
   - **Purpose**: Logs, metrics, alarms.
   - **CDK**: Enabled by default.

7. **AWS Secrets Manager**:
   - **Purpose**: Stores API keys (e.g., LLM keys for Stagehand).
   - **CDK**:
     ```typescript
     new secretsmanager.Secret(stack, 'LlmKey');
     ```

8. **Amazon VPC**:
   - **Purpose**: Secures ECS, Redis.
   - **CDK**:
     ```typescript
     new ec2.Vpc(stack, 'WallcrawlerVpc', { natGateways: 1 });
     ```

#### Monorepo Structure

````plaintext
wallcrawler/
├── packages/
│   ├── util-ts/          # Shared TypeScript types/utils
│   │   └── src/
│   │       ├── types.ts
│   │       ├── utils.ts
```typescript
export interface SessionMetadata {
  id: string;
  state: 'initializing' | 'running' | 'paused' | 'completed';
  script: string;
  cdpEndpoint?: string;
  results?: any;
  pauseReason?: string;
}

export interface ActOptions {
  action: string;
  selector?: string;
  timeoutMs?: number;
  variables?: Record<string, string>;
}

export interface ObserveResult {
  selector: string;
  method: string;
  arguments?: string[];
  description?: string;
}

export interface Session {
  id: string;
  status: 'RUNNING' | 'STOPPED' | 'ERROR';
  connectUrl: string;
}

export interface SessionCreateParams {
  projectId: string;
  script?: string;
  userMetadata?: Record<string, string>;
}

export interface SessionCreateResponse {
  id: string;
  connectUrl: string;
}
````

```typescript
export function parseLLMResponse(response: string): string[] {
  return response.split(';').map((action) => action.trim());
}

export function validateScript(script: string): boolean {
  const validActions = ['navigate', 'click', 'type', 'observe', 'pause'];
  return script.split(';').every((action) => {
    const [type] = action.split(':');
    return validActions.includes(type);
  });
}
```

│ ├── util-go/ # Shared Go utilities
│ │ ├── parse_script.go
│ │ ├── redis_client.go

```go
package util

import "strings"

type Action struct {
    Type  string
    Value string
    Extra string
}

func ParseScript(script string) []Action {
    var actions []Action
    parts := strings.Split(script, ";")
    for _, part := range parts {
        if part == "" {
            continue
        }
        split := strings.SplitN(part, ":", 2)
        action := Action{Type: split[0]}
        if len(split) > 1 {
            if action.Type == "type" {
                extraSplit := strings.SplitN(split[1], ",", 2)
                action.Value = extraSplit[0]
                if len(extraSplit) > 1 {
                    action.Extra = extraSplit[1]
                }
            } else {
                action.Value = split[1]
            }
        }
        actions = append(actions, action)
    }
    return actions
}
```

```go
package util

import (
    "context"
    "github.com/redis/go-redis/v9"
)

func UpdateState(client *redis.Client, sessionID, state string) error {
    return client.HSet(context.Background(), "session:"+sessionID, "state", state).Err()
}

func StoreScript(client *redis.Client, sessionID, script string) error {
    return client.HSet(context.Background(), "session:"+sessionID, "script", script).Err()
}

func StoreCdpEndpoint(client *redis.Client, sessionID, endpoint string) error {
    return client.HSet(context.Background(), "session:"+sessionID, "cdpEndpoint", endpoint).Err()
}
```

│ ├── wallcrawler-sdk/ # New Wallcrawler SDK package
│ │ └── src/
│ │ ├── index.ts
│ │ ├── sessions.ts

```typescript
import * as Core from './core';
import * as Errors from './error';
import { Sessions, Session, SessionCreateParams, SessionCreateResponse } from './sessions';

export interface ClientOptions {
  apiKey?: string | undefined;
  baseURL?: string | null | undefined;
  timeout?: number | undefined;
  maxRetries?: number | undefined;
  defaultHeaders?: Core.Headers | undefined;
  defaultQuery?: Core.DefaultQuery | undefined;
}

export class Wallcrawler extends Core.APIClient {
  apiKey: string;

  private _options: ClientOptions;

  constructor({
    baseURL = process.env['WALLCRAWLER_BASE_URL'] || 'https://api.yourdomain.com/v1',
    apiKey = process.env['WALLCRAWLER_API_KEY'],
    ...opts
  }: ClientOptions = {}) {
    if (!apiKey) {
      throw new Errors.WallcrawlerError('WALLCRAWLER_API_KEY is required');
    }

    super({
      baseURL,
      timeout: opts.timeout ?? 60000,
      maxRetries: opts.maxRetries ?? 2,
    });

    this._options = { apiKey, ...opts, baseURL };
    this.apiKey = apiKey;
  }

  sessions: Sessions = new Sessions(this);

  protected override defaultHeaders(): Core.Headers {
    return {
      ...super.defaultHeaders(),
      'X-Wallcrawler-API-Key': this.apiKey,
      ...this._options.defaultHeaders,
    };
  }

  static WallcrawlerError = Errors.WallcrawlerError;
}

export default Wallcrawler;
export { Sessions, Session, SessionCreateParams, SessionCreateResponse };
```

```typescript
import * as Core from './core';
import { SessionMetadata } from '@wallcrawler/util-ts';

export interface Session {
  id: string;
  status: 'RUNNING' | 'STOPPED' | 'ERROR';
  connectUrl: string;
}

export interface SessionCreateParams {
  projectId: string;
  script?: string;
  userMetadata?: Record<string, string>;
}

export interface SessionCreateResponse {
  id: string;
  connectUrl: string;
}

export class Sessions extends Core.APIResource {
  constructor(client: Core.APIClient) {
    super(client);
  }

  async create(params: SessionCreateParams, options?: Core.RequestOptions): Promise<SessionCreateResponse> {
    const response = await this.request('/start-session', {
      method: 'POST',
      body: JSON.stringify(params),
      ...options,
    });
    const body = await response.json();
    if (!body.success) {
      throw new Error(body.message);
    }
    return body.data;
  }

  async retrieve(sessionId: string, options?: Core.RequestOptions): Promise<Session> {
    const response = await this.request(`/sessions/${sessionId}/retrieve`, {
      method: 'GET',
      ...options,
    });
    const body = await response.json();
    if (!body.success) {
      throw new Error(body.message);
    }
    return body.data;
  }

  async debug(sessionId: string, options?: Core.RequestOptions): Promise<{ debuggerUrl: string }> {
    const response = await this.request(`/sessions/${sessionId}/debug`, {
      method: 'GET',
      ...options,
    });
    const body = await response.json();
    if (!body.success) {
      throw new Error(body.message);
    }
    return body.data;
  }
}
```

```typescript
export type Headers = Record<string, string | undefined>;
export type DefaultQuery = Record<string, string | undefined>;
export type RequestOptions = {
  method?: string;
  headers?: Headers;
  body?: string;
};

export abstract class APIClient {
  constructor(protected options: { baseURL: string; timeout?: number; maxRetries?: number }) {}

  async request(path: string, opts: RequestOptions): Promise<Response> {
    return fetch(`${this.options.baseURL}${path}`, {
      method: opts.method || 'GET',
      headers: this.defaultHeaders(),
      body: opts.body,
      signal: AbortSignal.timeout(this.options.timeout || 60000),
    });
  }

  protected defaultHeaders(): Headers {
    return {};
  }
}

export abstract class APIResource {
  constructor(protected client: APIClient) {}
}
```

```typescript
export class WallcrawlerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WallcrawlerError';
  }
}
```

│ ├── aws-cdk/ # Infrastructure as Code
│ │ └── lib/wallcrawler-stack.ts

```typescript
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';

export class WallcrawlerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'WallcrawlerVpc', { natGateways: 1 });
    const cluster = new ecs.Cluster(this, 'WallcrawlerCluster', { vpc });

    const taskDef = new ecs.FargateTaskDefinition(this, 'ChromeTask', {
      cpu: 512,
      memoryLimitMiB: 1024,
    });
    taskDef.addContainer('ChromeContainer', {
      image: ecs.ContainerImage.fromAsset('../backend-go'),
      environment: { REDIS_ADDR: 'redis-endpoint' },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'wallcrawler' }),
    });

    const redis = new elasticache.CfnServerlessCache(this, 'WallcrawlerRedis', {
      engine: 'redis',
      cacheUsageLimits: { dataStorage: { maximum: 10 } },
    });

    const api = new apigateway.HttpApi(this, 'WallcrawlerApi', {
      apiName: 'WallcrawlerApi',
    });

    const wsApi = new apigateway.WebSocketApi(this, 'ScreencastApi', {
      connectRouteOptions: { integration: new apigateway.LambdaWebSocketIntegration({ handler: screencastLambda }) },
    });

    const handlers = [
      'start-session',
      'act',
      'observe',
      'agent-execute',
      'resume-session',
      'stop-session',
      'retrieve',
      'debug',
      'screencast',
    ];
    handlers.forEach((handler) => {
      const fn = new lambda.Function(this, `${handler}Lambda`, {
        runtime: lambda.Runtime.GO_1_X,
        code: lambda.Code.fromAsset(`../backend-go/bin/${handler}`),
        handler: handler,
      });
      api.addRoutes({
        path: handler === 'screencast' ? '/screencast' : `/sessions/{sessionId}/${handler}`,
        methods: [apigateway.HttpMethod.GET, apigateway.HttpMethod.POST],
        integration: new apigateway.HttpLambdaIntegration(`${handler}Integration`, fn),
      });
    });

    new events.Rule(this, 'ExecuteScriptRule', {
      eventPattern: { source: ['browser.automation'], detailType: ['ExecuteScript'] },
      targets: [new targets.EcsTask({ cluster, taskDefinition })],
    });
  }
}
```

│ ├── backend-go/ # Go Lambda handlers and ECS controller
│ │ ├── cmd/
│ │ │ ├── start-session/main.go
│ │ │ ├── act/main.go
│ │ │ ├── observe/main.go
│ │ │ ├── agent-execute/main.go
│ │ │ ├── resume-session/main.go
│ │ │ ├── stop-session/main.go
│ │ │ ├── pause-notification/main.go
│ │ │ ├── retrieve/main.go
│ │ │ ├── debug/main.go
│ │ │ ├── screencast/main.go
│ │ │ └── ecs-controller/main.go

```go
package main

import (
    "context"
    "github.com/aws/aws-lambda-go/lambda"
    "github.com/redis/go-redis/v9"
    "github.com/wallcrawler/util-go"
)

type RetrieveRequest struct {
    SessionID string `json:"sessionId"`
}

type RetrieveResponse struct {
    Success bool `json:"success"`
    Data    struct {
        ID        string `json:"id"`
        Status    string `json:"status"`
        ConnectUrl string `json:"connectUrl"`
    } `json:"data"`
}

func Handler(ctx context.Context, req RetrieveRequest) (RetrieveResponse, error) {
    redisClient := redis.NewClient(&redis.Options{Addr: "redis-endpoint"})
    state, err := redisClient.HGet(ctx, "session:"+req.SessionID, "state").Result()
    if err != nil || state == "" {
        return RetrieveResponse{Success: false}, err
    }
    cdpEndpoint, _ := redisClient.HGet(ctx, "session:"+req.SessionID, "cdpEndpoint").Result()

    return RetrieveResponse{
        Success: true,
        Data: struct {
            ID        string `json:"id"`
            Status    string `json:"status"`
            ConnectUrl string `json:"connectUrl"`
        }{
            ID:        req.SessionID,
            Status:    state,
            ConnectUrl: cdpEndpoint,
        },
    }, nil
}

func main() {
    lambda.Start(Handler)
}
```

```go
package main

import (
    "context"
    "github.com/aws/aws-lambda-go/lambda"
    "github.com/redis/go-redis/v9"
)

type DebugRequest struct {
    SessionID string `json:"sessionId"`
}

type DebugResponse struct {
    Success     bool   `json:"success"`
    DebuggerUrl string `json:"debuggerUrl"`
}

func Handler(ctx context.Context, req DebugRequest) (DebugResponse, error) {
    redisClient := redis.NewClient(&redis.Options{Addr: "redis-endpoint"})
    cdpEndpoint, err := redisClient.HGet(ctx, "session:"+req.SessionID, "cdpEndpoint").Result()
    if err != nil || cdpEndpoint == "" {
        return DebugResponse{Success: false}, err
    }

    return DebugResponse{
        Success:     true,
        DebuggerUrl: cdpEndpoint,
    }, nil
}

func main() {
    lambda.Start(Handler)
}
```

```go
package main

import (
    "context"
    "github.com/aws/aws-lambda-go/lambda"
    "github.com/redis/go-redis/v9"
    "github.com/aws/aws-sdk-go-v2/service/eventbridge"
    "github.com/wallcrawler/util-go"
)

type ActRequest struct {
    SessionID string `json:"sessionId"`
    Action    string `json:"action"`
    Selector  string `json:"selector,omitempty"`
}

type ActResponse struct {
    Success bool   `json:"success"`
    Message string `json:"message"`
}

func Handler(ctx context.Context, req ActRequest) (ActResponse, error) {
    redisClient := redis.NewClient(&redis.Options{Addr: "redis-endpoint"})
    sessionState, err := redisClient.HGet(ctx, "session:"+req.SessionID, "state").Result()
    if err != nil || sessionState == "" {
        return ActResponse{Success: false, Message: "Invalid session"}, err
    }

    script := req.Selector != "" ? req.Action+":"+req.Selector : req.Action
    if !util.ValidateScript(script) {
        return ActResponse{Success: false, Message: "Invalid script"}, nil
    }

    util.StoreScript(redisClient, req.SessionID, script)
    ebClient := eventbridge.NewFromConfig(awsConfig)
    _, err = ebClient.PutEvents(ctx, &eventbridge.PutEventsInput{
        Entries: []eventbridge.PutEventsRequestEntry{
            {
                Source:       aws.String("browser.automation"),
                DetailType:   aws.String("ExecuteScript"),
                Detail:       aws.String(`{"sessionId":"`+req.SessionID+`","script":"`+script+`"}`),
                EventBusName: aws.String("default"),
            },
        },
    })
    if err != nil {
        return ActResponse{Success: false, Message: "Failed to trigger script"}, err
    }

    return ActResponse{Success: true, Message: "Action triggered"}, nil
}

func main() {
    lambda.Start(Handler)
}
```

│ ├── client-nextjs/ # Demo Next.js app
│ │ ├── src/pages/index.tsx

```typescript
import { useEffect, useRef } from 'react';
import { Stagehand } from '@wallcrawler/stagehand';

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const stagehand = new Stagehand({
      env: 'WALLCRAWLER',
      apiKey: process.env.NEXT_PUBLIC_WALLCRAWLER_API_KEY,
      projectId: process.env.NEXT_PUBLIC_WALLCRAWLER_PROJECT_ID,
      modelName: 'openai/gpt-4.1-mini',
      modelClientOptions: { apiKey: process.env.NEXT_PUBLIC_MODEL_API_KEY },
    });

    const init = async () => {
      await stagehand.init();
      const page = stagehand.page;

      await page.act('Navigate to example.com and click the login button');

      const wsUrl = await stagehand.wallcrawler.getScreencastUrl();
      const ws = new WebSocket(wsUrl);
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'frame') {
          videoRef.current.src = `data:image/jpeg;base64,${data.data}`;
        }
      };

      return () => {
        ws.close();
        stagehand.close();
      };
    };

    init();
  }, []);

  return <video ref={videoRef} autoPlay />;
}
```

│ └── stagehand/ # Git submodule (forked Stagehand)
│ ├── src/
│ │ ├── Stagehand.ts
│ │ ├── getBrowser.ts

```typescript
import { Wallcrawler } from '@wallcrawler/wallcrawler-sdk';
import { LLMProvider } from './llm/LLMProvider';
import { StagehandLogger } from './logger';
import { StagehandPage } from './StagehandPage';
import { StagehandContext } from './StagehandContext';
import { LogLine, ActOptions, ObserveResult, StartSessionResult } from '@wallcrawler/util-ts';
import { StagehandNotInitializedError, StagehandError } from './types/stagehandErrors';

export class Stagehand {
  private stagehandPage!: StagehandPage;
  private stagehandContext!: StagehandContext;
  public wallcrawler: Wallcrawler;
  private sessionId?: string;
  public llmProvider: LLMProvider;
  public logger: (logLine: LogLine) => void;
  private stagehandLogger: StagehandLogger;
  public verbose: 0 | 1 | 2;
  public modelName: string;
  private modelClientOptions: any;
  public _env: 'LOCAL' | 'WALLCRAWLER';
  public browserbaseSessionID?: string; // For compatibility

  constructor({
    env = 'WALLCRAWLER',
    apiKey = process.env.WALLCRAWLER_API_KEY,
    projectId = process.env.WALLCRAWLER_PROJECT_ID,
    verbose = 0,
    llmProvider,
    modelName = 'openai/gpt-4.1-mini',
    modelClientOptions,
    logger,
    browserbaseSessionID,
  }: any = {}) {
    this.stagehandLogger = new StagehandLogger({ pretty: true, usePino: true }, logger);
    this.logger = (logLine: LogLine) => this.stagehandLogger.log(logLine);
    this.wallcrawler = new Wallcrawler({ apiKey, baseURL: process.env.WALLCRAWLER_BASE_URL });
    this.llmProvider = llmProvider || new LLMProvider(this.logger, false);
    this.verbose = verbose;
    this.modelName = modelName;
    this.modelClientOptions = modelClientOptions;
    this._env = env;
    this.browserbaseSessionID = browserbaseSessionID;

    if (this._env === 'WALLCRAWLER' && (!apiKey || !projectId)) {
      throw new StagehandError('WALLCRAWLER_API_KEY and WALLCRAWLER_PROJECT_ID are required');
    }
  }

  async init(): Promise<StartSessionResult> {
    if (this._env === 'WALLCRAWLER') {
      const result = await this.wallcrawler.sessions.create({
        projectId: process.env.WALLCRAWLER_PROJECT_ID!,
      });
      this.sessionId = result.id;
      this.browserbaseSessionID = result.id; // For compatibility
      this.stagehandContext = new StagehandContext({});
      this.stagehandPage = new StagehandPage(
        {},
        this,
        this.stagehandContext,
        this.llmProvider.getClient(this.modelName, this.modelClientOptions)
      );
      return {
        sessionId: result.id,
        debugUrl: result.connectUrl,
        sessionUrl: `https://api.yourdomain.com/sessions/${result.id}`,
      };
    }
    // LOCAL env handled by getBrowser
    const result = await getBrowser(this);
    this.sessionId = result.sessionId;
    this.browserbaseSessionID = result.sessionId;
    this.stagehandContext = await StagehandContext.init(result.context, this);
    this.stagehandPage = (await this.stagehandContext.getStagehandPages())[0];
    return result;
  }

  async close(): Promise<void> {
    if (this.sessionId && this._env === 'WALLCRAWLER') {
      await this.wallcrawler.sessions.request(`/sessions/${this.sessionId}/end`, { method: 'POST' });
    }
    if (this.stagehandContext) {
      await this.stagehandContext.close();
    }
  }

  get page() {
    if (!this.stagehandContext) {
      throw new StagehandNotInitializedError('page');
    }
    return this.stagehandPage;
  }

  async act(actionOrOptions: string | ActOptions | ObserveResult): Promise<any> {
    return this.wallcrawler.sessions
      .request(`/sessions/${this.sessionId}/act`, {
        method: 'POST',
        body: JSON.stringify(actionOrOptions),
      })
      .then((res) => res.json())
      .then((body) => body.data);
  }

  async observe(instructionOrOptions?: string | any): Promise<any> {
    return this.wallcrawler.sessions
      .request(`/sessions/${this.sessionId}/observe`, {
        method: 'POST',
        body: JSON.stringify(instructionOrOptions || {}),
      })
      .then((res) => res.json())
      .then((body) => body.data);
  }

  agent(options?: any): { execute: (instructionOrOptions: string | any) => Promise<any> } {
    return {
      execute: async (instructionOrOptions: string | any) => {
        const executeOptions =
          typeof instructionOrOptions === 'string' ? { instruction: instructionOrOptions } : instructionOrOptions;
        return this.wallcrawler.sessions
          .request(`/sessions/${this.sessionId}/agent-execute`, {
            method: 'POST',
            body: JSON.stringify({ agentConfig: options, executeOptions }),
          })
          .then((res) => res.json())
          .then((body) => body.data);
      },
    };
  }
}
```

```typescript
import { chromium } from 'playwright';
import { Wallcrawler } from '@wallcrawler/wallcrawler-sdk';
import { LogLine, SessionCreateParams } from '@wallcrawler/util-ts';
import { StagehandError } from './types/stagehandErrors';

async function getBrowser(stagehand: any): Promise<any> {
  const { apiKey, projectId, _env, headless, logger, browserbaseSessionID, browserbaseSessionCreateParams } = stagehand;

  if (_env === 'WALLCRAWLER') {
    if (!apiKey || !projectId) {
      throw new StagehandError('WALLCRAWLER_API_KEY and WALLCRAWLER_PROJECT_ID are required');
    }

    const wallcrawler = new Wallcrawler({ apiKey });

    let sessionId: string;
    let connectUrl: string;

    if (browserbaseSessionID) {
      const session = await wallcrawler.sessions.retrieve(browserbaseSessionID);
      if (session.status !== 'RUNNING') {
        throw new StagehandError(`Session ${browserbaseSessionID} is not running (status: ${session.status})`);
      }
      sessionId = browserbaseSessionID;
      connectUrl = session.connectUrl;
      logger({
        category: 'init',
        message: 'resuming existing wallcrawler session...',
        level: 1,
        auxiliary: { sessionId: { value: sessionId, type: 'string' } },
      });
    } else {
      logger({
        category: 'init',
        message: 'creating new wallcrawler session...',
        level: 1,
      });
      const session = await wallcrawler.sessions.create({
        projectId,
        ...browserbaseSessionCreateParams,
        userMetadata: { ...(browserbaseSessionCreateParams?.userMetadata || {}), stagehand: 'true' },
      });
      sessionId = session.id;
      connectUrl = session.connectUrl;
      logger({
        category: 'init',
        message: 'created new wallcrawler session',
        level: 1,
        auxiliary: { sessionId: { value: sessionId, type: 'string' } },
      });
    }

    const browser = await chromium.connectOverCDP(connectUrl);
    const { debuggerUrl } = await wallcrawler.sessions.debug(sessionId);

    logger({
      category: 'init',
      message: browserbaseSessionID ? 'wallcrawler session resumed' : 'wallcrawler session started',
      auxiliary: {
        sessionUrl: { value: `https://api.yourdomain.com/sessions/${sessionId}`, type: 'string' },
        debugUrl: { value: debuggerUrl, type: 'string' },
        sessionId: { value: sessionId, type: 'string' },
      },
    });

    const context = browser.contexts()[0];
    return {
      browser,
      context,
      debugUrl: debuggerUrl,
      sessionUrl: `https://api.yourdomain.com/sessions/${sessionId}`,
      sessionId,
      env: 'WALLCRAWLER',
    };
  }

  // LOCAL env (unchanged from original)
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  logger({
    category: 'init',
    message: 'local browser started successfully.',
  });
  return { browser, context, env: 'LOCAL' };
}
```

├── pnpm-workspace.yaml

```yaml
packages:
  - 'packages/*'
  - 'packages/stagehand'
```

├── .gitmodules

[submodule "packages/stagehand"]
path = packages/stagehand
url = git@github.com:your-org/stagehand-fork.git

└── README.md

```

#### Implementation Notes
- **Wallcrawler SDK**:
  - Mimics Browserbase’s API for compatibility with Stagehand’s `getBrowser`.
  - Uses `fetch` for HTTP requests to API Gateway; no external dependencies beyond `playwright` for CDP connections.
  - Handles session creation (`/start-session`), retrieval (`/retrieve`), and debugging (`/debug`).

- **Stagehand Integration**:
  - Replaced `Browserbase` with `Wallcrawler` in `getBrowser`.
  - `Stagehand` constructor supports `env: 'WALLCRAWLER'` and uses `Wallcrawler` SDK for session management.
  - `StagehandPage.getCDPClient` uses `wallcrawler.sessions.debug` to get the CDP endpoint.

- **Backend Enhancements**:
  - Added `RetrieveSessionLambda` and `DebugSessionLambda` to support `wallcrawler.sessions.retrieve` and `debug`.
  - `StartSessionLambda` stores `cdpEndpoint` in Redis (e.g., `ws://container-ip:9222`).

- **Deployment**:
  - Build `wallcrawler-sdk`: `pnpm --filter wallcrawler-sdk build`.
  - Build Go binaries: `pnpm --filter backend-go build`.
  - Deploy CDK: `pnpm --filter aws-cdk deploy`.
  - Update Stagehand submodule: `git submodule update --remote`.

This updated documentation and artifacts provide a complete Wallcrawler implementation, with the `wallcrawler-sdk` package replacing Browserbase, ensuring seamless integration with Stagehand and the AWS infrastructure. Let me know if you need further refinements or additional artifacts!
```
