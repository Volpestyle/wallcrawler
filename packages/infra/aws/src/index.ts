// Export core components
export { AWSNotificationProvider } from './intervention/notification-provider';
export { AWSInfrastructureProvider } from './providers/aws-infrastructure-provider';

// Export types
export * from './types/intervention';
export type { AWSProviderConfig } from './providers/aws-infrastructure-provider';

// Export Lambda handlers
export { handler as interventionHandler } from './lambda/intervention-handler';
export { handler as browserAutomationHandler } from './lambda/browser-automation-handler';
export {
  handleConnect as wsHandleConnect,
  handleDisconnect as wsHandleDisconnect,
  handleMessage as wsHandleMessage,
  sendBrowserState,
} from './intervention/websocket-handler';

// Export the main WallCrawler extension
export { WallCrawlerAWSProvider } from './wallcrawler-aws-extension';

// Export portal transport
export { AWSPortalTransport } from './portal-transport';
