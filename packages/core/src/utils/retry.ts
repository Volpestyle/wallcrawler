import { createLogger } from "./logger";

const logger = createLogger("core");

export interface RetryOptions {
  maxAttempts: number;
  delay: number;
  backoff: number;
  shouldRetry?: (error: unknown) => boolean;
}

export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { maxAttempts, delay, backoff, shouldRetry = () => true } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      logger.debug("Retry attempt", { attempt, maxAttempts });
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts || !shouldRetry(error)) {
        logger.error("Retry failed", error, { attempt, maxAttempts });
        throw error;
      }

      const waitTime = delay * Math.pow(backoff, attempt - 1);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.debug("Retrying after delay", {
        attempt,
        waitTime,
        error: errorMessage,
      });

      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }

  throw lastError;
}
