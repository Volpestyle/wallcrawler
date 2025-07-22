# Stagehand Documentation

## Overview

Stagehand is a fork of a browser automation library that enhances Playwright with AI-powered methods like act(), extract(), and observe(). It supports web agents, computer use models, and integrations with various frameworks.

## High-Level Data Flow

1. **Initialization**: Create Stagehand instance with config (provider, API keys, etc.). Call init() to set up browser context.
2. **Page Interaction**: Use stagehand.page (extends Playwright Page) for methods:
   - goto(url): Navigate to page.
   - act(instruction): Use LLM to plan and execute action (e.g., "click button").
   - observe(instruction): Plan action without executing, returns ObserveResult[].
   - extract(options): Extract structured data using schema.
3. **Agent Execution**: Create agent with config, call execute(instruction) for multi-step tasks.
4. **Cleanup**: Call cleanup() to close resources.

Flow: User → Stagehand → LLM (for planning) → Playwright → Browser → Results back to user.

## Low-Level Data Shapes

From types:

### ConstructorParams

```ts
interface ConstructorParams {
  provider?: BrowserProvider;
  env?: string;
  apiKey?: string;
  projectId?: string;
  verbose?: 0 | 1 | 2;
  llmProvider?: LLMProvider;
  logger?: (message: LogLine) => void | Promise<void>;
  domSettleTimeoutMs?: number;
  browserbaseSessionCreateParams?: Browserbase.Sessions.SessionCreateParams;
  enableCaching?: boolean;
  browserbaseSessionID?: string;
  modelName?: AvailableModel;
  llmClient?: LLMClient;
  modelClientOptions?: ClientOptions;
}
```

### ActOptions

```ts
type ActOptions = string | ObserveResult; // Instruction or planned action
```

### ExtractOptions<T>

```ts
interface ExtractOptions<T> {
  instruction: string;
  schema: z.ZodObject<any>;
}
```

### ObserveOptions

```ts
interface ObserveOptions {
  instruction: string;
  numResults?: number;
  domSettleTimeoutMs?: number;
}
```

### AgentConfig

```ts
interface AgentConfig {
  provider: 'openai' | 'anthropic';
  model: string;
  instructions?: string;
  options?: {
    apiKey: string;
  };
}
```

For full types, see packages/stagehand/types/.
