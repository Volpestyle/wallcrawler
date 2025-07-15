/**
 * AWS Infrastructure Provider for WallCrawler
 * Main exports for AWS-based browser automation
 */

export { AwsProvider } from './AwsProvider';
export { StagehandAwsProvider } from './StagehandAwsProvider';
export { AwsSessionStateManager } from './AwsSessionStateManager';
export { AwsTaskManager } from './utils/AwsTaskManager';
export { S3ArtifactManager } from './utils/S3ArtifactManager';

// Export types
export * from './types';

// Re-export common interfaces for convenience
export {
  IBrowserAutomationProvider,
  ISessionStateManager,
  AutomationTaskConfig,
  TaskInfo,
  ContainerResponse,
  HealthStatus,
  BrowserSession,
  BrowserSessionStatus,
} from '@wallcrawler/infra-common';
