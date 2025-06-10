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

export interface ErrorRecoveryStrategy {
  retryable: boolean;
  maxRetries: number;
  backoffMs: number;
  fallbackStrategy?: () => Promise<void>;
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
};