/**
 * Portal REST API Types
 * 
 * Defines REST API interfaces for controlling portal sessions from external applications.
 * This allows web apps and mobile apps to control automation without needing WebSocket connections.
 */

export interface PortalAPIClient {
  /**
   * Get session information
   */
  getSession(sessionId: string): Promise<PortalSessionInfo>;

  /**
   * Get current browser state
   */
  getBrowserState(sessionId: string): Promise<PortalBrowserStateAPI>;

  /**
   * Control automation
   */
  pauseAutomation(sessionId: string): Promise<PortalCommandResponse>;
  resumeAutomation(sessionId: string): Promise<PortalCommandResponse>;
  stopAutomation(sessionId: string): Promise<PortalCommandResponse>;

  /**
   * Manual control
   */
  takeControl(sessionId: string): Promise<PortalCommandResponse>;
  returnControl(sessionId: string): Promise<PortalCommandResponse>;
  executeAction(sessionId: string, action: PortalActionRequest): Promise<PortalCommandResponse>;

  /**
   * Portal operations
   */
  takeScreenshot(sessionId: string): Promise<PortalScreenshotResponse>;
  reloadPage(sessionId: string): Promise<PortalCommandResponse>;
  navigateTo(sessionId: string, url: string): Promise<PortalCommandResponse>;

  /**
   * Session management
   */
  createPortalSession(config: CreatePortalSessionRequest): Promise<PortalSessionInfo>;
  closePortalSession(sessionId: string): Promise<void>;

  /**
   * Portal embedding
   */
  getEmbedUrl(sessionId: string, options?: EmbedOptions): Promise<string>;
  getEmbedToken(sessionId: string, options?: EmbedTokenOptions): Promise<string>;
}

export interface PortalSessionInfo {
  sessionId: string;
  userId?: string;
  status: 'pending' | 'connected' | 'paused' | 'intervention' | 'expired' | 'closed';
  createdAt: number;
  lastActiveAt: number;
  expiresAt: number;
  automationStatus: 'running' | 'waiting' | 'paused' | 'error' | 'completed' | 'manual';
  currentUrl?: string;
  pageTitle?: string;
  canTakeControl: boolean;
  embedUrl?: string;
  portalUrl?: string;
}

export interface PortalBrowserStateAPI {
  sessionId: string;
  timestamp: number;
  url: string;
  title: string;
  viewport: { width: number; height: number };
  automationStatus: 'running' | 'waiting' | 'paused' | 'error' | 'completed' | 'manual';
  lastAction?: {
    description: string;
    success?: boolean;
    timestamp: number;
  };
  interventionRequired?: boolean;
  interventionReason?: string;
  screenshot?: string; // Base64 encoded
  interactiveElements?: Array<{
    selector: string;
    type: string;
    label?: string;
    bounds: { x: number; y: number; width: number; height: number };
  }>;
}

export interface PortalActionRequest {
  type: 'click' | 'type' | 'select' | 'scroll' | 'hover' | 'drag';
  selector: string;
  value?: any;
  options?: {
    timeout?: number;
    force?: boolean;
    waitForNavigation?: boolean;
  };
}

export interface PortalCommandResponse {
  success: boolean;
  commandId: string;
  timestamp: number;
  message?: string;
  error?: string;
  data?: any;
}

export interface PortalScreenshotResponse {
  success: boolean;
  timestamp: number;
  screenshot: string; // Base64 encoded PNG
  format: 'png' | 'jpeg';
  width: number;
  height: number;
  size: number; // File size in bytes
}

export interface CreatePortalSessionRequest {
  sessionId: string;
  userId?: string;
  timeoutMs?: number;
  config?: {
    allowManualControl?: boolean;
    allowScriptInjection?: boolean;
    enableMetrics?: boolean;
    theme?: 'light' | 'dark' | 'auto';
  };
  metadata?: Record<string, any>;
}

export interface EmbedOptions {
  width?: number | string;
  height?: number | string;
  theme?: 'light' | 'dark' | 'auto';
  showControls?: boolean;
  allowFullscreen?: boolean;
  autoResize?: boolean;
  initialView?: 'browser' | 'controls' | 'both';
}

export interface EmbedTokenOptions {
  expiresIn?: number; // Seconds
  permissions?: ('view' | 'control' | 'screenshot')[];
  origin?: string; // Allowed origin for iframe embedding
}

/**
 * Portal API Error Types
 */
export class PortalAPIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code: PortalAPIErrorCode,
    public details?: any
  ) {
    super(message);
    this.name = 'PortalAPIError';
  }
}

export type PortalAPIErrorCode =
  | 'SESSION_NOT_FOUND'
  | 'SESSION_EXPIRED'
  | 'PERMISSION_DENIED'
  | 'AUTOMATION_NOT_RUNNING'
  | 'INVALID_ACTION'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'TIMEOUT'
  | 'INVALID_REQUEST';

/**
 * Webhook Events for Portal API
 */
export interface PortalWebhookEvent {
  id: string;
  type: PortalWebhookEventType;
  sessionId: string;
  timestamp: number;
  data: any;
  signature?: string; // HMAC signature for verification
}

export type PortalWebhookEventType =
  | 'session.created'
  | 'session.connected'
  | 'session.paused'
  | 'session.resumed'
  | 'session.closed'
  | 'automation.completed'
  | 'automation.failed'
  | 'intervention.required'
  | 'intervention.completed'
  | 'action.executed'
  | 'screenshot.taken';

/**
 * Portal API Configuration
 */
export interface PortalAPIConfig {
  baseUrl: string;
  apiKey?: string;
  timeout?: number;
  retries?: number;
  webhookSecret?: string;
  rateLimit?: {
    requests: number;
    window: number; // seconds
  };
}

/**
 * Portal Embedding SDK Interface
 */
export interface PortalEmbedSDK {
  /**
   * Create an embedded portal widget
   */
  createWidget(container: HTMLElement, sessionId: string, options?: EmbedOptions): PortalWidget;

  /**
   * Create portal controls without the browser view
   */
  createControls(container: HTMLElement, sessionId: string): PortalControls;

  /**
   * Create browser view without controls
   */
  createBrowserView(container: HTMLElement, sessionId: string): PortalBrowserView;
}

export interface PortalWidget {
  /**
   * Widget lifecycle
   */
  mount(): Promise<void>;
  unmount(): void;
  resize(width?: number, height?: number): void;

  /**
   * Widget state
   */
  isConnected(): boolean;
  getSessionInfo(): PortalSessionInfo | null;

  /**
   * Control methods
   */
  pause(): Promise<void>;
  resume(): Promise<void>;
  takeControl(): Promise<void>;
  returnControl(): Promise<void>;
  takeScreenshot(): Promise<string>;

  /**
   * Event handling
   */
  on(event: PortalWidgetEvent, handler: (data: any) => void): void;
  off(event: PortalWidgetEvent, handler: (data: any) => void): void;
}

export interface PortalControls {
  mount(): Promise<void>;
  unmount(): void;
  setTheme(theme: 'light' | 'dark' | 'auto'): void;
  updateSessionInfo(info: PortalSessionInfo): void;
  on(event: PortalControlEvent, handler: (data: any) => void): void;
  off(event: PortalControlEvent, handler: (data: any) => void): void;
}

export interface PortalBrowserView {
  mount(): Promise<void>;
  unmount(): void;
  updateBrowserState(state: PortalBrowserStateAPI): void;
  highlightElements(selectors: string[]): void;
  clearHighlights(): void;
  on(event: PortalBrowserViewEvent, handler: (data: any) => void): void;
  off(event: PortalBrowserViewEvent, handler: (data: any) => void): void;
}

export type PortalWidgetEvent =
  | 'connected'
  | 'disconnected'
  | 'sessionUpdated'
  | 'stateUpdated'
  | 'actionCompleted'
  | 'error';

export type PortalControlEvent =
  | 'pauseClicked'
  | 'resumeClicked'
  | 'takeControlClicked'
  | 'returnControlClicked'
  | 'screenshotClicked'
  | 'closeClicked';

export type PortalBrowserViewEvent =
  | 'elementSelected'
  | 'elementClicked'
  | 'contextMenu'
  | 'stateUpdated';