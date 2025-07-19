/**
 * Unified session interface - consolidates RuntimeSession and AutomationTask
 * Represents a browser automation session from both application and infrastructure perspectives
 */

export interface BrowserSession {
  // Core identifiers
  /** Unique session instance identifier (runtime session ID) */
  id: string;
  /** Parent session/job identifier */
  sessionId: string;
  /** Infrastructure task identifier (ECS task ID, process ID, etc.) */
  taskId: string;
  /** Task ARN or full container identifier */
  taskArn: string | null;

  // Status and lifecycle
  /** Current session status */
  status: BrowserSessionStatus;
  /** Session start timestamp */
  startedAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
  /** Last infrastructure heartbeat timestamp */
  lastHeartbeat: Date;

  // Connection and access details
  /** Browser connection URL */
  browserUrl: string | null;
  /** Private IP address */
  privateIp: string | null;
  /** Public IP address */
  publicIp: string | null;

  // Application-level tracking
  /** Number of items processed/found */
  itemsProcessed: number;
  /** Optional reference to saved configuration */
  savedConfigId?: string;

  // Infrastructure and debugging
  /** Health status of the underlying infrastructure */
  healthStatus?: string;
  /** Connection URL for HTTP communication */
  connectUrl?: string;

  // Metadata and extensibility
  /** Additional session metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Unified session status enum
 * Combines application and infrastructure states
 */
export type BrowserSessionStatus =
  | 'starting' // Infrastructure starting up
  | 'running' // Active and processing
  | 'paused' // Temporarily paused (application state)
  | 'stopping' // Gracefully shutting down
  | 'stopped' // Cleanly terminated
  | 'failed' // Error state
  | 'lost'; // Infrastructure lost/unreachable

/**
 * Session configuration interface
 * TTL values are in seconds
 */
export interface SessionConfig {
  /** Session TTL in seconds (default: 4 hours) */
  sessionTtl?: number;
  /** Task TTL in seconds (default: 8 hours) */
  taskTtl?: number;
  /** Cleanup interval in seconds */
  cleanupInterval?: number;
}

/**
 * Connection information for real-time communication
 */
export interface ConnectionInfo {
  /** Connection identifier */
  connectionId: string;
  /** Session this connection belongs to */
  sessionId: string;
  /** Connection type (SSE, WebSocket, etc.) */
  type: ConnectionType;
  /** Connection timestamp */
  connectedAt: Date;
  /** Last activity timestamp */
  lastActivity: Date;
}

/**
 * Connection type enum
 */
export type ConnectionType = 'sse' | 'websocket' | 'http';
