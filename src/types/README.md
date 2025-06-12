# Error Handling in Wallcrawler

This document outlines Wallcrawler's error handling system, which is designed around the philosophy of **"Surface problems quickly, provide context, let users handle recovery"**.

## Design Philosophy

Wallcrawler's error handling follows these core principles:

1. **Fail-Fast**: Errors are thrown immediately when detected, not silently handled
2. **Rich Context**: Error messages include all relevant diagnostic information
3. **Clear Boundaries**: Different error types for different failure modes
4. **User Guidance**: Errors include actionable guidance when possible
5. **Minimal Auto-Retry**: Most errors are not automatically retried

## Error Hierarchy

### Base Error Class

```typescript
export class WallCrawlerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean = false,
    public readonly details?: any
  ) {
    super(message);
    this.name = 'WallCrawlerError';
  }
}
```

All Wallcrawler errors extend this base class, providing:
- **Structured error codes** for programmatic handling
- **Retryable flag** indicating if the operation could succeed on retry
- **Details object** for additional diagnostic information
- **Consistent naming** via the class name

## Error Categories

### 1. Configuration Errors

Errors related to setup, environment, and initialization.

```typescript
// Missing environment variables
export class MissingEnvironmentVariableError extends WallCrawlerError

// Invalid environment setup
export class WallCrawlerEnvironmentError extends WallCrawlerError

// Missing LLM configuration
export class MissingLLMConfigurationError extends WallCrawlerError

// Uninitialized access
export class WallCrawlerNotInitializedError extends WallCrawlerError
```

### 2. DOM Processing Errors

Errors related to accessibility tree processing and element interaction.

```typescript
// DOM processing failures
export class WallCrawlerDomProcessError extends WallCrawlerError

// Iframe handling issues
export class WallCrawlerIframeError extends WallCrawlerError

// Element resolution failures
export class ElementNotFoundError extends WallCrawlerError

// Frame content access issues
export class ContentFrameNotFoundError extends WallCrawlerError

// XPath resolution problems
export class XPathResolutionError extends WallCrawlerError
```

### 3. Runtime Errors

Errors during operation execution.

```typescript
// CDP communication failures
export class CDPError extends WallCrawlerError

// Operation timeouts
export class TimeoutError extends WallCrawlerError

// Input validation failures
export class ValidationError extends WallCrawlerError

// Playwright command failures
export class PlaywrightCommandException extends WallCrawlerError
```

### 4. LLM Integration Errors

Errors related to language model interactions.

```typescript
// LLM API failures
export class LLMError extends WallCrawlerError

// Response parsing failures
export class LLMResponseError extends WallCrawlerError

// Schema validation failures
export class ZodSchemaValidationError extends Error
```

## Error Handling Patterns

### 1. Immediate Failure

Most errors are thrown immediately upon detection:

```typescript
if (!result?.objectId) {
  throw new ElementNotFoundError(xpath);
}
```

### 2. Contextual Error Messages

Errors include all relevant context for debugging:

```typescript
throw new WallCrawlerIframeError(
  frameUrl, 
  `Unable to resolve frameId for iframe. Details: ${errorMessage}`
);
```

### 3. Graceful Degradation

Some operations continue with warnings when safe:

```typescript
try {
  const iframeTree = await getAccessibilityTree(frame);
  snapshots.push(iframeTree);
} catch (err) {
  logger.warn(`Failed to get accessibility tree for iframe ${frame.url()}`, err);
  // Continue processing other frames
}
```

### 4. Structured Logging

Errors are logged with structured data before throwing:

```typescript
logger.error("CDP command failed", {
  command: "Accessibility.getFullAXTree",
  error: err.message,
  details: err.stack
});
throw new CDPError(`Accessibility tree extraction failed: ${err.message}`);
```

## Error Recovery Strategies

Wallcrawler provides recovery strategies per error type:

```typescript
export const ErrorRecoveryStrategies: Record<string, ErrorRecoveryStrategy> = {
  CDP_ERROR: {
    retryable: true,
    maxRetries: 3,
    backoffMs: 1000,
  },
  TIMEOUT_ERROR: {
    retryable: true,
    maxRetries: 2,
    backoffMs: 5000,
  },
  LLM_ERROR: {
    retryable: true,
    maxRetries: 5,
    backoffMs: 60000, // 1 minute for rate limits
  },
  ELEMENT_NOT_FOUND: {
    retryable: true,
    maxRetries: 3,
    backoffMs: 2000,
  },
  VALIDATION_ERROR: {
    retryable: false,
    maxRetries: 0,
    backoffMs: 0,
  },
};
```

## Usage Guidelines

### When to Throw vs. Warn

**Throw Errors When:**
- Critical path operations fail (element not found for action)
- Configuration is invalid (missing API keys)
- Unrecoverable states occur (CDP disconnection)
- User input is invalid (malformed selectors)

**Log Warnings When:**
- Optional operations fail (some iframe processing)
- Performance issues occur (slow responses)
- Recoverable issues arise (fallback available)
- Deprecated features are used

### Error Handling Best Practices

1. **Catch Specific Error Types**: Handle different errors appropriately
```typescript
try {
  await page.act("click button");
} catch (error) {
  if (error instanceof ElementNotFoundError) {
    // Try alternative selector
    await page.act("click [data-testid='submit']");
  } else if (error instanceof TimeoutError) {
    // Wait longer and retry
    await page.waitForTimeout(5000);
    await page.act("click button");
  } else {
    throw error; // Re-throw unexpected errors
  }
}
```

2. **Use Error Details**: Extract diagnostic information
```typescript
catch (error) {
  if (error instanceof WallCrawlerError) {
    console.log(`Error code: ${error.code}`);
    console.log(`Retryable: ${error.retryable}`);
    console.log(`Details:`, error.details);
  }
}
```

3. **Implement Retry Logic**: Use provided recovery strategies
```typescript
const strategy = ErrorRecoveryStrategies[error.code];
if (strategy?.retryable && retryCount < strategy.maxRetries) {
  await new Promise(resolve => setTimeout(resolve, strategy.backoffMs));
  return await retryOperation();
}
```

## Error vs. Warning Decision Matrix

| Scenario | Action | Rationale |
|----------|--------|-----------|
| Element not found for user action | **Error** | Critical to user intent |
| Iframe accessibility tree fails | **Warning** | Other frames may succeed |
| Missing API key | **Error** | Cannot proceed without it |
| Slow LLM response | **Warning** | Still functional |
| Invalid XPath syntax | **Error** | User input issue |
| Memory usage high | **Warning** | Performance concern |
| CDP disconnection | **Error** | Cannot continue automation |
| Deprecated API usage | **Warning** | Still works but needs update |

## Integration with Logging

Wallcrawler's error system integrates with the structured logging framework:

```typescript
// Errors include logger context
logger.error("Operation failed", {
  operation: "dom.observe", 
  error: error.message,
  code: error.code,
  retryable: error.retryable,
  details: error.details
});
```

## Debugging Workflow

1. **Check Error Code**: Identify the error category
2. **Review Error Message**: Understand the specific failure
3. **Examine Details**: Look at diagnostic information
4. **Check Logs**: Review structured log entries
5. **Apply Recovery**: Use appropriate retry strategy if applicable

## Error Evolution

As Wallcrawler evolves, new error types should:

1. Extend the appropriate base class
2. Include relevant context in the message
3. Set appropriate retryable flag
4. Add to ErrorRecoveryStrategies if needed
5. Update this documentation

This approach ensures consistent, debuggable, and recoverable error handling throughout the Wallcrawler ecosystem.