export { LocalProvider, LocalProviderConfig } from './LocalProvider';

// Browser automation provider
export { 
  LocalBrowserAutomationProvider,
  type LocalBrowserAutomationConfig 
} from './LocalBrowserAutomationProvider';

// Session state management
export { 
  InMemorySessionStateManager,
  type InMemorySessionStateConfig 
} from './InMemorySessionStateManager';

// Process management utilities
export { 
  ProcessTaskManager,
  type ProcessTaskManagerConfig 
} from './utils/ProcessTaskManager';

// Re-export common interfaces for convenience
export {
  type IBrowserAutomationProvider,
  type ISessionStateManager,
  type AutomationTaskConfig,
  type TaskInfo,
  type BrowserSession,
  type BrowserSessionStatus,
  type SessionConfig,
  type ConnectionInfo,
  type ConnectionType,
  type AutomationEvent,
  type EventCallback,
  type TaskStatus,
  type ContainerResponse,
  type HealthStatus,
  type ContainerMethod,
  ContainerCommunicator,
  TaskMonitor,
  BaseEventPublisher,
} from '@wallcrawler/infra-common';
