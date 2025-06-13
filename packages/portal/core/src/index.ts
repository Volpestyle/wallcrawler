// Core portal components
export { BrowserViewer } from './browser-viewer';
export { CommandHandler } from './command-handler';
export { StreamProtocol } from './stream-protocol';
export { PortalCore } from './portal-core';

// Re-export types from core package
export type {
  PortalSession,
  PortalBrowserState,
  PortalCommand,
  PortalEvent,
  PortalConfig,
  PortalConnectionInfo,
  PortalStats,
  PortalStatus,
  AutomationStatus,
  ActionInfo,
  InteractiveElement,
  PortalCommandType,
  PortalEventType
} from 'wallcrawler/types/portal';

export type {
  PortalTransport,
  PortalTransportConfig,
  PortalAuthConfig,
  PortalAuthInfo,
  CreateSessionConfig,
  PortalTransportCapabilities,
  PortalTransportFactory,
  PortalMessage,
  PortalMessageType,
  PortalTransportError,
  PortalTransportErrorCode
} from 'wallcrawler/types/portal-transport';