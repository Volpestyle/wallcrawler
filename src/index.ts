// Main exports
export { WallCrawler } from './core/wallcrawler';
export { WallCrawlerPage } from './types/page';
export { WallCrawlerConfig, ModelProvider, defaultConfig } from './types/config';

// Handler types
export {
  ActOptions,
  ExtractOptions,
  ObserveResult,
  AgentOptions,
  AgentResult,
} from './types/handlers';

// Error types
export {
  WallCrawlerError,
  CDPError,
  LLMError,
  TimeoutError,
  ValidationError,
  ElementNotFoundError,
} from './types/errors';

// Logging types
export { WallCrawlerLogEntry, LogCategory } from './types/logging';

// Cache types
export { CacheEntry, CacheManager } from './types/cache';

// AWS types
export { SessionState, AutomationEvent, AutomationResult } from './types/aws';

// Zod re-export for schema definitions
export { z } from 'zod';