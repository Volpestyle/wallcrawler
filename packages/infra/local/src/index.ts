/**
 * Local Browser Automation Provider
 * Simple local development alternative to AWS cloud infrastructure
 */

export { LocalProvider } from './LocalProvider';
export { LocalSessionStateManager } from './LocalSessionStateManager';

export type {
    LocalProviderConfig,
    ProviderSession,
    BrowserConnectionResult,
    Artifact,
    ArtifactList,
} from './LocalProvider';

// Re-export common types for convenience
export type {
    IBrowserProvider,
    IBrowserAutomationProvider,
    ISessionStateManager,
    BrowserSession,
    BrowserSessionStatus,
    AutomationTaskConfig,
    TaskInfo,
    ContainerResponse,
    HealthStatus,
    ScreencastOptions,
    InputEvent,
} from '@wallcrawler/infra-common'; 