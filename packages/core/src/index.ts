// Main exports
export { WallCrawler } from './lib/wallcrawler';
export { WallCrawlerPage } from './types/page';
export { WallCrawlerConfig, ModelProvider } from './types/config';

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
export { WallCrawlerLogEntry } from './types/logging';

// Cache types
export { CacheEntry, CacheManager } from './types/cache';

// Infrastructure types - for infrastructure providers
export * from './types/infrastructure';

// Portal types
export * from './types/portal';
export * from './types/portal-transport';
export * from './types/portal-api';

// Core utilities - for infrastructure providers
export { createWallCrawlerPage } from './lib/wallcrawler-page';
export { DefaultCDPSessionManager } from './lib/cdp-session-manager';
export { LLMClientFactory } from './llm/client-factory';
export { createLogger } from './utils/logger';
export { PortalManager } from './lib/portal-manager';
export { DOM_UTILS_SCRIPT } from './dom/dom-utils';

// Zod re-export for schema definitions
export { z } from 'zod';
