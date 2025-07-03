/**
 * Session State Management Interface
 * Simplified interface that manages browser sessions as single entities
 * Replaces the dual RuntimeSession/AutomationTask pattern
 */

import { BrowserSession, BrowserSessionStatus, SessionConfig, ConnectionInfo, ConnectionType } from '../types/session';

import { AutomationEvent, EventCallback } from '../types/events';

/**
 * Interface for managing browser automation sessions
 * Combines application and infrastructure state management
 */
export interface ISessionStateManager {
  // Browser Session Management
  /**
   * Create a new browser automation session
   */
  createSession(session: BrowserSession): Promise<BrowserSession>;

  /**
   * Get a browser session by session ID
   */
  getSession(sessionId: string): Promise<BrowserSession | undefined>;

  /**
   * Get a browser session by infrastructure task ID
   */
  getSessionByTaskId(taskId: string): Promise<BrowserSession | undefined>;

  /**
   * Update a browser session
   */
  updateSession(sessionId: string, updates: Partial<BrowserSession>): Promise<BrowserSession | undefined>;

  /**
   * Update session status and heartbeat
   */
  updateSessionStatus(
    sessionId: string,
    status: BrowserSessionStatus,
    metadata?: Record<string, unknown>
  ): Promise<void>;

  /**
   * Record infrastructure heartbeat
   */
  recordHeartbeat(sessionId: string): Promise<void>;

  /**
   * Get all browser sessions
   */
  getAllSessions(): Promise<BrowserSession[]>;

  /**
   * Get sessions by parent session ID
   */
  getSessionsByParentId(parentSessionId: string): Promise<BrowserSession[]>;

  /**
   * Get all active sessions (running/starting)
   */
  getActiveSessions(): Promise<BrowserSession[]>;

  /**
   * Delete a browser session
   */
  deleteSession(sessionId: string): Promise<void>;

  // Connection Management
  /**
   * Add a connection for real-time communication
   */
  addConnection(sessionId: string, connectionId: string, type?: ConnectionType): Promise<void>;

  /**
   * Remove a connection
   */
  removeConnection(sessionId: string, connectionId: string): Promise<void>;

  /**
   * Get all connections for a session
   */
  getConnections(sessionId: string): Promise<string[]>;

  /**
   * Get connection information
   */
  getConnectionInfo(connectionId: string): Promise<ConnectionInfo | undefined>;

  // Event Management
  /**
   * Publish an event to a session
   */
  publishEvent(sessionId: string, event: AutomationEvent): Promise<void>;

  /**
   * Subscribe to events for a session
   */
  subscribeToEvents(sessionId: string, callback: EventCallback): Promise<string>;

  /**
   * Unsubscribe from events
   */
  unsubscribeFromEvents(subscriptionId: string): Promise<void>;

  // Cleanup and Maintenance
  /**
   * Clean up expired sessions and connections
   */
  cleanupExpiredSessions(): Promise<void>;

  /**
   * Clean up sessions that haven't sent heartbeats
   */
  cleanupStaleInfrastructure(): Promise<void>;

  /**
   * Get storage statistics
   */
  getStats(): Promise<{
    totalSessions: number;
    activeSessions: number;
    pausedSessions: number;
    failedSessions: number;
    totalConnections: number;
    staleInfrastructure: number;
  }>;

  /**
   * Health check for the state manager
   */
  healthCheck(): Promise<boolean>;
}

/**
 * Configuration for session state managers
 */
export interface SessionStateManagerConfig extends SessionConfig {
  /** Storage backend identifier */
  backend: string;
  
  /** Connection string or configuration for the backend */
  connectionConfig: Record<string, unknown>;
  
  /** Prefix for storage keys */
  keyPrefix?: string;
  
  /** Enable automatic cleanup */
  autoCleanup?: boolean;
  
  /** Heartbeat timeout in seconds (sessions without heartbeat are considered stale) */
  heartbeatTimeout?: number;
}