# Stagehand Integration with Wallcrawler

This document explains the minimal adaptations made to the Stagehand library to make it compatible with Wallcrawler's remote browser infrastructure. Our approach prioritizes reusability and minimal changes, leveraging Stagehand's existing extensibility (e.g., provider configuration) while designing Wallcrawler's infra to natively support Stagehand's API contract. This ensures Stagehand can use Wallcrawler as a drop-in replacement for other providers like Browserbase, with little to no core modifications.

## Introduction

Stagehand is integrated into Wallcrawler primarily through its `StagehandAPI` class, which supports custom providers. By adding 'wallcrawler' as a provider, we route requests to Wallcrawler's endpoints using custom headers and base URL. For direct browser control (fallback mode), we use the Wallcrawler SDK for session management and CDP connections.

The goal was minimal invasiveness: No changes to Stagehand's core logic, LLM handling, or page methods (act, extract, observe). Instead, Wallcrawler's backend is built to match Stagehand's expected API responses and streaming format.

## Minimal Changes to Stagehand

The adaptations are confined to a few files, mainly adding the 'wallcrawler' provider and configuring it. Here's a breakdown:

### 1. Provider Configuration in `lib/api.ts`

Added 'wallcrawler' case in `getProviderConfig()` to use custom headers (x-wc-\*) and base URL.

```typescript
// lib/api.ts
private getProviderConfig(): ProviderConfig {
  switch (this.provider) {
    case "wallcrawler":
      return {
        headers: {
          apiKey: "x-wc-api-key",
          projectId: "x-wc-project-id",
          sessionId: "x-wc-session-id",
          streamResponse: "x-stream-response",
          modelApiKey: "x-model-api-key",
          sentAt: "x-sent-at",
          language: "x-language",
          sdkVersion: "x-sdk-version",
        },
        baseURL: process.env.WALLCRAWLER_API_URL ?? "https://api.wallcrawler.dev/v1",
      };
    // ... other providers
  }
}
```

### 2. Environment Handling in `lib/index.ts`

Added 'WALLCRAWLER' env support in constructor and `getBrowser()` for session creation via Wallcrawler SDK in direct mode.

```typescript
// lib/index.ts
this._env = env ?? 'WALLCRAWLER';

// In getBrowser():
if (env === 'WALLCRAWLER') {
  const wallcrawler = new Wallcrawler({ apiKey, baseURL: process.env.WALLCRAWLER_BASE_URL });
  // Use wallcrawler.sessions.create() or retrieve() to get connectUrl
  const browser = await chromium.connectOverCDP(connectUrl);
  // ...
}
```

### 3. API Client Instantiation

In `init()`, set provider based on env:

```typescript
this.apiClient = new StagehandAPI({
  // ...
  provider: this.env === 'WALLCRAWLER' ? 'wallcrawler' : 'browserbase',
});
```

These are the primary changes—under 50 lines total. No alterations to core methods like act() or extract().

## Reusability Approach

- **Provider-Based Extensibility**: Stagehand's design allows adding providers without core changes, promoting reusability. Wallcrawler fits as a new provider, and future backends can be added similarly.
- **Infra Compatibility**: Wallcrawler's API mirrors Stagehand's expectations (e.g., SSE streaming, success/data wrappers), so Stagehand treats it like any provider.
- **Hybrid Modes**: Supports API mode (remote LLM via HTTP) and direct mode (CDP via SDK), making it flexible for dev/prod.
- **Minimal Footprint**: Changes are isolated, ensuring Stagehand remains reusable across Browserbase, local, or other custom backends.

## Direct vs API Modes

- **API Mode** (default): StagehandAPI handles all ops via HTTP to Wallcrawler endpoints. Ideal for prod; offloads LLM inference.
- **Direct Mode** (fallback, env='WALLCRAWLER' with usingAPI=false): Uses SDK for session setup, then direct CDP for control. Useful for debugging or when API unavailable.

In both, session IDs are interchangeable, enabling hybrid workflows.

## Conclusion

This minimal, reusable integration lets Stagehand work seamlessly with Wallcrawler, requiring only provider config and env handling. For full details, see the updated design doc and API reference."
