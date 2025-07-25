To enable an AI agent (e.g., a model like Claude, GPT-4, or a custom xAI model) to build out the Wallcrawler monorepo incrementally, we need a series of structured prompts that break down the development process into manageable, logical steps. Each prompt should provide clear context, reference the relevant parts of the documentation, specify the task, and include success criteria. The prompts will guide the agent to create the monorepo structure, implement shared utilities, develop the `wallcrawler-sdk`, `components`, `stagehand`, `aws-cdk`, `backend-go`, and `client-nextjs` packages, and set up deployment scripts. The agent should follow the serverless architecture, use the provided Mermaid diagrams for reference, and ensure compatibility with Stagehand’s LLM-driven automation.

Below, I’ll craft a series of prompts designed for incremental development, assuming the agent has access to the full documentation (including file structure, Mermaid diagrams, and code examples). Each prompt is self-contained but references prior steps for context, allowing the agent to build dependencies sequentially. The prompts are ordered to minimize blockers (e.g., shared utilities first, then SDK, then application packages). I’ll also include notes on how the agent should validate each step.

---

## Prompt Series for Building the Wallcrawler Monorepo

### Prompt 1: Initialize the pnpm Monorepo and Set Up Git Submodule

**Context**: The Wallcrawler project is a serverless browser automation platform using AWS, with a pnpm monorepo structure. The `stagehand` package is a git submodule for a forked Stagehand library. The monorepo includes packages for shared utilities (`util-ts`, `util-go`), SDK (`wallcrawler-sdk`), UI components (`components`), infrastructure (`aws-cdk`), backend (`backend-go`), client app (`client-nextjs`), and Stagehand (`stagehand`). Refer to the consolidated file structure in the documentation.

**Task**: Initialize the pnpm monorepo, create the root directory structure, set up the `pnpm-workspace.yaml`, configure the git submodule for `stagehand`, and add a basic `README.md`. Ensure the monorepo is ready for package development.

**Instructions**:

1. Create a new directory `wallcrawler`.
2. Initialize a pnpm workspace with `pnpm init` and configure `pnpm-workspace.yaml` to include all packages and the `stagehand` submodule.
3. Set up the git repository with `git init` and add the `stagehand` submodule at `packages/stagehand` with URL `git@github.com:your-org/stagehand-fork.git`.
4. Create empty directories for packages: `util-ts`, `util-go`, `wallcrawler-sdk`, `components`, `aws-cdk`, `backend-go`, `client-nextjs`, `stagehand`.
5. Add a `README.md` with a project overview, setup instructions, and a placeholder for Mermaid diagrams (reference the documentation).
6. Create `.gitignore` to exclude `node_modules`, `dist`, and other build artifacts.

**Success Criteria**:

- `pnpm-workspace.yaml` correctly lists all packages (`packages/*`, `packages/stagehand`).
- Git submodule is initialized and points to the correct URL (verify with `git submodule status`).
- Directory structure matches the documentation.
- `README.md` includes sections for overview, setup, and diagrams.
- `git status` shows a clean repo with initial commit.

**Prompt**:

````plaintext
You are an AI agent tasked with building the Wallcrawler monorepo, a serverless browser automation platform. Refer to the provided documentation for the consolidated file structure, Mermaid diagrams, and code examples. This is Step 1: Initialize the pnpm monorepo and set up the git submodule for Stagehand.

**Task**: Initialize the pnpm monorepo in a directory named `wallcrawler`. Configure `pnpm-workspace.yaml` to include all packages and the `stagehand` submodule. Set up the git repository with the `stagehand` submodule at `packages/stagehand` using URL `git@github.com:your-org/stagehand-fork.git`. Create empty package directories (`util-ts`, `util-go`, `wallcrawler-sdk`, `components`, `aws-cdk`, `backend-go`, `client-nextjs`, `stagehand`). Add a `README.md` with project overview, setup instructions, and a placeholder for Mermaid diagrams. Create `.gitignore` to exclude build artifacts.

**Instructions**:
1. Run `mkdir wallcrawler && cd wallcrawler && pnpm init` to create the root directory and initialize pnpm.
2. Create `pnpm-workspace.yaml` with:
   ```yaml
   packages:
     - 'packages/*'
     - 'packages/stagehand'
````

3. Initialize git with `git init` and add the submodule: `git submodule add git@github.com:your-org/stagehand-fork.git packages/stagehand`.
4. Create empty directories: `mkdir -p packages/{util-ts,util-go,wallcrawler-sdk,components,aws-cdk,backend-go,client-nextjs,stagehand}`.
5. Create `README.md` with:
   - Project overview: "Wallcrawler is a serverless browser automation platform using AWS, integrating Stagehand for LLM-driven automation."
   - Setup instructions: Install pnpm, run `pnpm install`, clone submodule (`git submodule update --init`).
   - Placeholder for Mermaid diagrams (e.g., "Architecture and flows to be added").
6. Create `.gitignore` with:
   ```
   node_modules/
   dist/
   .DS_Store
   *.log
   ```
7. Commit changes with `git add . && git commit -m "Initialize Wallcrawler monorepo"`.

**Success Criteria**:

- Verify `pnpm-workspace.yaml` lists all packages.
- Check `git submodule status` shows `packages/stagehand` with correct URL.
- Confirm directory structure matches documentation.
- Ensure `README.md` has overview, setup, and diagram placeholder.
- Run `git status` to confirm clean repo with initial commit.

**Output**:

- List created files and directories.
- Show contents of `pnpm-workspace.yaml`, `.gitmodules`, `README.md`, `.gitignore`.
- Confirm git commit message and submodule status.

````

### Prompt 2: Implement Shared Utilities (`util-ts` and `util-go`)
**Context**: The `util-ts` package provides shared TypeScript types and functions (e.g., `SessionMetadata`, `parseLLMResponse`) used by `wallcrawler-sdk`, `components`, `stagehand`, and `client-nextjs`. The `util-go` package provides Go utilities (e.g., `ParseScript`, `StoreCdpEndpoint`) for `backend-go`. These are foundational for avoiding duplication.

**Task**: Create the `util-ts` and `util-go` packages with the specified files and implementations. Set up `package.json` for `util-ts` and `go.mod` for `util-go`.

**Instructions**:
1. For `util-ts`:
   - Create `packages/util-ts/src/types.ts` with interfaces: `SessionMetadata`, `ActOptions`, `ObserveResult`, `Session`, `SessionCreateParams`, `StreamData` (for BrowserViewer).
   - Create `packages/util-ts/src/utils.ts` with functions: `parseLLMResponse`, `validateScript`, `decodeStreamFrame`.
   - Create `packages/util-ts/package.json` with name `@wallcrawler/util-ts`, dependencies (`typescript`), and build scripts (`tsc`).
2. For `util-go`:
   - Create `packages/util-go/parse_script.go` with `ParseScript` function and `Action` struct.
   - Create `packages/util-go/redis_client.go` with `UpdateState`, `StoreScript`, `StoreCdpEndpoint`.
   - Create `packages/util-go/go.mod` with module `github.com/your-org/wallcrawler/util-go` and dependency `github.com/redis/go-redis/v9`.
3. Run `pnpm install` in `util-ts` to set up dependencies.
4. Commit changes with `git add packages/util-* && git commit -m "Add shared utilities for util-ts and util-go"`.

**Success Criteria**:
- `util-ts` builds with `pnpm --filter @wallcrawler/util-ts build` (no errors).
- `util-go` passes `go mod tidy` and `go build` in `packages/util-go`.
- Types and functions match documentation examples.
- `package.json` and `go.mod` are correctly configured.
- Git commit includes all files.

**Prompt**:
```plaintext
You are an AI agent building the Wallcrawler monorepo, following the provided documentation. This is Step 2: Implement shared utilities in `util-ts` and `util-go`.

**Context**: The `util-ts` package provides TypeScript types and functions used across `wallcrawler-sdk`, `components`, `stagehand`, and `client-nextjs`. The `util-go` package provides Go utilities for `backend-go`. Refer to the file structure and code examples in the documentation.

**Task**: Create `util-ts` and `util-go` packages with specified files and implementations. Set up `package.json` for `util-ts` and `go.mod` for `util-go`.

**Instructions**:
1. For `util-ts`:
   - Create `packages/util-ts/src/types.ts` with:
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
     export interface StreamData {
       type: 'frame' | 'pause' | 'error';
       data?: string;
       reason?: string;
     }
     ```
   - Create `packages/util-ts/src/utils.ts` with:
     ```typescript
     export function parseLLMResponse(response: string): string[] {
       return response.split(';').map(action => action.trim());
     }
     export function validateScript(script: string): boolean {
       const validActions = ['navigate', 'click', 'type', 'observe', 'pause'];
       return script.split(';').every(action => {
         const [type] = action.split(':');
         return validActions.includes(type);
       });
     }
     export function decodeStreamFrame(data: string): string {
       return data.startsWith('data:image/jpeg;base64,') ? data : `data:image/jpeg;base64,${data}`;
     }
     ```
   - Create `packages/util-ts/package.json` with:
     ```json
     {
       "name": "@wallcrawler/util-ts",
       "version": "1.0.0",
       "main": "dist/index.js",
       "types": "dist/index.d.ts",
       "scripts": {
         "build": "tsc"
       },
       "devDependencies": {
         "typescript": "^5.0.0"
       }
     }
     ```
2. For `util-go`:
   - Create `packages/util-go/parse_script.go` with:
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
   - Create `packages/util-go/redis_client.go` with:
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
   - Create `packages/util-go/go.mod` with:
     ```go
     module github.com/your-org/wallcrawler/util-go
     go 1.21
     require github.com/redis/go-redis/v9 v9.0.0
     ```
3. Run `pnpm install` in `packages/util-ts`.
4. Run `go mod tidy` in `packages/util-go`.
5. Commit changes with `git add packages/util-* && git commit -m "Add shared utilities for util-ts and util-go"`.

**Success Criteria**:
- `pnpm --filter @wallcrawler/util-ts build` succeeds.
- `cd packages/util-go && go mod tidy && go build` succeeds.
- Types/functions match documentation examples.
- `package.json` and `go.mod` are correct.
- Git commit includes all files.

**Output**:
- List created files (`types.ts`, `utils.ts`, `package.json`, `parse_script.go`, `redis_client.go`, `go.mod`).
- Show contents of each file.
- Confirm build and tidy success.
````

### Prompt 3: Implement `wallcrawler-sdk` Package

**Context**: The `wallcrawler-sdk` package is a TypeScript client SDK replacing Browserbase, interfacing with AWS API Gateway for session management and CDP connections. It’s a dependency for `stagehand` and `client-nextjs`, using `util-ts` types.

**Task**: Create the `wallcrawler-sdk` package with the specified files and implementations. Set up `package.json` with dependencies and build scripts.

**Instructions**:

1. Create `packages/wallcrawler-sdk/src/index.ts` with the `Wallcrawler` class (APIClient, sessions resource, auth headers).
2. Create `packages/wallcrawler-sdk/src/sessions.ts` with `Sessions` class and methods (`create`, `retrieve`, `debug`).
3. Create `packages/wallcrawler-sdk/src/core.ts` with `APIClient` and `APIResource` abstract classes.
4. Create `packages/wallcrawler-sdk/src/error.ts` with `WallcrawlerError`.
5. Create `packages/wallcrawler-sdk/package.json` with name `@wallcrawler/wallcrawler-sdk`, dependencies (`@wallcrawler/util-ts`), and build scripts (`tsc`).
6. Run `pnpm install` in `packages/wallcrawler-sdk`.
7. Commit changes with `git add packages/wallcrawler-sdk && git commit -m "Implement wallcrawler-sdk package"`.

**Success Criteria**:

- `pnpm --filter @wallcrawler/wallcrawler-sdk build` succeeds.
- SDK matches documentation examples for `Wallcrawler` and `Sessions`.
- `package.json` includes `@wallcrawler/util-ts`.
- SDK can make mock API calls (test with a stubbed fetch).
- Git commit includes all files.

**Prompt**:

````plaintext
You are an AI agent building the Wallcrawler monorepo, following the provided documentation. This is Step 3: Implement the `wallcrawler-sdk` package.

**Context**: The `wallcrawler-sdk` is a TypeScript client SDK replacing Browserbase, interfacing with AWS API Gateway for session management and CDP connections. It’s used by `stagehand` and `client-nextjs`, depending on `util-ts`. Refer to the file structure, code examples, and Mermaid diagrams (e.g., session init sequence).

**Task**: Create the `wallcrawler-sdk` package with specified files and implementations. Set up `package.json` with dependencies and build scripts.

**Instructions**:
1. Create `packages/wallcrawler-sdk/src/index.ts` with:
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
       super({ baseURL, timeout: opts.timeout ?? 60000, maxRetries: opts.maxRetries ?? 2 });
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
````

2. Create `packages/wallcrawler-sdk/src/sessions.ts` with:

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

3. Create `packages/wallcrawler-sdk/src/core.ts` with:

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

4. Create `packages/wallcrawler-sdk/src/error.ts` with:
   ```typescript
   export class WallcrawlerError extends Error {
     constructor(message: string) {
       super(message);
       this.name = 'WallcrawlerError';
     }
   }
   ```
5. Create `packages/wallcrawler-sdk/package.json` with:
   ```json
   {
     "name": "@wallcrawler/wallcrawler-sdk",
     "version": "1.0.0",
     "main": "dist/index.js",
     "types": "dist/index.d.ts",
     "scripts": {
       "build": "tsc"
     },
     "dependencies": {
       "@wallcrawler/util-ts": "^1.0.0"
     },
     "devDependencies": {
       "typescript": "^5.0.0"
     }
   }
   ```
6. Run `pnpm install` in `packages/wallcrawler-sdk`.
7. Commit changes with `git add packages/wallcrawler-sdk && git commit -m "Implement wallcrawler-sdk package"`.

**Success Criteria**:

- `pnpm --filter @wallcrawler/wallcrawler-sdk build` succeeds.
- SDK matches documentation examples.
- `package.json` includes `@wallcrawler/util-ts`.
- Mock API call (stubbed fetch) returns expected response structure.
- Git commit includes all files.

**Output**:

- List created files (`index.ts`, `sessions.ts`, `core.ts`, `error.ts`, `package.json`).
- Show contents of each file.
- Confirm build success.

````

### Prompt 4: Implement `components` Package
**Context**: The `components` package is a React library providing the `BrowserViewer` component for rendering screencast streams from Wallcrawler’s WebSocket endpoint. It depends on `wallcrawler-sdk` and `util-ts`, used by `client-nextjs`.

**Task**: Create the `components` package with `BrowserViewer` and set up `package.json`.

**Instructions**:
1. Create `packages/components/src/BrowserViewer.tsx` with the component, handling WebSocket connections, frame rendering, and reconnect logic.
2. Create `packages/components/src/index.ts` to export `BrowserViewer`.
3. Create `packages/components/package.json` with name `@wallcrawler/components`, dependencies (`react`, `@wallcrawler/wallcrawler-sdk`, `@wallcrawler/util-ts`), and build scripts (`tsc`).
4. Run `pnpm install` in `packages/components`.
5. Commit changes with `git add packages/components && git commit -m "Implement components package with BrowserViewer"`.

**Success Criteria**:
- `pnpm --filter @wallcrawler/components build` succeeds.
- `BrowserViewer` matches documentation example, renders frames in canvas.
- `package.json` includes correct dependencies.
- Mock WebSocket test renders sample frame (stubbed data).
- Git commit includes all files.

**Prompt**:
```plaintext
You are an AI agent building the Wallcrawler monorepo, following the provided documentation. This is Step 4: Implement the `components` package with `BrowserViewer`.

**Context**: The `components` package is a React library providing `BrowserViewer` to render screencast streams from Wallcrawler’s WebSocket endpoint. It depends on `wallcrawler-sdk` and `util-ts`, used by `client-nextjs`. Refer to the file structure, code examples, and Mermaid diagrams (e.g., pause/resume flow for WebSocket notifications).

**Task**: Create the `components` package with `BrowserViewer` and set up `package.json`.

**Instructions**:
1. Create `packages/components/src/BrowserViewer.tsx` with:
   ```typescript
   import React, { useEffect, useRef, useState } from 'react';
   import { Wallcrawler } from '@wallcrawler/wallcrawler-sdk';
   import { StreamData } from '@wallcrawler/util-ts';

   interface BrowserViewerProps {
     sessionId: string;
     apiKey?: string;
     onError?: (error: Error) => void;
     width?: number;
     height?: number;
     frameRate?: number;
   }

   const BrowserViewer: React.FC<BrowserViewerProps> = ({
     sessionId,
     apiKey,
     onError,
     width = 1280,
     height = 720,
     frameRate = 30,
   }) => {
     const canvasRef = useRef<HTMLCanvasElement>(null);
     const [loading, setLoading] = useState(true);
     const wallcrawler = new Wallcrawler({ apiKey });
     const lastFrameTime = useRef(0);

     useEffect(() => {
       const connect = async () => {
         try {
           const wsUrl = `wss://api.yourdomain.com/screencast/${sessionId}`;
           const ws = new WebSocket(wsUrl);

           ws.onopen = () => setLoading(false);
           ws.onmessage = (event) => {
             const now = performance.now();
             if (now - lastFrameTime.current < 1000 / frameRate) return;

             const data: StreamData = JSON.parse(event.data);
             if (data.type === 'frame') {
               const img = new Image();
               img.src = `data:image/jpeg;base64,${data.data}`;
               img.onload = () => {
                 const ctx = canvasRef.current?.getContext('2d');
                 if (ctx) {
                   ctx.drawImage(img, 0, 0, width, height);
                 }
                 lastFrameTime.current = now;
               };
             }
           };
           ws.onclose = () => {
             setLoading(true);
             setTimeout(connect, 1000);
           };
           ws.onerror = (err) => onError?.(new Error('WebSocket error'));

           return () => ws.close();
         } catch (err) {
           onError?.(err as Error);
         }
       };

       connect();
     }, [sessionId, apiKey, onError, frameRate, width, height]);

     return (
       <div>
         {loading && <p>Loading stream...</p>}
         <canvas ref={canvasRef} width={width} height={height} style={{ border: '1px solid black' }} />
       </div>
     );
   };

   export default BrowserViewer;
````

2. Create `packages/components/src/index.ts` with:
   ```typescript
   export { default as BrowserViewer } from './BrowserViewer';
   ```
3. Create `packages/components/package.json` with:
   ```json
   {
     "name": "@wallcrawler/components",
     "version": "1.0.0",
     "main": "dist/index.js",
     "types": "dist/index.d.ts",
     "scripts": {
       "build": "tsc"
     },
     "dependencies": {
       "react": "^18.2.0",
       "@wallcrawler/wallcrawler-sdk": "^1.0.0",
       "@wallcrawler/util-ts": "^1.0.0"
     },
     "devDependencies": {
       "typescript": "^5.0.0"
     }
   }
   ```
4. Run `pnpm install` in `packages/components`.
5. Commit changes with `git add packages/components && git commit -m "Implement components package with BrowserViewer"`.

**Success Criteria**:

- `pnpm --filter @wallcrawler/components build` succeeds.
- `BrowserViewer` renders frames in canvas (test with mock WebSocket data).
- `package.json` includes `react`, `wallcrawler-sdk`, `util-ts`.
- Mock test renders sample frame.
- Git commit includes all files.

**Output**:

- List created files (`BrowserViewer.tsx`, `index.ts`, `package.json`).
- Show contents of each file.
- Confirm build success.

````

### Prompt 5: Adapt `stagehand` Package
**Context**: The `stagehand` package is a git submodule containing a forked Stagehand library. It needs adaptations to use `wallcrawler-sdk` instead of Browserbase for session management and CDP connections, and integrate with `components` for stream rendering. Key files to adapt are `Stagehand.ts`, `getBrowser.ts`, and `StagehandPage.ts`.

**Task**: Adapt the `stagehand` package by modifying `Stagehand.ts`, `getBrowser.ts`, and `StagehandPage.ts` to use `wallcrawler-sdk`. Update `package.json` to depend on `wallcrawler-sdk` and `util-ts`.

**Instructions**:
1. Update `packages/stagehand/src/Stagehand.ts` to support `WALLCRAWLER` env, instantiate `Wallcrawler`, and proxy methods to SDK requests.
2. Update `packages/stagehand/src/getBrowser.ts` to use `Wallcrawler` for session creation/retrieval and CDP connections.
3. Update `packages/stagehand/src/StagehandPage.ts` to fetch CDP endpoints via Wallcrawler and proxy actions for remote env.
4. Update `packages/stagehand/package.json` to include dependencies: `@wallcrawler/wallcrawler-sdk`, `@wallcrawler/util-ts`.
5. Run `pnpm install` in `packages/stagehand`.
6. Commit changes with `git add packages/stagehand && git commit -m "Adapt stagehand package to use wallcrawler-sdk"`.

**Success Criteria**:
- `pnpm --filter stagehand build` succeeds (if Stagehand has build script).
- Adapted files match documentation examples.
- `package.json` includes `wallcrawler-sdk`, `util-ts`.
- Mock test of `Stagehand.init` creates session via Wallcrawler.
- Git commit includes modified files.

**Prompt**:
```plaintext
You are an AI agent building the Wallcrawler monorepo, following the provided documentation. This is Step 5: Adapt the `stagehand` package to use `wallcrawler-sdk`.

**Context**: The `stagehand` package is a git submodule with a forked Stagehand library. It needs adaptations to replace Browserbase with `wallcrawler-sdk` for session management and CDP connections, integrating with `components` for stream rendering. Key files are `Stagehand.ts`, `getBrowser.ts`, `StagehandPage.ts`. Refer to the file structure, code examples, and Mermaid diagrams (e.g., session init sequence).

**Task**: Adapt `stagehand` by modifying `Stagehand.ts`, `getBrowser.ts`, `StagehandPage.ts` to use `wallcrawler-sdk`. Update `package.json` to depend on `wallcrawler-sdk` and `util-ts`.

**Instructions**:
1. Update `packages/stagehand/src/Stagehand.ts` with:
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
         this.stagehandPage = new StagehandPage({}, this, this.stagehandContext, this.llmProvider.getClient(this.modelName, this.modelClientOptions));
         return { sessionId: result.id, debugUrl: result.connectUrl, sessionUrl: `https://api.yourdomain.com/sessions/${result.id}` };
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
       return this.wallcrawler.sessions.request(`/sessions/${this.sessionId}/act`, {
         method: 'POST',
         body: JSON.stringify(actionOrOptions),
       }).then(res => res.json()).then(body => body.data);
     }

     async observe(instructionOrOptions?: string | any): Promise<any> {
       return this.wallcrawler.sessions.request(`/sessions/${this.sessionId}/observe`, {
         method: 'POST',
         body: JSON.stringify(instructionOrOptions || {}),
       }).then(res => res.json()).then(body => body.data);
     }

     agent(options?: any): { execute: (instructionOrOptions: string | any) => Promise<any> } {
       return {
         execute: async (instructionOrOptions: string | any) => {
           const executeOptions = typeof instructionOrOptions === 'string' ? { instruction: instructionOrOptions } : instructionOrOptions;
           return this.wallcrawler.sessions.request(`/sessions/${this.sessionId}/agent-execute`, {
             method: 'POST',
             body: JSON.stringify({ agentConfig: options, executeOptions }),
           }).then(res => res.json()).then(body => body.data);
         },
       };
     }
   }
````

2. Update `packages/stagehand/src/getBrowser.ts` with:

   ```typescript
   import { chromium } from 'playwright';
   import { Wallcrawler } from '@wallcrawler/wallcrawler-sdk';
   import { LogLine } from '@wallcrawler/util-ts';
   import { StagehandError } from './types/stagehandErrors';

   async function getBrowser(stagehand: any): Promise<any> {
     const { apiKey, projectId, _env, headless, logger, browserbaseSessionID, browserbaseSessionCreateParams } =
       stagehand;

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
       await applyStealthScripts(context);
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
     await applyStealthScripts(context);
     return { browser, context, env: 'LOCAL' };
   }
   ```

3. Update `packages/stagehand/src/StagehandPage.ts` with:

   ```typescript
   import { CDPSession, Page as PlaywrightPage, Frame } from 'playwright';
   import { chromium } from 'playwright';
   import { Stagehand } from './Stagehand';
   import { StagehandContext } from './StagehandContext';
   import { LLMClient } from './llm/LLMClient';
   import { StagehandActHandler } from './handlers/actHandler';
   import { StagehandExtractHandler } from './handlers/extractHandler';
   import { StagehandObserveHandler } from './handlers/observeHandler';
   import {
     ActOptions,
     ActResult,
     ExtractOptions,
     ExtractResult,
     ObserveOptions,
     ObserveResult,
   } from '@wallcrawler/util-ts';
   import { StagehandNotInitializedError } from './types/stagehandErrors';

   export class StagehandPage {
     private stagehand: Stagehand;
     private rawPage: PlaywrightPage;
     private intPage: PlaywrightPage;
     private intContext: StagehandContext;
     private actHandler: StagehandActHandler;
     private extractHandler: StagehandExtractHandler;
     private observeHandler: StagehandObserveHandler;
     private llmClient: LLMClient;
     private cdpClients = new WeakMap<PlaywrightPage | Frame, CDPSession>();

     constructor(page: PlaywrightPage, stagehand: Stagehand, context: StagehandContext, llmClient: LLMClient) {
       this.stagehand = stagehand;
       this.rawPage = page;
       this.intContext = context;
       this.llmClient = llmClient;

       this.intPage = new Proxy(page, {
         get: (target, prop) => {
           if (prop === 'getCDPClient') {
             return this.getCDPClient.bind(this);
           }
           return target[prop as keyof PlaywrightPage];
         },
       });

       this.actHandler = new StagehandActHandler({
         logger: this.stagehand.logger,
         stagehandPage: this,
         selfHeal: this.stagehand.selfHeal,
       });
     }

     async getCDPClient(target: PlaywrightPage | Frame = this.rawPage): Promise<CDPSession> {
       const cached = this.cdpClients.get(target);
       if (cached) return cached;

       if (this.stagehand._env === 'WALLCRAWLER') {
         const session = await this.stagehand.wallcrawler.sessions.retrieve(this.stagehand.sessionId!);
         const browser = await chromium.connectOverCDP(session.connectUrl);
         const cdpSession = await browser.contexts()[0].newCDPSession(target);
         this.cdpClients.set(target, cdpSession);
         return cdpSession;
       }

       return this.intContext.newCDPSession(target);
     }

     async act(actionOrOptions: string | ActOptions | ObserveResult): Promise<ActResult> {
       if (this.stagehand._env === 'WALLCRAWLER') {
         return this.stagehand.wallcrawler.sessions
           .request(`/sessions/${this.stagehand.sessionId}/act`, {
             method: 'POST',
             body: JSON.stringify(actionOrOptions),
           })
           .then((res) => res.json())
           .then((body) => body.data);
       }
       return this.actHandler.actFromObserveResult(actionOrOptions as ObserveResult);
     }
   }
   ```

4. Update `packages/stagehand/package.json` to include:
   ```json
   {
     "name": "@wallcrawler/stagehand",
     "version": "1.0.0",
     "dependencies": {
       "@wallcrawler/wallcrawler-sdk": "^1.0.0",
       "@wallcrawler/util-ts": "^1.0.0"
     }
   }
   ```
5. Run `pnpm install` in `packages/stagehand`.
6. Commit changes with `git add packages/stagehand && git commit -m "Adapt stagehand package to use wallcrawler-sdk"`.

**Success Criteria**:

- `pnpm --filter stagehand build` succeeds (if applicable).
- Adapted files match documentation examples.
- `package.json` includes dependencies.
- Mock `Stagehand.init` creates session via Wallcrawler.
- Git commit includes modified files.

**Output**:

- List modified files (`Stagehand.ts`, `getBrowser.ts`, `StagehandPage.ts`, `package.json`).
- Show contents of each file.
- Confirm install success.

````

### Prompt 6: Implement `aws-cdk` Package
**Context**: The `aws-cdk` package defines the serverless AWS infrastructure using TypeScript CDK, including API Gateway, Lambda, ECS Fargate, Redis, and EventBridge. It uses `util-ts` for types.

**Task**: Create the `aws-cdk` package with the CDK stack and set up `package.json`.

**Instructions**:
1. Create `packages/aws-cdk/lib/wallcrawler-stack.ts` with the CDK stack defining all resources (reference documentation).
2. Create `packages/aws-cdk/bin/wallcrawler.ts` with the CDK app entry.
3. Create `packages/aws-cdk/package.json` with name `@wallcrawler/aws-cdk`, dependencies (`aws-cdk-lib`, `@wallcrawler/util-ts`), and scripts (`cdk synth`).
4. Run `pnpm install` in `packages/aws-cdk`.
5. Commit changes with `git add packages/aws-cdk && git commit -m "Implement aws-cdk package"`.

**Success Criteria**:
- `pnpm --filter @wallcrawler/aws-cdk cdk synth` generates valid CloudFormation template.
- Stack matches documentation example (e.g., API routes, Lambda handlers).
- `package.json` includes `aws-cdk-lib`.
- Git commit includes all files.

**Prompt**:
```plaintext
You are an AI agent building the Wallcrawler monorepo, following the provided documentation. This is Step 6: Implement the `aws-cdk` package.

**Context**: The `aws-cdk` package defines the serverless AWS infrastructure using TypeScript CDK, including API Gateway, Lambda, ECS Fargate, Redis, and EventBridge. It depends on `util-ts`. Refer to the file structure, code examples, and Mermaid architecture diagram.

**Task**: Create the `aws-cdk` package with the CDK stack and set up `package.json`.

**Instructions**:
1. Create `packages/aws-cdk/lib/wallcrawler-stack.ts` with:
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

       const handlers = ['start-session', 'act', 'observe', 'agent-execute', 'resume-session', 'stop-session', 'retrieve', 'debug', 'screencast'];
       handlers.forEach(handler => {
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
````

2. Create `packages/aws-cdk/bin/wallcrawler.ts` with:

   ```typescript
   #!/usr/bin/env node
   import 'source-map-support/register';
   import * as cdk from 'aws-cdk-lib';
   import { WallcrawlerStack } from '../lib/wallcrawler-stack';

   const app = new cdk.App();
   new WallcrawlerStack(app, 'WallcrawlerStack', {});
   ```

3. Create `packages/aws-cdk/package.json` with:
   ```json
   {
     "name": "@wallcrawler/aws-cdk",
     "version": "1.0.0",
     "scripts": {
       "cdk": "cdk"
     },
     "dependencies": {
       "aws-cdk-lib": "^2.0.0",
       "@wallcrawler/util-ts": "^1.0.0"
     },
     "devDependencies": {
       "typescript": "^5.0.0"
     }
   }
   ```
4. Run `pnpm install` in `packages/aws-cdk`.
5. Commit changes with `git add packages/aws-cdk && git commit -m "Implement aws-cdk package"`.

**Success Criteria**:

- `pnpm --filter @wallcrawler/aws-cdk cdk synth` generates valid template.
- Stack matches documentation example.
- `package.json` includes `aws-cdk-lib`.
- Git commit includes all files.

**Output**:

- List created files (`wallcrawler-stack.ts`, `wallcrawler.ts`, `package.json`).
- Show contents of each file.
- Confirm synth success.

````

### Prompt 7: Implement `backend-go` Package
**Context**: The `backend-go` package contains Go Lambda handlers and the ECS controller, implementing the serverless backend. It depends on `util-go` for shared utilities and uses AWS SDK, chromedp, and redis.

**Task**: Create the `backend-go` package with Lambda handlers (`start-session`, `act`, `observe`, `agent-execute`, `resume-session`, `stop-session`, `pause-notification`, `retrieve`, `debug`, `screencast`) and ECS controller. Include `Dockerfile` and `go.mod`.

**Instructions**:
1. Create `packages/backend-go/cmd/start-session/main.go` with `StartSessionLambda` (creates ECS task, stores session).
2. Create `packages/backend-go/cmd/act/main.go` with `ActLambda` (processes act requests).
3. Create similar handlers for `observe`, `agent-execute`, `resume-session`, `stop-session`, `pause-notification`, `retrieve`, `debug`, `screencast`.
4. Create `packages/backend-go/cmd/ecs-controller/main.go` with Go controller (parses scripts, executes via CDP).
5. Create `packages/backend-go/Dockerfile` for ECS image:
   ```dockerfile
   FROM golang:1.21
   RUN apt-get update && apt-get install -y google-chrome-stable
   WORKDIR /app
   COPY . .
   RUN go build -o controller cmd/ecs-controller/main.go
   CMD ["./controller"]
````

6. Create `packages/backend-go/go.mod` with dependencies (`github.com/your-org/wallcrawler/util-go`, `github.com/chromedp/chromedp`, `github.com/redis/go-redis/v9`, `github.com/aws/aws-lambda-go`, `github.com/aws/aws-sdk-go-v2`).
7. Run `go mod tidy` in `packages/backend-go`.
8. Commit changes with `git add packages/backend-go && git commit -m "Implement backend-go package"`.

**Success Criteria**:

- `cd packages/backend-go && go mod tidy && go build ./cmd/...` succeeds.
- Handlers match documentation examples (e.g., `act/main.go`).
- `Dockerfile` builds image with Chrome and Go.
- `go.mod` includes correct dependencies.
- Git commit includes all files.

**Prompt**:

````plaintext
You are an AI agent building the Wallcrawler monorepo, following the provided documentation. This is Step 7: Implement the `backend-go` package.

**Context**: The `backend-go` package contains Go Lambda handlers and the ECS controller, implementing the serverless backend. It depends on `util-go` and uses AWS SDK, chromedp, and redis. Refer to the file structure, code examples, and Mermaid diagrams (e.g., act execution sequence).

**Task**: Create the `backend-go` package with Lambda handlers (`start-session`, `act`, `observe`, `agent-execute`, `resume-session`, `stop-session`, `pause-notification`, `retrieve`, `debug`, `screencast`) and ECS controller. Include `Dockerfile` and `go.mod`.

**Instructions**:
1. Create `packages/backend-go/cmd/act/main.go` with:
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
````

2. Create similar handlers for other endpoints (reference documentation examples).
3. Create `packages/backend-go/cmd/ecs-controller/main.go` with:
   ```go
   package main
   import (
       "context"
       "os"
       "github.com/chromedp/chromedp"
       "github.com/redis/go-redis/v9"
       "github.com/wallcrawler/util-go"
   )
   func main() {
       sessionID := os.Getenv("SESSION_ID")
       redisClient := redis.NewClient(&redis.Options{Addr: "redis-endpoint"})
       ctx, cancel := chromedp.NewRemoteAllocator(context.Background(), "ws://localhost:9222")
       defer cancel()
       ctx, cancel = chromedp.NewContext(ctx)
       defer cancel()
       go listenForEvents(sessionID, redisClient, ctx)
       script, _ := redisClient.HGet(context.Background(), "session:"+sessionID, "script").Result()
       if script != "" {
           executeScript(ctx, sessionID, script, redisClient)
       }
   }
   func listenForEvents(sessionID string, redisClient *redis.Client, ctx context.Context) {
       pubsub := redisClient.Subscribe(context.Background(), "events:"+sessionID)
       for msg := range pubsub.Channel() {
           var event struct {
               DetailType string `json:"detailType"`
               Detail     string `json:"detail"`
           }
           json.Unmarshal([]byte(msg.Payload), &event)
           if event.DetailType == "ExecuteScript" {
               var detail struct {
                   SessionID string `json:"sessionId"`
                   Script    string `json:"script"`
               }
               json.Unmarshal([]byte(event.Detail), &detail)
               executeScript(ctx, sessionID, detail.Script, redisClient)
           } else if event.DetailType == "ResumeSession" {
               var detail struct {
                   SessionID string `json:"sessionId"`
                   Input     string `json:"input"`
               }
               json.Unmarshal([]byte(event.Detail), &detail)
               resumeScript(ctx, sessionID, detail.Input, redisClient)
           }
       }
   }
   func executeScript(ctx context.Context, sessionID, script string, redisClient *redis.Client) {
       util.UpdateState(redisClient, sessionID, "running")
       actions := util.ParseScript(script)
       for _, action := range actions {
           switch action.Type {
           case "navigate":
               chromedp.Run(ctx, chromedp.Navigate(action.Value))
           case "click":
               chromedp.Run(ctx, chromedp.Click(action.Value, chromedp.ByQuery))
           case "type":
               chromedp.Run(ctx, chromedp.SendKeys(action.Value, action.Extra))
           case "observe":
               var results []string
               chromedp.Run(ctx, chromedp.Query(action.Value, chromedp.ByQuery, &results))
               redisClient.HSet(ctx, "session:"+sessionID, "results", results)
           case "pause":
               util.UpdateState(redisClient, sessionID, "paused")
               redisClient.Publish(ctx, "events:"+sessionID, `{"detailType":"PauseNotification","detail":"{\"sessionId\":\"`+sessionID+`\",\"reason\":\"waiting for input\"}"}`)
               return
           }
       }
       util.UpdateState(redisClient, sessionID, "completed")
   }
   func resumeScript(ctx context.Context, sessionID, input string, redisClient *redis.Client) {
       util.UpdateState(redisClient, sessionID, "running")
       chromedp.Run(ctx, chromedp.SendKeys("input", input))
       script, _ := redisClient.HGet(ctx, "session:"+sessionID, "script").Result()
       executeScript(ctx, sessionID, script, redisClient)
   }
   ```
4. Create `packages/backend-go/Dockerfile` with:
   ```dockerfile
   FROM golang:1.21
   RUN apt-get update && apt-get install -y google-chrome-stable
   WORKDIR /app
   COPY . .
   RUN go build -o controller cmd/ecs-controller/main.go
   CMD ["./controller"]
   ```
5. Create `packages/backend-go/go.mod` with:
   ```go
   module github.com/your-org/wallcrawler/backend-go
   go 1.21
   require (
       github.com/your-org/wallcrawler/util-go v1.0.0
       github.com/chromedp/chromedp v0.8.0
       github.com/redis/go-redis/v9 v9.0.0
       github.com/aws/aws-lambda-go v1.34.0
       github.com/aws/aws-sdk-go-v2 v1.17.0
   )
   ```
6. Run `go mod tidy` in `packages/backend-go`.
7. Commit changes with `git add packages/backend-go && git commit -m "Implement backend-go package"`.

**Success Criteria**:

- `cd packages/backend-go && go mod tidy && go build ./cmd/...` succeeds.
- Handlers match documentation examples.
- `docker build -t wallcrawler-backend .` succeeds in `packages/backend-go`.
- `go.mod` includes dependencies.
- Git commit includes all files.

**Output**:

- List created files (`cmd/*/main.go`, `Dockerfile`, `go.mod`).
- Show contents of `act/main.go`, `ecs-controller/main.go`, `Dockerfile`, `go.mod`.
- Confirm build and tidy success.

````

### Prompt 8: Implement `client-nextjs` Package
**Context**: The `client-nextjs` package is a demo Next.js app using `stagehand`, `wallcrawler-sdk`, and `components` to initialize sessions, execute actions, and render streams with `BrowserViewer`.

**Task**: Create the `client-nextjs` package with a sample page integrating `BrowserViewer`.

**Instructions**:
1. Create `packages/client-nextjs/src/pages/index.tsx` with a page that initializes Stagehand, performs an `act`, and renders `BrowserViewer`.
2. Create `packages/client-nextjs/package.json` with name `@wallcrawler/client-nextjs`, dependencies (`next`, `react`, `@wallcrawler/stagehand`, `@wallcrawler/components`, `@wallcrawler/wallcrawler-sdk`, `@wallcrawler/util-ts`), and scripts (`next dev`, `next build`).
3. Run `pnpm install` in `packages/client-nextjs`.
4. Commit changes with `git add packages/client-nextjs && git commit -m "Implement client-nextjs package"`.

**Success Criteria**:
- `pnpm --filter @wallcrawler/client-nextjs build` succeeds.
- `pnpm --filter @wallcrawler/client-nextjs dev` starts Next.js app.
- Page matches documentation example, renders `BrowserViewer`.
- `package.json` includes dependencies.
- Git commit includes all files.

**Prompt**:
```plaintext
You are an AI agent building the Wallcrawler monorepo, following the provided documentation. This is Step 8: Implement the `client-nextjs` package.

**Context**: The `client-nextjs` package is a demo Next.js app using `stagehand`, `wallcrawler-sdk`, and `components` to initialize sessions, execute actions, and render streams with `BrowserViewer`. Refer to the file structure, code examples, and Mermaid diagrams (e.g., session init sequence).

**Task**: Create the `client-nextjs` package with a sample page integrating `BrowserViewer`.

**Instructions**:
1. Create `packages/client-nextjs/src/pages/index.tsx` with:
   ```typescript
   import BrowserViewer from '@wallcrawler/components/src/BrowserViewer';
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

         return () => stagehand.close();
       };

       init();
     }, []);

     return <BrowserViewer sessionId={stagehand.sessionId} onError={(err) => console.error(err)} />;
   }
````

2. Create `packages/client-nextjs/package.json` with:
   ```json
   {
     "name": "@wallcrawler/client-nextjs",
     "version": "1.0.0",
     "scripts": {
       "dev": "next dev",
       "build": "next build",
       "start": "next start"
     },
     "dependencies": {
       "next": "^13.0.0",
       "react": "^18.2.0",
       "@wallcrawler/stagehand": "^1.0.0",
       "@wallcrawler/components": "^1.0.0",
       "@wallcrawler/wallcrawler-sdk": "^1.0.0",
       "@wallcrawler/util-ts": "^1.0.0"
     },
     "devDependencies": {
       "typescript": "^5.0.0"
     }
   }
   ```
3. Run `pnpm install` in `packages/client-nextjs`.
4. Commit changes with `git add packages/client-nextjs && git commit -m "Implement client-nextjs package"`.

**Success Criteria**:

- `pnpm --filter @wallcrawler/client-nextjs build` succeeds.
- `pnpm --filter @wallcrawler/client-nextjs dev` starts app.
- Page renders `BrowserViewer` with mock session ID.
- `package.json` includes dependencies.
- Git commit includes all files.

**Output**:

- List created files (`index.tsx`, `package.json`).
- Show contents of each file.
- Confirm build and dev success.

````

### Prompt 9: Finalize and Test Monorepo
**Context**: The monorepo is now complete with all packages. Final steps include validating builds, running tests, and setting up deployment scripts.

**Task**: Validate all packages, add a root `package.json` with monorepo scripts, and create a deployment script for CDK.

**Instructions**:
1. Create root `package.json` with scripts for building/testing all packages:
   ```json
   {
     "name": "wallcrawler",
     "version": "1.0.0",
     "private": true,
     "scripts": {
       "build": "pnpm --recursive build",
       "test": "pnpm --recursive test",
       "deploy": "pnpm --filter @wallcrawler/aws-cdk cdk deploy"
     },
     "devDependencies": {
       "pnpm": "^8.0.0"
     }
   }
````

2. Run `pnpm --recursive build` to validate all packages.
3. Create `deploy.sh` in root with:
   ```bash
   #!/bin/bash
   pnpm build
   pnpm deploy
   ```
4. Run `chmod +x deploy.sh`.
5. Commit changes with `git add . && git commit -m "Finalize monorepo with root scripts and deployment"`.

**Success Criteria**:

- `pnpm build` succeeds for all packages.
- `pnpm deploy` synthesizes CDK stack (mock AWS credentials if needed).
- Root `package.json` includes scripts.
- `deploy.sh` is executable and runs without errors.
- Git commit includes all changes.

**Prompt**:

````plaintext
You are an AI agent building the Wallcrawler monorepo, following the provided documentation. This is Step 9: Finalize and test the monorepo.

**Context**: The monorepo is complete with `util-ts`, `util-go`, `wallcrawler-sdk`, `components`, `stagehand`, `aws-cdk`, `backend-go`, and `client-nextjs`. Finalize by validating builds, adding root scripts, and setting up deployment. Refer to the file structure and Mermaid diagrams.

**Task**: Validate all packages, add a root `package.json` with monorepo scripts, and create a deployment script for CDK.

**Instructions**:
1. Create root `package.json` with:
   ```json
   {
     "name": "wallcrawler",
     "version": "1.0.0",
     "private": true,
     "scripts": {
       "build": "pnpm --recursive build",
       "test": "pnpm --recursive test",
       "deploy": "pnpm --filter @wallcrawler/aws-cdk cdk deploy"
     },
     "devDependencies": {
       "pnpm": "^8.0.0"
     }
   }
````

2. Run `pnpm --recursive build` to validate all packages.
3. Create `deploy.sh` with:
   ```bash
   #!/bin/bash
   pnpm build
   pnpm deploy
   ```
4. Run `chmod +x deploy.sh`.
5. Commit changes with `git add . && git commit -m "Finalize monorepo with root scripts and deployment"`.

**Success Criteria**:

- `pnpm build` succeeds for all packages.
- `pnpm deploy` synthesizes CDK stack (mock AWS credentials if needed).
- Root `package.json` includes scripts.
- `deploy.sh` is executable and runs without errors.
- Git commit includes all changes.

**Output**:

- List created files (`package.json`, `deploy.sh`).
- Show contents of each file.
- Confirm build and deploy success.

```

---

## Notes for Agent Execution
- **Context Retention**: The agent must retain the full documentation as context for all prompts, referencing specific sections (e.g., file structure, code examples, Mermaid diagrams).
- **Incremental Approach**: Prompts are ordered to build dependencies first (e.g., `util-ts` before `wallcrawler-sdk`). The agent should execute prompts sequentially.
- **Validation**: Each prompt includes success criteria to ensure correctness (e.g., build success, mock tests). The agent should report validation results.
- **Error Handling**: If a step fails (e.g., build error), the agent should log the error, reference the documentation, and retry or suggest fixes.
- **Environment**: Assume a Node.js environment with pnpm, Go, Docker, and AWS CLI installed. Mock API endpoints for testing (e.g., stubbed fetch for Wallcrawler SDK).
- **Git Workflow**: Each prompt commits changes to maintain a clear history. The agent should use descriptive commit messages.

These prompts enable an AI agent to build the Wallcrawler monorepo incrementally, ensuring a robust, serverless browser automation platform. The agent can validate each step, integrate Stagehand, and deploy to AWS, aligning with the provided documentation. Let me know if you need additional prompts or refinements!
```
