import { EventEmitter } from "eventemitter3";
import { 
  PortalSession,
  PortalBrowserState,
  PortalCommand,
  PortalEvent,
  PortalConfig,
  ActionInfo
} from "../types/portal";
import { 
  PortalTransport,
  CreateSessionConfig,
  PortalAuthInfo
} from "../types/portal-transport";
import { createLogger } from "../utils/logger";

const logger = createLogger("portal-manager");

/**
 * Portal Manager
 * 
 * Manages portal sessions for WallCrawler automation. Handles session lifecycle,
 * state synchronization, and intervention workflows. This is the main integration
 * point between WallCrawler automation and the portal system.
 */
export class PortalManager extends EventEmitter {
  private transport: PortalTransport | null = null;
  private currentSession: PortalSession | null = null;
  private config: PortalConfig;
  private isInitialized = false;
  private stateUpdateInterval: NodeJS.Timeout | null = null;
  private sessionTimeoutTimer: NodeJS.Timeout | null = null;
  private lastActivity = Date.now();
  private actionHistory: ActionInfo[] = [];
  private currentBrowserState: PortalBrowserState | null = null;

  constructor(config: Partial<PortalConfig> = {}) {
    super();
    
    this.config = {
      sessionTimeoutMs: config.sessionTimeoutMs || 30 * 60 * 1000, // 30 minutes
      maxInactivityMs: config.maxInactivityMs || 10 * 60 * 1000, // 10 minutes
      updateIntervalMs: config.updateIntervalMs || 2000, // 2 seconds
      screenshotQuality: config.screenshotQuality || 0.8,
      maxScreenshotSize: config.maxScreenshotSize || 1920 * 1080,
      enableVideoStream: config.enableVideoStream || false,
      videoFrameRate: config.videoFrameRate || 10,
      allowManualControl: config.allowManualControl !== false,
      allowScriptInjection: config.allowScriptInjection || false,
      enableMetrics: config.enableMetrics !== false,
      enableDOMStream: config.enableDOMStream !== false,
      theme: config.theme || 'auto',
      language: config.language || 'en',
      requireAuthentication: config.requireAuthentication !== false,
      allowedOrigins: config.allowedOrigins || ['*'],
      ...(config.csrfToken && { csrfToken: config.csrfToken })
    };
  }

  /**
   * Initialize the portal manager with a transport
   */
  async initialize(transport: PortalTransport): Promise<void> {
    if (this.isInitialized) {
      logger.warn("Portal manager already initialized");
      return;
    }

    this.transport = transport;
    this.setupTransportEvents();
    this.isInitialized = true;
    
    logger.info("Portal manager initialized");
    this.emit('initialized');
  }

  /**
   * Create a new portal session
   */
  async createSession(
    sessionId: string, 
    userId?: string
  ): Promise<PortalSession> {
    if (!this.isInitialized || !this.transport) {
      throw new Error("Portal manager not initialized");
    }

    try {
      const sessionConfig: CreateSessionConfig = {
        sessionId,
        ...(userId && { userId }),
        timeoutMs: this.config.sessionTimeoutMs,
        maxInactivityMs: this.config.maxInactivityMs,
        config: this.config,
        metadata: {
          createdBy: 'wallcrawler-automation',
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Node.js',
          timestamp: Date.now()
        }
      };

      this.currentSession = await this.transport.createSession(sessionConfig);
      this.lastActivity = Date.now();
      
      this.startSessionMonitoring();
      this.startStateUpdates();
      
      logger.info("Portal session created", { 
        sessionId: this.currentSession.sessionId,
        userId: this.currentSession.userId 
      });
      
      this.emit('sessionCreated', this.currentSession);
      return this.currentSession;
      
    } catch (error) {
      logger.error("Failed to create portal session", error);
      throw error;
    }
  }

  /**
   * Connect to an existing portal session
   */
  async connectToSession(sessionId: string, auth?: PortalAuthInfo): Promise<PortalSession> {
    if (!this.isInitialized || !this.transport) {
      throw new Error("Portal manager not initialized");
    }

    try {
      // Connect to transport
      await this.transport.connect(sessionId, auth);
      
      // Get existing session
      const session = await this.transport.getSession(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      this.currentSession = session;
      this.lastActivity = Date.now();
      
      this.startSessionMonitoring();
      this.startStateUpdates();
      
      logger.info("Connected to portal session", { sessionId });
      this.emit('sessionConnected', session);
      
      return session;
      
    } catch (error) {
      logger.error("Failed to connect to portal session", error);
      throw error;
    }
  }

  /**
   * Close the current portal session
   */
  async closeSession(): Promise<void> {
    if (!this.currentSession || !this.transport) {
      return;
    }

    try {
      const sessionId = this.currentSession.sessionId;
      
      // Stop monitoring and updates
      this.stopSessionMonitoring();
      this.stopStateUpdates();
      
      // Update session status
      await this.transport.updateSession(sessionId, {
        status: 'closed',
        lastActiveAt: Date.now()
      });
      
      // Close transport connection
      await this.transport.closeSession(sessionId);
      
      logger.info("Portal session closed", { sessionId });
      this.emit('sessionClosed', sessionId);
      
      this.currentSession = null;
      
    } catch (error) {
      logger.error("Error closing portal session", error);
    }
  }

  /**
   * Update browser state and stream to connected portals
   */
  async updateBrowserState(state: Partial<PortalBrowserState>): Promise<void> {
    if (!this.currentSession || !this.transport) {
      return;
    }

    try {
      // Create complete browser state
      const fullState: PortalBrowserState = {
        sessionId: this.currentSession.sessionId,
        timestamp: Date.now(),
        url: state.url || 'about:blank',
        title: state.title || 'Loading...',
        viewport: state.viewport || { width: 1280, height: 720 },
        automationStatus: state.automationStatus || 'running',
        actionHistory: this.actionHistory,
        ...state
      };

      this.currentBrowserState = fullState;
      
      // Send to transport
      await this.transport.sendBrowserState(fullState);
      
      // Update last activity
      this.updateActivity();
      
      this.emit('browserStateUpdated', fullState);
      
    } catch (error) {
      logger.error("Failed to update browser state", error);
    }
  }

  /**
   * Record an action in the history
   */
  recordAction(action: Omit<ActionInfo, 'id' | 'timestamp'>): void {
    const fullAction: ActionInfo = {
      id: this.generateActionId(),
      timestamp: Date.now(),
      ...action
    };

    this.actionHistory.push(fullAction);
    
    // Keep only last 100 actions
    if (this.actionHistory.length > 100) {
      this.actionHistory = this.actionHistory.slice(-100);
    }

    logger.debug("Action recorded", fullAction);
    this.emit('actionRecorded', fullAction);
  }

  /**
   * Handle intervention requirement
   */
  async handleIntervention(
    type: string,
    description: string,
    context?: Record<string, any>
  ): Promise<string> {
    if (!this.currentSession || !this.transport) {
      throw new Error("No active portal session");
    }

    try {
      // Update session status to intervention
      await this.transport.updateSession(this.currentSession.sessionId, {
        status: 'intervention'
      });

      // Send intervention event
      const event: PortalEvent = {
        id: this.generateEventId(),
        type: 'intervention-required',
        timestamp: Date.now(),
        payload: {
          type,
          description,
          context: context || {},
          sessionId: this.currentSession.sessionId
        }
      };

      await this.transport.sendEvent(event);
      
      logger.info("Intervention requested", { 
        type, 
        description,
        sessionId: this.currentSession.sessionId 
      });
      
      this.emit('interventionRequested', { type, description, context });
      
      return event.id;
      
    } catch (error) {
      logger.error("Failed to handle intervention", error);
      throw error;
    }
  }

  /**
   * Wait for intervention completion
   */
  async waitForInterventionCompletion(_interventionId: string, timeoutMs?: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = timeoutMs || this.config.sessionTimeoutMs;
      let timeoutTimer: NodeJS.Timeout;

      const handleCompletion = (result: any) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        this.off('interventionCompleted', handleCompletion);
        resolve(result);
      };

      const handleTimeout = () => {
        this.off('interventionCompleted', handleCompletion);
        reject(new Error('Intervention timeout'));
      };

      this.on('interventionCompleted', handleCompletion);
      
      if (timeout > 0) {
        timeoutTimer = setTimeout(handleTimeout, timeout);
      }
    });
  }

  /**
   * Pause automation and enable manual control
   */
  async pauseAutomation(): Promise<void> {
    if (!this.currentSession || !this.transport) {
      return;
    }

    try {
      await this.transport.updateSession(this.currentSession.sessionId, {
        status: 'paused'
      });

      const event: PortalEvent = {
        id: this.generateEventId(),
        type: 'automation-paused',
        timestamp: Date.now(),
        payload: { sessionId: this.currentSession.sessionId }
      };

      await this.transport.sendEvent(event);
      
      logger.info("Automation paused", { sessionId: this.currentSession.sessionId });
      this.emit('automationPaused');
      
    } catch (error) {
      logger.error("Failed to pause automation", error);
    }
  }

  /**
   * Resume automation
   */
  async resumeAutomation(): Promise<void> {
    if (!this.currentSession || !this.transport) {
      return;
    }

    try {
      await this.transport.updateSession(this.currentSession.sessionId, {
        status: 'connected'
      });

      const event: PortalEvent = {
        id: this.generateEventId(),
        type: 'automation-resumed',
        timestamp: Date.now(),
        payload: { sessionId: this.currentSession.sessionId }
      };

      await this.transport.sendEvent(event);
      
      logger.info("Automation resumed", { sessionId: this.currentSession.sessionId });
      this.emit('automationResumed');
      
    } catch (error) {
      logger.error("Failed to resume automation", error);
    }
  }

  /**
   * Get current session info
   */
  getCurrentSession(): PortalSession | null {
    return this.currentSession;
  }

  /**
   * Get current browser state
   */
  getCurrentBrowserState(): PortalBrowserState | null {
    return this.currentBrowserState;
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
   * Check if portal is active
   */
  isActive(): boolean {
    return this.currentSession?.status === 'connected' || 
           this.currentSession?.status === 'paused';
  }

  /**
   * Get session statistics
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
    await this.closeSession();
    
    if (this.transport) {
      await this.transport.cleanup();
    }
    
    this.removeAllListeners();
    this.isInitialized = false;
    
    logger.info("Portal manager destroyed");
  }

  private setupTransportEvents(): void {
    if (!this.transport) return;

    this.transport.onCommand((command: PortalCommand) => {
      this.handleIncomingCommand(command);
    });

    this.transport.onConnectionChange((connected: boolean) => {
      if (connected) {
        this.emit('transportConnected');
      } else {
        this.emit('transportDisconnected');
        this.handleConnectionLoss();
      }
    });

    this.transport.onError((error: Error) => {
      logger.error("Transport error", error);
      this.emit('transportError', error);
    });
  }

  private handleIncomingCommand(command: PortalCommand): void {
    this.updateActivity();
    
    logger.debug("Received command", { type: command.type, id: command.id });
    
    switch (command.type) {
      case 'pause':
        this.emit('pauseRequested', command);
        break;
      case 'resume':
        this.emit('resumeRequested', command);
        break;
      case 'stop':
        this.emit('stopRequested', command);
        break;
      case 'take-control':
        this.emit('manualControlRequested', command);
        break;
      case 'return-control':
        this.emit('automationControlRequested', command);
        break;
      case 'execute-action':
        this.emit('actionExecutionRequested', command);
        break;
      case 'screenshot':
        this.emit('screenshotRequested', command);
        break;
      case 'reload':
        this.emit('pageReloadRequested', command);
        break;
      case 'navigate':
        this.emit('navigationRequested', command);
        break;
      case 'close-portal':
        this.emit('portalCloseRequested', command);
        break;
      default:
        logger.warn("Unknown command type", { type: command.type });
    }
  }

  private handleConnectionLoss(): void {
    logger.warn("Portal connection lost");
    
    // Stop monitoring temporarily
    this.stopSessionMonitoring();
    this.stopStateUpdates();
    
    // Attempt reconnection logic could go here
    this.emit('connectionLost');
  }

  private startSessionMonitoring(): void {
    this.stopSessionMonitoring(); // Clear any existing timer
    
    this.sessionTimeoutTimer = setInterval(() => {
      this.checkSessionTimeout();
    }, 30000); // Check every 30 seconds
  }

  private stopSessionMonitoring(): void {
    if (this.sessionTimeoutTimer) {
      clearInterval(this.sessionTimeoutTimer);
      this.sessionTimeoutTimer = null;
    }
  }

  private startStateUpdates(): void {
    this.stopStateUpdates(); // Clear any existing interval
    
    if (this.config.updateIntervalMs > 0) {
      this.stateUpdateInterval = setInterval(() => {
        this.sendPeriodicUpdate();
      }, this.config.updateIntervalMs);
    }
  }

  private stopStateUpdates(): void {
    if (this.stateUpdateInterval) {
      clearInterval(this.stateUpdateInterval);
      this.stateUpdateInterval = null;
    }
  }

  private checkSessionTimeout(): void {
    if (!this.currentSession) return;
    
    const now = Date.now();
    const sessionAge = now - this.currentSession.createdAt;
    const inactivityTime = now - this.lastActivity;
    
    if (sessionAge > this.config.sessionTimeoutMs) {
      logger.warn("Session timeout exceeded", { sessionId: this.currentSession.sessionId });
      this.handleSessionTimeout();
    } else if (inactivityTime > this.config.maxInactivityMs) {
      logger.warn("Session inactivity timeout", { sessionId: this.currentSession.sessionId });
      this.handleSessionTimeout();
    }
  }

  private async handleSessionTimeout(): Promise<void> {
    if (!this.currentSession || !this.transport) return;
    
    try {
      await this.transport.updateSession(this.currentSession.sessionId, {
        status: 'expired'
      });
      
      this.emit('sessionTimeout', this.currentSession.sessionId);
      await this.closeSession();
      
    } catch (error) {
      logger.error("Error handling session timeout", error);
    }
  }

  private async sendPeriodicUpdate(): Promise<void> {
    if (this.currentBrowserState) {
      // Update timestamp for heartbeat
      const state = {
        ...this.currentBrowserState,
        timestamp: Date.now()
      };
      
      try {
        if (this.transport) {
          await this.transport.sendBrowserState(state);
        }
      } catch (error) {
        logger.error("Failed to send periodic update", error);
      }
    }
  }

  private updateActivity(): void {
    this.lastActivity = Date.now();
    
    if (this.currentSession && this.transport) {
      // Update session activity asynchronously
      this.transport.updateSession(this.currentSession.sessionId, {
        lastActiveAt: this.lastActivity
      }).catch(error => {
        logger.error("Failed to update session activity", error);
      });
    }
  }

  private generateActionId(): string {
    return `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateEventId(): string {
    return `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}