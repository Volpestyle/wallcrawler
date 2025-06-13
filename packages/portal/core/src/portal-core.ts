import { EventEmitter } from 'eventemitter3';
import { BrowserViewer } from './browser-viewer';
import { CommandHandler } from './command-handler';
import { StreamProtocol } from './stream-protocol';
import { 
  PortalTransport,
  PortalTransportConfig,
  PortalAuthInfo 
} from 'wallcrawler/types/portal-transport';
import { 
  PortalSession,
  PortalBrowserState,
  PortalCommand,
  PortalEvent,
  PortalConfig,
  PortalCommandType,
  PortalStatus
} from 'wallcrawler/types/portal';

/**
 * Portal Core
 * 
 * Main orchestrator for the agent portal functionality. Coordinates between
 * the browser viewer, command handler, stream protocol, and transport layer.
 * Provides the high-level API for portal operations.
 */
export class PortalCore extends EventEmitter {
  private transport: PortalTransport | null = null;
  private browserViewer: BrowserViewer | null = null;
  private commandHandler: CommandHandler;
  private streamProtocol: StreamProtocol | null = null;
  private currentSession: PortalSession | null = null;
  private config: PortalConfig;
  private connectionInfo: any = null;

  constructor(config: Partial<PortalConfig> = {}) {
    super();
    
    this.config = {
      sessionTimeoutMs: config.sessionTimeoutMs || 30 * 60 * 1000, // 30 minutes
      maxInactivityMs: config.maxInactivityMs || 10 * 60 * 1000, // 10 minutes
      updateIntervalMs: config.updateIntervalMs || 1000, // 1 second
      screenshotQuality: config.screenshotQuality || 0.8,
      maxScreenshotSize: config.maxScreenshotSize || 1920 * 1080,
      enableVideoStream: config.enableVideoStream || false,
      videoFrameRate: config.videoFrameRate || 10,
      allowManualControl: config.allowManualControl || true,
      allowScriptInjection: config.allowScriptInjection || false,
      enableMetrics: config.enableMetrics || true,
      enableDOMStream: config.enableDOMStream || true,
      theme: config.theme || 'auto',
      language: config.language || 'en',
      requireAuthentication: config.requireAuthentication || true,
      allowedOrigins: config.allowedOrigins || ['*'],
      csrfToken: config.csrfToken
    };

    // Initialize command handler with appropriate permissions
    const permissions = this.getPermissionsFromConfig();
    this.commandHandler = new CommandHandler(permissions);
    
    this.setupCommandHandlerEvents();
  }

  /**
   * Initialize the portal with a transport
   */
  async initialize(transport: PortalTransport): Promise<void> {
    this.transport = transport;
    
    // Set up transport event handlers
    this.setupTransportEvents();
    
    this.emit('initialized');
  }

  /**
   * Connect to a portal session
   */
  async connect(sessionId: string, auth?: PortalAuthInfo): Promise<PortalSession> {
    if (!this.transport) {
      throw new Error('Portal not initialized with transport');
    }

    try {
      // Connect to transport
      this.connectionInfo = await this.transport.connect(sessionId, auth);
      
      // Get or create session
      let session = await this.transport.getSession(sessionId);
      if (!session) {
        session = await this.transport.createSession({
          sessionId,
          userId: auth?.credentials.userId,
          timeoutMs: this.config.sessionTimeoutMs,
          maxInactivityMs: this.config.maxInactivityMs,
          config: this.config
        });
      }
      
      this.currentSession = session;
      
      // Initialize stream protocol
      this.streamProtocol = new StreamProtocol(sessionId, {
        bufferSize: 100,
        enableCompression: true,
        enableEncryption: false
      });
      
      this.setupStreamProtocolEvents();
      
      this.emit('connected', session);
      return session;
      
    } catch (error) {
      this.emit('connectionError', error);
      throw error;
    }
  }

  /**
   * Disconnect from the current session
   */
  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.transport.disconnect();
    }
    
    if (this.streamProtocol) {
      this.streamProtocol.destroy();
      this.streamProtocol = null;
    }
    
    if (this.browserViewer) {
      this.browserViewer.destroy();
      this.browserViewer = null;
    }
    
    this.currentSession = null;
    this.connectionInfo = null;
    
    this.emit('disconnected');
  }

  /**
   * Attach browser viewer to a DOM container
   */
  attachViewer(container: HTMLElement): BrowserViewer {
    if (this.browserViewer) {
      this.browserViewer.destroy();
    }
    
    this.browserViewer = new BrowserViewer(container);
    this.setupBrowserViewerEvents();
    
    this.emit('viewerAttached', this.browserViewer);
    return this.browserViewer;
  }

  /**
   * Detach browser viewer
   */
  detachViewer(): void {
    if (this.browserViewer) {
      this.browserViewer.destroy();
      this.browserViewer = null;
      this.emit('viewerDetached');
    }
  }

  /**
   * Send a command to the automation system
   */
  async sendCommand(type: PortalCommandType, payload?: Record<string, any>): Promise<void> {
    if (!this.currentSession) {
      throw new Error('Not connected to a session');
    }
    
    const command = this.commandHandler.createCommand(type, payload);
    await this.commandHandler.processCommand(command);
  }

  /**
   * Update browser state (called by automation system)
   */
  updateBrowserState(state: PortalBrowserState): void {
    if (this.browserViewer) {
      this.browserViewer.updateState(state);
    }
    
    if (this.commandHandler) {
      this.commandHandler.updateState(state);
    }
    
    if (this.streamProtocol && this.transport) {
      const message = this.streamProtocol.sendBrowserState(state);
      const serialized = this.streamProtocol.serializeMessage(message);
      // Transport would send this message
    }
    
    this.emit('browserStateUpdated', state);
  }

  /**
   * Send an event to connected portals
   */
  sendEvent(event: PortalEvent): void {
    if (this.streamProtocol && this.transport) {
      const message = this.streamProtocol.sendEvent(event);
      const serialized = this.streamProtocol.serializeMessage(message);
      // Transport would send this message
    }
    
    this.emit('eventSent', event);
  }

  /**
   * Get current session info
   */
  getCurrentSession(): PortalSession | null {
    return this.currentSession;
  }

  /**
   * Get connection status
   */
  isConnected(): boolean {
    return this.transport?.isConnected() || false;
  }

  /**
   * Get portal configuration
   */
  getConfig(): PortalConfig {
    return { ...this.config };
  }

  /**
   * Update portal configuration
   */
  updateConfig(updates: Partial<PortalConfig>): void {
    this.config = { ...this.config, ...updates };
    this.emit('configUpdated', this.config);
  }

  /**
   * Get portal statistics
   */
  async getStatistics(): Promise<any> {
    if (!this.currentSession || !this.transport) {
      return null;
    }
    
    return this.transport.getStats(this.currentSession.sessionId);
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    await this.disconnect();
    
    if (this.commandHandler) {
      this.commandHandler.removeAllListeners();
    }
    
    this.removeAllListeners();
  }

  private setupTransportEvents(): void {
    if (!this.transport) return;
    
    this.transport.onCommand((command: PortalCommand) => {
      this.handleIncomingCommand(command);
    });
    
    this.transport.onConnectionChange((connected: boolean, info?: any) => {
      if (connected) {
        this.emit('transportConnected', info);
      } else {
        this.emit('transportDisconnected');
      }
    });
    
    this.transport.onError((error: Error) => {
      this.emit('transportError', error);
    });
  }

  private setupCommandHandlerEvents(): void {
    // Forward command handler events
    this.commandHandler.on('automationPauseRequested', (command) => {
      this.emit('automationPauseRequested', command);
    });
    
    this.commandHandler.on('automationResumeRequested', (command) => {
      this.emit('automationResumeRequested', command);
    });
    
    this.commandHandler.on('automationStopRequested', (command) => {
      this.emit('automationStopRequested', command);
    });
    
    this.commandHandler.on('manualControlRequested', (command) => {
      this.emit('manualControlRequested', command);
    });
    
    this.commandHandler.on('automationControlReturned', (command) => {
      this.emit('automationControlReturned', command);
    });
    
    this.commandHandler.on('actionRequested', (data) => {
      this.emit('actionRequested', data);
    });
    
    this.commandHandler.on('scriptInjectionRequested', (data) => {
      this.emit('scriptInjectionRequested', data);
    });
    
    this.commandHandler.on('screenshotRequested', (command) => {
      this.emit('screenshotRequested', command);
    });
    
    this.commandHandler.on('pageReloadRequested', (command) => {
      this.emit('pageReloadRequested', command);
    });
    
    this.commandHandler.on('navigationRequested', (data) => {
      this.emit('navigationRequested', data);
    });
    
    this.commandHandler.on('portalCloseRequested', (command) => {
      this.emit('portalCloseRequested', command);
    });
    
    this.commandHandler.on('commandError', (command, error) => {
      this.emit('commandError', command, error);
    });
  }

  private setupBrowserViewerEvents(): void {
    if (!this.browserViewer) return;
    
    this.browserViewer.on('elementSelected', (selector) => {
      this.emit('elementSelected', selector);
    });
    
    this.browserViewer.on('elementClicked', (element, coords) => {
      this.emit('elementClicked', element, coords);
    });
    
    this.browserViewer.on('backgroundClicked', (coords) => {
      this.emit('backgroundClicked', coords);
    });
    
    this.browserViewer.on('contextMenu', (coords, elements) => {
      this.emit('contextMenu', coords, elements);
    });
  }

  private setupStreamProtocolEvents(): void {
    if (!this.streamProtocol) return;
    
    this.streamProtocol.on('commandReceived', (command, message) => {
      this.handleIncomingCommand(command);
    });
    
    this.streamProtocol.on('eventReceived', (event, message) => {
      this.emit('eventReceived', event);
    });
    
    this.streamProtocol.on('messageError', (error, rawMessage) => {
      this.emit('protocolError', error, rawMessage);
    });
  }

  private async handleIncomingCommand(command: PortalCommand): Promise<void> {
    try {
      await this.commandHandler.processCommand(command);
    } catch (error) {
      this.emit('commandProcessingError', command, error);
    }
  }

  private getPermissionsFromConfig(): PortalCommandType[] {
    const permissions: PortalCommandType[] = [
      'pause',
      'resume',
      'screenshot',
      'close-portal'
    ];
    
    if (this.config.allowManualControl) {
      permissions.push('take-control', 'return-control', 'execute-action');
    }
    
    if (this.config.allowScriptInjection) {
      permissions.push('inject-script');
    }
    
    return permissions;
  }
}