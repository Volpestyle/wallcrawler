import { createLogger } from './logger';

const logger = createLogger('core');

export interface RetryOptions {
  maxAttempts: number;
  delay: number;
  backoff: number;
  shouldRetry?: (error: any) => boolean;
}

export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { maxAttempts, delay, backoff, shouldRetry = () => true } = options;
  
  let lastError: any;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      logger.debug('Retry attempt', { attempt, maxAttempts });
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxAttempts || !shouldRetry(error)) {
        logger.error('Retry failed', error, { attempt, maxAttempts });
        throw error;
      }
      
      const waitTime = delay * Math.pow(backoff, attempt - 1);
      logger.debug('Retrying after delay', { attempt, waitTime, error: error.message });
      
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  
  throw lastError;
}