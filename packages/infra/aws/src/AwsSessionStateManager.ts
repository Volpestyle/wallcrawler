/**
 * AWS Session State Manager
 * Redis-based implementation for managing browser automation sessions
 * Uses ElastiCache Redis for distributed session state
 */

import { createClient, RedisClientType } from 'redis';
import {
  ISessionStateManager,
  BrowserSession,
  BrowserSessionStatus,
  ConnectionInfo,
  ConnectionType,
  AutomationEvent,
  EventCallback,
} from '@wallcrawler/infra-common';

import { AwsSessionStateConfig } from './types';

interface RedisKeys {
  session: (id: string) => string;
  sessionByTaskId: (taskId: string) => string;
  sessionsByParent: (parentId: string) => string;
  activeSessions: () => string;
  connections: (sessionId: string) => string;
  connectionInfo: (connectionId: string) => string;
  events: (sessionId: string) => string;
  subscriptions: () => string;
}

/**
 * Redis-based session state manager for AWS infrastructure
 */
export class AwsSessionStateManager implements ISessionStateManager {
  private client: RedisClientType | null = null;
  private readonly config: AwsSessionStateConfig;
  private readonly keys: RedisKeys;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private subscriptions: Map<string, { sessionId: string; callback: EventCallback }> = new Map();

  constructor(config: AwsSessionStateConfig) {
    this.config = config;

    // Create Redis key helpers
    const prefix = config.keyPrefix || 'wallcrawler:';
    this.keys = {
      session: (id: string) => `${prefix}session:${id}`,
      sessionByTaskId: (taskId: string) => `${prefix}task:${taskId}`,
      sessionsByParent: (parentId: string) => `${prefix}parent:${parentId}`,
      activeSessions: () => `${prefix}active`,
      connections: (sessionId: string) => `${prefix}connections:${sessionId}`,
      connectionInfo: (connectionId: string) => `${prefix}connection:${connectionId}`,
      events: (sessionId: string) => `${prefix}events:${sessionId}`,
      subscriptions: () => `${prefix}subscriptions`,
    };

    this.initializeRedis();
  }

  private async initializeRedis(): Promise<void> {
    const config = this.config.connectionConfig;

    this.client = createClient({
      socket: {
        host: config.endpoint,
        port: config.port || 6379,
      },
      password: config.password,
      database: config.db || 0,
    });

    this.client.on('error', (err) => {
      console.error('[AwsSessionStateManager] Redis error:', err);
    });

    this.client.on('connect', () => {
      console.log('[AwsSessionStateManager] Connected to Redis');
    });

    try {
      await this.client.connect();

      // Start automatic cleanup if enabled
      if (this.config.autoCleanup) {
        this.startCleanupInterval();
      }
    } catch (error) {
      console.error('[AwsSessionStateManager] Failed to connect to Redis:', error);
      throw error;
    }
  }

  private async ensureConnected(): Promise<RedisClientType> {
    if (!this.client || !this.client.isReady) {
      await this.initializeRedis();
    }
    return this.client!;
  }

  // =============================================================================
  // Session Management
  // =============================================================================

  async createSession(session: BrowserSession): Promise<BrowserSession> {
    const client = await this.ensureConnected();

    try {
      const sessionData = JSON.stringify({
        ...session,
        startedAt: session.startedAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
        lastHeartbeat: session.lastHeartbeat.toISOString(),
      });

      // Store session
      await client.setEx(this.keys.session(session.id), this.config.sessionTtl || 4 * 60 * 60, sessionData);

      // Index by task ID
      await client.setEx(this.keys.sessionByTaskId(session.taskId), this.config.taskTtl || 8 * 60 * 60, session.id);

      // Add to parent session set
      await client.sAdd(this.keys.sessionsByParent(session.sessionId), session.id);
      await client.expire(this.keys.sessionsByParent(session.sessionId), this.config.sessionTtl || 4 * 60 * 60);

      // Add to active sessions if status is starting/running
      if (['starting', 'running'].includes(session.status)) {
        await client.sAdd(this.keys.activeSessions(), session.id);
      }

      console.log(`[AwsSessionStateManager] Created session ${session.id}`);
      return session;
    } catch (error) {
      console.error('[AwsSessionStateManager] Failed to create session:', error);
      throw error;
    }
  }

  async getSession(sessionId: string): Promise<BrowserSession | undefined> {
    const client = await this.ensureConnected();

    try {
      const sessionData = await client.get(this.keys.session(sessionId));
      if (!sessionData) {
        return undefined;
      }

      const parsed = JSON.parse(sessionData);
      return {
        ...parsed,
        startedAt: new Date(parsed.startedAt),
        updatedAt: new Date(parsed.updatedAt),
        lastHeartbeat: new Date(parsed.lastHeartbeat),
      };
    } catch (error) {
      console.error('[AwsSessionStateManager] Failed to get session:', error);
      return undefined;
    }
  }

  async getSessionByTaskId(taskId: string): Promise<BrowserSession | undefined> {
    const client = await this.ensureConnected();

    try {
      const sessionId = await client.get(this.keys.sessionByTaskId(taskId));
      if (!sessionId) {
        return undefined;
      }

      return this.getSession(sessionId);
    } catch (error) {
      console.error('[AwsSessionStateManager] Failed to get session by task ID:', error);
      return undefined;
    }
  }

  async updateSession(sessionId: string, updates: Partial<BrowserSession>): Promise<BrowserSession | undefined> {
    const client = await this.ensureConnected();

    try {
      const existingSession = await this.getSession(sessionId);
      if (!existingSession) {
        return undefined;
      }

      const updatedSession = {
        ...existingSession,
        ...updates,
        updatedAt: new Date(),
      };

      const sessionData = JSON.stringify({
        ...updatedSession,
        startedAt: updatedSession.startedAt.toISOString(),
        updatedAt: updatedSession.updatedAt.toISOString(),
        lastHeartbeat: updatedSession.lastHeartbeat.toISOString(),
      });

      await client.setEx(this.keys.session(sessionId), this.config.sessionTtl || 4 * 60 * 60, sessionData);

      // Update active sessions set based on status
      if (['starting', 'running'].includes(updatedSession.status)) {
        await client.sAdd(this.keys.activeSessions(), sessionId);
      } else {
        await client.sRem(this.keys.activeSessions(), sessionId);
      }

      return updatedSession;
    } catch (error) {
      console.error('[AwsSessionStateManager] Failed to update session:', error);
      return undefined;
    }
  }

  async updateSessionStatus(
    sessionId: string,
    status: BrowserSessionStatus,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const updates: Partial<BrowserSession> = { status };
    if (metadata) {
      updates.metadata = metadata;
    }

    await this.updateSession(sessionId, updates);
  }

  async recordHeartbeat(sessionId: string): Promise<void> {
    await this.updateSession(sessionId, { lastHeartbeat: new Date() });
  }

  async getAllSessions(): Promise<BrowserSession[]> {
    const client = await this.ensureConnected();

    try {
      const keys = await client.keys(this.keys.session('*'));
      const sessionPromises = keys.map(async (key) => {
        const data = await client.get(key);
        if (data) {
          const parsed = JSON.parse(data);
          return {
            ...parsed,
            startedAt: new Date(parsed.startedAt),
            updatedAt: new Date(parsed.updatedAt),
            lastHeartbeat: new Date(parsed.lastHeartbeat),
          };
        }
        return null;
      });

      const sessions = await Promise.all(sessionPromises);
      return sessions.filter((session): session is BrowserSession => session !== null);
    } catch (error) {
      console.error('[AwsSessionStateManager] Failed to get all sessions:', error);
      return [];
    }
  }

  async getSessionsByParentId(parentSessionId: string): Promise<BrowserSession[]> {
    const client = await this.ensureConnected();

    try {
      const sessionIds = await client.sMembers(this.keys.sessionsByParent(parentSessionId));
      const sessionPromises = sessionIds.map((id) => this.getSession(id));
      const sessions = await Promise.all(sessionPromises);
      return sessions.filter((session): session is BrowserSession => session !== undefined);
    } catch (error) {
      console.error('[AwsSessionStateManager] Failed to get sessions by parent ID:', error);
      return [];
    }
  }

  async getActiveSessions(): Promise<BrowserSession[]> {
    const client = await this.ensureConnected();

    try {
      const sessionIds = await client.sMembers(this.keys.activeSessions());
      const sessionPromises = sessionIds.map((id) => this.getSession(id));
      const sessions = await Promise.all(sessionPromises);
      return sessions.filter((session): session is BrowserSession => session !== undefined);
    } catch (error) {
      console.error('[AwsSessionStateManager] Failed to get active sessions:', error);
      return [];
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const client = await this.ensureConnected();

    try {
      const session = await this.getSession(sessionId);
      if (session) {
        // Remove from all indices
        await Promise.all([
          client.del(this.keys.session(sessionId)),
          client.del(this.keys.sessionByTaskId(session.taskId)),
          client.sRem(this.keys.sessionsByParent(session.sessionId), sessionId),
          client.sRem(this.keys.activeSessions(), sessionId),
          client.del(this.keys.connections(sessionId)),
        ]);
      }
    } catch (error) {
      console.error('[AwsSessionStateManager] Failed to delete session:', error);
      throw error;
    }
  }

  // =============================================================================
  // Connection Management
  // =============================================================================

  async addConnection(sessionId: string, connectionId: string, type: ConnectionType = 'websocket'): Promise<void> {
    const client = await this.ensureConnected();

    try {
      const connectionInfo: ConnectionInfo = {
        connectionId,
        sessionId,
        type,
        connectedAt: new Date(),
        lastActivity: new Date(),
      };

      await Promise.all([
        client.sAdd(this.keys.connections(sessionId), connectionId),
        client.setEx(
          this.keys.connectionInfo(connectionId),
          this.config.sessionTtl || 4 * 60 * 60,
          JSON.stringify({
            ...connectionInfo,
            connectedAt: connectionInfo.connectedAt.toISOString(),
            lastActivity: connectionInfo.lastActivity.toISOString(),
          })
        ),
      ]);
    } catch (error) {
      console.error('[AwsSessionStateManager] Failed to add connection:', error);
      throw error;
    }
  }

  async removeConnection(sessionId: string, connectionId: string): Promise<void> {
    const client = await this.ensureConnected();

    try {
      await Promise.all([
        client.sRem(this.keys.connections(sessionId), connectionId),
        client.del(this.keys.connectionInfo(connectionId)),
      ]);
    } catch (error) {
      console.error('[AwsSessionStateManager] Failed to remove connection:', error);
      throw error;
    }
  }

  async getConnections(sessionId: string): Promise<string[]> {
    const client = await this.ensureConnected();

    try {
      return await client.sMembers(this.keys.connections(sessionId));
    } catch (error) {
      console.error('[AwsSessionStateManager] Failed to get connections:', error);
      return [];
    }
  }

  async getConnectionInfo(connectionId: string): Promise<ConnectionInfo | undefined> {
    const client = await this.ensureConnected();

    try {
      const data = await client.get(this.keys.connectionInfo(connectionId));
      if (!data) {
        return undefined;
      }

      const parsed = JSON.parse(data);
      return {
        ...parsed,
        connectedAt: new Date(parsed.connectedAt),
        lastActivity: new Date(parsed.lastActivity),
      };
    } catch (error) {
      console.error('[AwsSessionStateManager] Failed to get connection info:', error);
      return undefined;
    }
  }

  // =============================================================================
  // Event Management
  // =============================================================================

  async publishEvent(sessionId: string, event: AutomationEvent): Promise<void> {
    const client = await this.ensureConnected();

    try {
      // Store event for potential replay/history
      await client.lPush(this.keys.events(sessionId), JSON.stringify(event));
      await client.expire(this.keys.events(sessionId), this.config.sessionTtl || 4 * 60 * 60);

      // Limit event history to prevent memory issues
      await client.lTrim(this.keys.events(sessionId), 0, 99); // Keep last 100 events

      // Notify all subscribers
      for (const [subscriptionId, subscription] of this.subscriptions) {
        if (subscription.sessionId === sessionId) {
          try {
            subscription.callback(event);
          } catch (error) {
            console.error(`[AwsSessionStateManager] Error in event callback ${subscriptionId}:`, error);
          }
        }
      }
    } catch (error) {
      console.error('[AwsSessionStateManager] Failed to publish event:', error);
      throw error;
    }
  }

  async subscribeToEvents(sessionId: string, callback: EventCallback): Promise<string> {
    const subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    this.subscriptions.set(subscriptionId, {
      sessionId,
      callback,
    });

    console.log(`[AwsSessionStateManager] Subscribed to events for session ${sessionId}: ${subscriptionId}`);
    return subscriptionId;
  }

  async unsubscribeFromEvents(subscriptionId: string): Promise<void> {
    this.subscriptions.delete(subscriptionId);
    console.log(`[AwsSessionStateManager] Unsubscribed from events: ${subscriptionId}`);
  }

  // =============================================================================
  // Cleanup and Maintenance
  // =============================================================================

  async cleanupExpiredSessions(): Promise<void> {
    console.log('[AwsSessionStateManager] Running expired session cleanup...');

    try {
      const allSessions = await this.getAllSessions();
      const now = new Date();
      const sessionTtl = (this.config.sessionTtl || 4 * 60 * 60) * 1000; // Convert to milliseconds

      for (const session of allSessions) {
        const age = now.getTime() - session.updatedAt.getTime();
        if (age > sessionTtl) {
          console.log(`[AwsSessionStateManager] Cleaning up expired session: ${session.id}`);
          await this.deleteSession(session.id);
        }
      }
    } catch (error) {
      console.error('[AwsSessionStateManager] Error during expired session cleanup:', error);
    }
  }

  async cleanupStaleInfrastructure(): Promise<void> {
    console.log('[AwsSessionStateManager] Running stale infrastructure cleanup...');

    try {
      const activeSessions = await this.getActiveSessions();
      const now = new Date();
      const heartbeatTimeout = (this.config.heartbeatTimeout || 5 * 60) * 1000; // 5 minutes default

      for (const session of activeSessions) {
        const timeSinceHeartbeat = now.getTime() - session.lastHeartbeat.getTime();
        if (timeSinceHeartbeat > heartbeatTimeout) {
          console.log(`[AwsSessionStateManager] Marking stale infrastructure as lost: ${session.id}`);
          await this.updateSessionStatus(session.id, 'lost');
        }
      }
    } catch (error) {
      console.error('[AwsSessionStateManager] Error during stale infrastructure cleanup:', error);
    }
  }

  async getStats(): Promise<{
    totalSessions: number;
    activeSessions: number;
    pausedSessions: number;
    failedSessions: number;
    totalConnections: number;
    staleInfrastructure: number;
  }> {
    try {
      const allSessions = await this.getAllSessions();
      const activeSessions = allSessions.filter((s) => ['starting', 'running'].includes(s.status));
      const pausedSessions = allSessions.filter((s) => s.status === 'paused');
      const failedSessions = allSessions.filter((s) => ['failed', 'lost'].includes(s.status));

      // Count total connections across all sessions
      let totalConnections = 0;
      for (const session of allSessions) {
        const connections = await this.getConnections(session.id);
        totalConnections += connections.length;
      }

      // Count stale infrastructure
      const now = new Date();
      const heartbeatTimeout = (this.config.heartbeatTimeout || 5 * 60) * 1000;
      const staleInfrastructure = activeSessions.filter((session) => {
        return now.getTime() - session.lastHeartbeat.getTime() > heartbeatTimeout;
      }).length;

      return {
        totalSessions: allSessions.length,
        activeSessions: activeSessions.length,
        pausedSessions: pausedSessions.length,
        failedSessions: failedSessions.length,
        totalConnections,
        staleInfrastructure,
      };
    } catch (error) {
      console.error('[AwsSessionStateManager] Failed to get stats:', error);
      return {
        totalSessions: 0,
        activeSessions: 0,
        pausedSessions: 0,
        failedSessions: 0,
        totalConnections: 0,
        staleInfrastructure: 0,
      };
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const client = await this.ensureConnected();
      const result = await client.ping();
      return result === 'PONG';
    } catch (error) {
      console.error('[AwsSessionStateManager] Health check failed:', error);
      return false;
    }
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  private startCleanupInterval(): void {
    const intervalMs = (this.config.cleanupInterval || 60 * 60) * 1000; // 1 hour default

    this.cleanupInterval = setInterval(async () => {
      try {
        await this.cleanupExpiredSessions();
        await this.cleanupStaleInfrastructure();
      } catch (error) {
        console.error('[AwsSessionStateManager] Error during scheduled cleanup:', error);
      }
    }, intervalMs);

    console.log(`[AwsSessionStateManager] Started cleanup interval: ${intervalMs}ms`);
  }

  private stopCleanupInterval(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  // =============================================================================
  // Lifecycle Management
  // =============================================================================

  async destroy(): Promise<void> {
    console.log('[AwsSessionStateManager] Destroying session state manager...');

    try {
      this.stopCleanupInterval();
      this.subscriptions.clear();

      if (this.client) {
        await this.client.disconnect();
        this.client = null;
      }
    } catch (error) {
      console.error('[AwsSessionStateManager] Error during destroy:', error);
    }
  }
}
