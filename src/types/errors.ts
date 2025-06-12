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

export class CDPError extends WallCrawlerError {
  constructor(message: string, details?: any) {
    super(message, 'CDP_ERROR', true, details);
    this.name = 'CDPError';
  }
}

export class LLMError extends WallCrawlerError {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly statusCode?: number,
    details?: any
  ) {
    super(message, 'LLM_ERROR', statusCode === 429, details);
    this.name = 'LLMError';
  }
}

export class TimeoutError extends WallCrawlerError {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly timeoutMs: number
  ) {
    super(message, 'TIMEOUT_ERROR', true);
    this.name = 'TimeoutError';
  }
}

export class ValidationError extends WallCrawlerError {
  constructor(message: string, details?: any) {
    super(message, 'VALIDATION_ERROR', false, details);
    this.name = 'ValidationError';
  }
}

export class ElementNotFoundError extends WallCrawlerError {
  constructor(
    public readonly selector: string,
    public readonly instruction?: string
  ) {
    super(
      `Element not found: ${selector}${instruction ? ` for instruction: ${instruction}` : ''}`,
      'ELEMENT_NOT_FOUND',
      true
    );
    this.name = 'ElementNotFoundError';
  }
}

// New error types from Stagehand
export class WallCrawlerNotInitializedError extends WallCrawlerError {
  constructor(methodName: string) {
    super(
      `WallCrawler method ${methodName} called before initialization. ` +
      `Ensure you await the init() method before using the page.`,
      'NOT_INITIALIZED',
      false
    );
    this.name = 'WallCrawlerNotInitializedError';
  }
}

export class HandlerNotInitializedError extends WallCrawlerError {
  constructor(handlerName: string) {
    super(
      `${handlerName} handler not initialized. This typically happens when ` +
      `LLM client is not configured.`,
      'HANDLER_NOT_INITIALIZED',
      false
    );
    this.name = 'HandlerNotInitializedError';
  }
}

export class PlaywrightCommandException extends WallCrawlerError {
  constructor(message: string) {
    super(`Playwright command failed: ${message}`, 'PLAYWRIGHT_COMMAND_ERROR', true);
    this.name = 'PlaywrightCommandException';
  }
}

export class PlaywrightCommandMethodNotSupportedException extends WallCrawlerError {
  constructor(method: string) {
    super(
      `Playwright method '${method}' is not supported`,
      'METHOD_NOT_SUPPORTED',
      false
    );
    this.name = 'PlaywrightCommandMethodNotSupportedException';
  }
}

export class WallCrawlerInvalidArgumentError extends WallCrawlerError {
  constructor(message: string) {
    super(message, 'INVALID_ARGUMENT', false);
    this.name = 'WallCrawlerInvalidArgumentError';
  }
}

export class WallCrawlerDefaultError extends WallCrawlerError {
  constructor(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    super(
      `\nHey! We're sorry you ran into an error. \nIf you need help, please open a Github issue or reach out to us.\n\nFull error:\n${message}`,
      'DEFAULT_ERROR', 
      false, 
      { originalError: error, stack }
    );
    this.name = 'WallCrawlerDefaultError';
  }
}

export class MissingLLMConfigurationError extends WallCrawlerError {
  constructor() {
    super(
      'LLM client not configured. Enhanced methods (act, extract, observe) ' +
      'require LLM configuration.',
      'MISSING_LLM_CONFIG',
      false
    );
    this.name = 'MissingLLMConfigurationError';
  }
}

export class WallCrawlerEnvironmentError extends WallCrawlerError {
  constructor(currentEnv: string, requiredEnv: string, feature: string) {
    super(
      `The ${feature} is only available in ${requiredEnv} environment. ` +
      `Current environment: ${currentEnv}`,
      'ENVIRONMENT_ERROR',
      false
    );
    this.name = 'WallCrawlerEnvironmentError';
  }
}

export class CaptchaTimeoutError extends WallCrawlerError {
  constructor() {
    super(
      'Captcha solving timed out. The captcha was not detected within the timeout period.',
      'CAPTCHA_TIMEOUT',
      true
    );
    this.name = 'CaptchaTimeoutError';
  }
}

export class BrowserbaseSessionNotFoundError extends WallCrawlerError {
  constructor() {
    super(
      'Browserbase session ID not found. This error occurs when trying to ' +
      'refresh the page in API mode without a valid session.',
      'BROWSERBASE_SESSION_NOT_FOUND',
      false
    );
    this.name = 'BrowserbaseSessionNotFoundError';
  }
}

export interface ErrorRecoveryStrategy {
  retryable: boolean;
  maxRetries: number;
  backoffMs: number;
  fallbackStrategy?: () => Promise<void>;
}

// Additional DOM processing errors matching Stagehand's approach
export class WallCrawlerDomProcessError extends WallCrawlerError {
  constructor(message: string) {
    super(`Error Processing DOM: ${message}`, 'DOM_PROCESS_ERROR', false);
    this.name = 'WallCrawlerDomProcessError';
  }
}

export class WallCrawlerIframeError extends WallCrawlerError {
  constructor(frameUrl: string, message: string) {
    super(
      `Unable to resolve frameId for iframe with URL: ${frameUrl}. Full error: ${message}`,
      'IFRAME_ERROR',
      true
    );
    this.name = 'WallCrawlerIframeError';
  }
}

export class ContentFrameNotFoundError extends WallCrawlerError {
  constructor(selector: string) {
    super(`Unable to obtain a content frame for selector: ${selector}`, 'CONTENT_FRAME_NOT_FOUND', true);
    this.name = 'ContentFrameNotFoundError';
  }
}

export class XPathResolutionError extends WallCrawlerError {
  constructor(xpath: string) {
    super(`XPath "${xpath}" does not resolve in the current page or frames`, 'XPATH_RESOLUTION_ERROR', true);
    this.name = 'XPathResolutionError';
  }
}

export class WallCrawlerClickError extends WallCrawlerError {
  constructor(message: string, selector: string) {
    super(
      `Error clicking element with selector: ${selector}. Reason: ${message}`,
      'CLICK_ERROR',
      true
    );
    this.name = 'WallCrawlerClickError';
  }
}

export class LLMResponseError extends WallCrawlerError {
  constructor(primitive: string, message: string) {
    super(`${primitive} LLM response error: ${message}`, 'LLM_RESPONSE_ERROR', true);
    this.name = 'LLMResponseError';
  }
}

export class ZodSchemaValidationError extends Error {
  constructor(
    public readonly received: unknown,
    public readonly issues: any,
  ) {
    super(`Zod schema validation failed

— Received —
${JSON.stringify(received, null, 2)}

— Issues —
${JSON.stringify(issues, null, 2)}`);
    this.name = "ZodSchemaValidationError";
  }
}

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
  PLAYWRIGHT_COMMAND_ERROR: {
    retryable: true,
    maxRetries: 2,
    backoffMs: 1000,
  },
  DOM_PROCESS_ERROR: {
    retryable: false,
    maxRetries: 0,
    backoffMs: 0,
  },
  IFRAME_ERROR: {
    retryable: true,
    maxRetries: 2,
    backoffMs: 1000,
  },
  CONTENT_FRAME_NOT_FOUND: {
    retryable: true,
    maxRetries: 2,
    backoffMs: 1000,
  },
  XPATH_RESOLUTION_ERROR: {
    retryable: true,
    maxRetries: 2,
    backoffMs: 1000,
  },
  CLICK_ERROR: {
    retryable: true,
    maxRetries: 3,
    backoffMs: 1000,
  },
  LLM_RESPONSE_ERROR: {
    retryable: true,
    maxRetries: 3,
    backoffMs: 2000,
  },
};