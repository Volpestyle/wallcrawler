# Browser Container Documentation

## Overview

Docker container running multi-session Chrome with Playwright. Claims sessions from Redis, provides isolated contexts, handles CDP commands.

## High-Level Data Flow

1. **Startup**: Connect to Redis, launch browser, start WS/HTTP servers.
2. **Session Claiming**: Poll Redis for pending sessions → Create isolated context → Notify ready.
3. **Command Handling**: Poll Redis for commands (ACT, EXTRACT) → Execute via StagehandExecutor → Store results.
4. **CDP Proxy**: Handle WS connections, forward CDP messages to sessions.
5. **Screencasting**: Optional frame streaming with optimization.

## Low-Level Data Shapes

### Session

```ts
interface Session {
  id: string;
  userId: string;
  context: BrowserContext;
  sandbox: SessionSandbox;
  pages: Map<string, Page>;
  cdpSessions: Map<string, CDPSession>;
  lastActivity: number;
  options: SessionOptions;
}
```

### InternalMessage

```ts
interface InternalMessage {
  type: 'CREATE_SESSION' | 'DESTROY_SESSION' | etc.;
  sessionId?: string;
  userId?: string;
  options?: SessionOptions;
  data?: any;
}
```
