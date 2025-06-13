import { 
  PortalSession,
  PortalBrowserState, 
  PortalCommand, 
  PortalEvent,
  PortalConfig,
  PortalConnectionInfo,
  PortalStats
} from "./portal";

/**
 * Portal Transport Interface
 * 
 * Abstraction layer for different transport mechanisms (WebSocket, SSE, polling)
 * Allows the portal core to work with different infrastructure providers
 */
export interface PortalTransport {
  /**
   * Initialize the transport with configuration
   */
  initialize(config: PortalTransportConfig): Promise<void>;

  /**
   * Connect to a portal session
   */
  connect(sessionId: string, auth?: PortalAuthInfo): Promise<PortalConnectionInfo>;

  /**
   * Disconnect from the current session
   */
  disconnect(): Promise<void>;

  /**
   * Send browser state update to connected portals
   */
  sendBrowserState(state: PortalBrowserState): Promise<void>;

  /**
   * Send an event to connected portals
   */
  sendEvent(event: PortalEvent): Promise<void>;

  /**
   * Register handler for incoming commands from portal
   */
  onCommand(handler: (command: PortalCommand) => void): void;

  /**
   * Register handler for connection state changes
   */
  onConnectionChange(handler: (connected: boolean, info?: PortalConnectionInfo) => void): void;

  /**
   * Register handler for errors
   */
  onError(handler: (error: Error) => void): void;

  /**
   * Get current connection info
   */
  getConnectionInfo(): PortalConnectionInfo | null;

  /**
   * Check if transport is connected
   */
  isConnected(): boolean;

  /**
   * Get transport capabilities
   */
  getCapabilities(): PortalTransportCapabilities;

  /**
   * Create a new portal session
   */
  createSession(config: CreateSessionConfig): Promise<PortalSession>;

  /**
   * Get existing portal session
   */
  getSession(sessionId: string): Promise<PortalSession | null>;

  /**
   * Update portal session
   */
  updateSession(sessionId: string, updates: Partial<PortalSession>): Promise<PortalSession>;

  /**
   * Close a portal session
   */
  closeSession(sessionId: string): Promise<void>;

  /**
   * Get portal statistics
   */
  getStats(sessionId: string): Promise<PortalStats>;

  /**
   * Cleanup resources
   */
  cleanup(): Promise<void>;
}

/**
 * Portal Transport Configuration
 */
export interface PortalTransportConfig {
  // Transport type
  type: "websocket" | "sse" | "polling";
  
  // Connection settings
  endpoint?: string;
  port?: number;
  path?: string;
  protocol?: "ws" | "wss" | "http" | "https";
  
  // Authentication
  authentication?: PortalAuthConfig;
  
  // Timeouts and limits
  connectionTimeoutMs?: number;
  reconnectIntervalMs?: number;
  maxReconnectAttempts?: number;
  heartbeatIntervalMs?: number;
  maxMessageSize?: number;
  
  // Features
  enableCompression?: boolean;
  enableBuffering?: boolean;
  bufferSize?: number;
  
  // Security
  cors?: {
    allowedOrigins: string[];
    allowCredentials: boolean;
  };
  rateLimit?: {
    maxRequestsPerMinute: number;
    maxDataPerMinute: number;
  };

  // Provider-specific settings
  aws?: {
    region: string;
    apiGatewayId: string;
    stage: string;
    lambdaArn?: string;
  };
  local?: {
    host: string;
    staticPath?: string;
    enableUI?: boolean;
  };
}

/**
 * Portal Authentication Configuration
 */
export interface PortalAuthConfig {
  type: "token" | "session" | "oauth" | "none";
  tokenHeader?: string;
  sessionCookie?: string;
  oauth?: {
    provider: string;
    clientId: string;
    scopes: string[];
  };
  customValidator?: (credentials: any) => Promise<boolean>;
}

/**
 * Portal Authentication Info
 */
export interface PortalAuthInfo {
  type: "token" | "session" | "oauth";
  credentials: {
    token?: string;
    sessionId?: string;
    userId?: string;
    scopes?: string[];
    expiresAt?: number;
  };
}

/**
 * Create Session Configuration
 */
export interface CreateSessionConfig {
  sessionId: string;
  userId?: string;
  timeoutMs?: number;
  maxInactivityMs?: number;
  config?: Partial<PortalConfig>;
  metadata?: Record<string, any>;
}

/**
 * Portal Transport Capabilities
 */
export interface PortalTransportCapabilities {
  // Supported features
  supportsRealTimeUpdates: boolean;
  supportsBidirectionalCommunication: boolean;
  supportsFileTransfer: boolean;
  supportsVideoStreaming: boolean;
  supportsAuthentication: boolean;
  supportsEncryption: boolean;
  
  // Performance characteristics
  maxConcurrentConnections: number;
  maxMessageSize: number;
  averageLatency: number;
  reliability: "high" | "medium" | "low";
  
  // Transport-specific info
  protocol: string;
  version: string;
  features: string[];
}

/**
 * Portal Transport Factory
 * 
 * Factory interface for creating transport instances
 */
export interface PortalTransportFactory {
  /**
   * Create a transport instance for the given type
   */
  create(type: "websocket" | "sse" | "polling", config: PortalTransportConfig): PortalTransport;

  /**
   * Get available transport types for current environment
   */
  getAvailableTransports(): string[];

  /**
   * Get recommended transport for current environment
   */
  getRecommendedTransport(): string;
}

/**
 * Portal Transport Events
 */
export interface PortalTransportEvents {
  connected: (info: PortalConnectionInfo) => void;
  disconnected: (reason: string) => void;
  error: (error: Error) => void;
  message: (data: any) => void;
  command: (command: PortalCommand) => void;
  stateUpdate: (state: PortalBrowserState) => void;
  sessionCreated: (session: PortalSession) => void;
  sessionClosed: (sessionId: string) => void;
}

/**
 * Portal Message Types
 * 
 * Standardized message format for transport layer
 */
export interface PortalMessage {
  id: string;
  type: PortalMessageType;
  timestamp: number;
  sessionId: string;
  payload: any;
  metadata?: {
    source: string;
    version: string;
    compression?: string;
    encryption?: string;
  };
}

export type PortalMessageType =
  | "browser-state"     // Browser state update
  | "command"           // Command from portal to automation
  | "event"             // Event from automation to portal
  | "auth"              // Authentication message
  | "ping"              // Heartbeat ping
  | "pong"              // Heartbeat pong
  | "error"             // Error message
  | "close";            // Connection close message

/**
 * Portal Transport Error Types
 */
export class PortalTransportError extends Error {
  constructor(
    message: string,
    public code: PortalTransportErrorCode,
    public details?: any
  ) {
    super(message);
    this.name = "PortalTransportError";
  }
}

export type PortalTransportErrorCode =
  | "CONNECTION_FAILED"
  | "AUTHENTICATION_FAILED"
  | "SESSION_NOT_FOUND"
  | "SESSION_EXPIRED"
  | "INVALID_MESSAGE"
  | "RATE_LIMITED"
  | "TRANSPORT_UNAVAILABLE"
  | "CONFIGURATION_ERROR"
  | "NETWORK_ERROR"
  | "UNKNOWN_ERROR";