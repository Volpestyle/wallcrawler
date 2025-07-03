/**
 * @wallcrawler/infra/common
 *
 * Common types, interfaces, and utilities for browser automation infrastructure providers.
 * This package provides shared functionality that can be used across AWS, Local, and other
 * infrastructure providers for browser automation tasks.
 */

// Export all types
export * from './types';

// Export all interfaces
export * from './interfaces';

// Export all utilities
export * from './utils';

// Re-export commonly used types for convenience
export type {
  // Core automation types
  AutomationTaskConfig,
  TaskInfo,
  ContainerResponse,
  HealthStatus,
  TaskStatus,

  // Session types
  BrowserSession,
  SessionConfig,
  ConnectionInfo,
  ConnectionType,

  // Event types
  AutomationEvent,
  EventCallback,
} from './types';

export type {
  // Interface types
  IBrowserAutomationProvider,
  ISessionStateManager,
} from './interfaces';
