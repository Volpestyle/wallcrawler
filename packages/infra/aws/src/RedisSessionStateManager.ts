/**
 * Unified Redis-based session state manager for AWS environments
 * Handles browser sessions as single entities with ElastiCache best practices
 */

import { createClient, type RedisClientOptions } from 'redis';
import {
  ISessionStateManager,
  SessionStateManagerConfig,
  BrowserSession,
  BrowserSessionStatus,
  ConnectionInfo,
  ConnectionType,
  AutomationEvent,
  EventCallback,
  BaseEventPublisher
} from '@wallcrawler/infra-common';

/**
 * Configuration for Redis session state manager
 */
export interface RedisSessionStateConfig extends SessionStateManagerConfig {
  /** Redis connection URL */
  redisUrl?: string;
  /** Redis connection options */
  redisOptions?: Partial<RedisClientOptions>;
  /** Key prefix for all Redis keys */
  keyPrefix?: string;
  /** Enable automatic cleanup */
  autoCleanup?: boolean;
  /** Reconnection strategy */
  reconnectStrategy?: (retries: number) => number | false;
  /** Maximum number of connections in pool (AWS recommends 10-20) */
  maxConnections?: number;
}

/**
 * Unified Redis-based session state manager for AWS environments
 * Implements simplified browser session management
 */
export class RedisSessionStateManager implements ISessionStateManager {
  private connectionPool: ReturnType<typeof createClient>[] = [];
  private poolIndex = 0;
  private readonly config: Required<RedisSessionStateConfig>;
  private cleanupInterval?: NodeJS.Timeout;
  private readonly eventPublisher: BaseEventPublisher;

  constructor(config: RedisSessionStateConfig = { backend: 'redis', connectionConfig: {} }) {
    // Initialize event publisher with composition
    this.eventPublisher = new BaseEventPublisher({
      eventRetention: config.sessionTtl ?? 4 * 60 * 60,
      enableLogging: true,
    });

    this.config = {
      backend: config.backend || 'redis',
      connectionConfig: config.connectionConfig || {},
      redisUrl: config.redisUrl ?? process.env.REDIS_URL ?? 'redis://localhost:6379',
      redisOptions: config.redisOptions ?? {},
      keyPrefix: config.keyPrefix ?? 'automation',
      sessionTtl: config.sessionTtl ?? 4 * 60 * 60, // 4 hours
      taskTtl: config.taskTtl ?? 8 * 60 * 60, // 8 hours
      heartbeatTimeout: config.heartbeatTimeout ?? 5 * 60, // 5 minutes
      cleanupInterval: config.cleanupInterval ?? 60 * 60, // 1 hour
      autoCleanup: config.autoCleanup ?? true,
      reconnectStrategy: config.reconnectStrategy ?? this.defaultReconnectStrategy,
      maxConnections: config.maxConnections ?? 1,
    };

    if (this.config.autoCleanup) {
      this.startAutoCleanup();
    }
  }

  /**
   * Get Redis client using connection pool (AWS ElastiCache best practice)
   */
  private async getRedisClient(): Promise<ReturnType<typeof createClient>> {
    if (this.connectionPool.length === 0) {
      await this.initializeConnectionPool();
    }

    const client = this.connectionPool[this.poolIndex];
    this.poolIndex = (this.poolIndex + 1) % this.connectionPool.length;

    if (!client.isOpen) {
      await client.connect();
    }

    return client;
  }

  /**
   * Initialize connection pool with AWS ElastiCache best practices
   */
  private async initializeConnectionPool(): Promise<void> {
    const redisConfig = {
      url: this.config.redisUrl,
      socket: {
        connectTimeout: 60000,
        commandTimeout: 5000,
        reconnectStrategy: this.config.reconnectStrategy,
      },
      ...this.config.redisOptions,
    };

    console.log(`[RedisSessionStateManager] Initializing connection pool with ${this.config.maxConnections} connections`);

    for (let i = 0; i < this.config.maxConnections; i++) {
      const client = createClient(redisConfig);

      client.on('error', (err) => console.error(`[RedisSessionStateManager] Redis Client ${i} Error:`, err));
      client.on('connect', () => console.log(`[RedisSessionStateManager] Redis Client ${i} Connected`));
      client.on('disconnect', () => console.log(`[RedisSessionStateManager] Redis Client ${i} Disconnected`));
      client.on('reconnecting', () => console.log(`[RedisSessionStateManager] Redis Client ${i} Reconnecting...`));
      client.on('ready', () => console.log(`[RedisSessionStateManager] Redis Client ${i} Ready`));

      await client.connect();
      this.connectionPool.push(client);
    }

    console.log(`[RedisSessionStateManager] Connection pool initialized with ${this.connectionPool.length} connections`);
  }

  /**
   * Default reconnection strategy
   */
  private defaultReconnectStrategy(retries: number): number | false {
    if (retries > 10) {
      console.error('[RedisSessionStateManager] Redis reconnection failed after 10 attempts');
      return false;
    }
    const delay = Math.min(100 * Math.pow(2, retries), 3000);
    console.log(`[RedisSessionStateManager] Redis reconnecting in ${delay}ms (attempt ${retries + 1})`);
    return delay;
  }

  // Browser Session Management
  async createSession(session: BrowserSession): Promise<BrowserSession> {
    const redis = await this.getRedisClient();
    const key = this.getSessionKey(session.id);

    await redis.hSet(key, {
      id: session.id,
      sessionId: session.sessionId,
      taskId: session.taskId,
      taskArn: session.taskArn || '',
      status: session.status,
      startedAt: session.startedAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      lastHeartbeat: session.lastHeartbeat.toISOString(),
      browserUrl: session.browserUrl || '',
      vncUrl: session.vncUrl || '',
      privateIp: session.privateIp || '',
      publicIp: session.publicIp || '',
      itemsProcessed: session.itemsProcessed.toString(),
      savedConfigId: session.savedConfigId || '',
      healthStatus: session.healthStatus || '',
      connectUrl: session.connectUrl || '',
      metadata: JSON.stringify(session.metadata || {}),
    });

    await redis.expire(key, this.config.sessionTtl);
    return session;
  }

  async getSession(sessionId: string): Promise<BrowserSession | undefined> {
    const redis = await this.getRedisClient();
    const key = this.getSessionKey(sessionId);
    const data = await redis.hGetAll(key);

    if (!data.id) return undefined;

    return this.parseBrowserSession(data);
  }

  async getSessionByTaskId(taskId: string): Promise<BrowserSession | undefined> {
    const redis = await this.getRedisClient();
    const pattern = this.getSessionKey('*');
    const keys = await redis.keys(pattern);

    for (const key of keys) {
      const data = await redis.hGetAll(key);
      if (data.taskId === taskId && data.id) {
        return this.parseBrowserSession(data);
      }
    }

    return undefined;
  }

  async updateSession(sessionId: string, updates: Partial<BrowserSession>): Promise<BrowserSession | undefined> {
    const redis = await this.getRedisClient();
    const key = this.getSessionKey(sessionId);

    const updateData: Record<string, string> = {
      updatedAt: new Date().toISOString(),
    };

    if (updates.sessionId !== undefined) updateData.sessionId = updates.sessionId;
    if (updates.taskId !== undefined) updateData.taskId = updates.taskId;
    if (updates.taskArn !== undefined) updateData.taskArn = updates.taskArn || '';
    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.lastHeartbeat !== undefined) updateData.lastHeartbeat = updates.lastHeartbeat.toISOString();
    if (updates.browserUrl !== undefined) updateData.browserUrl = updates.browserUrl || '';
    if (updates.vncUrl !== undefined) updateData.vncUrl = updates.vncUrl || '';
    if (updates.privateIp !== undefined) updateData.privateIp = updates.privateIp || '';
    if (updates.publicIp !== undefined) updateData.publicIp = updates.publicIp || '';
    if (updates.itemsProcessed !== undefined) updateData.itemsProcessed = updates.itemsProcessed.toString();
    if (updates.savedConfigId !== undefined) updateData.savedConfigId = updates.savedConfigId || '';
    if (updates.healthStatus !== undefined) updateData.healthStatus = updates.healthStatus || '';
    if (updates.connectUrl !== undefined) updateData.connectUrl = updates.connectUrl || '';
    if (updates.metadata !== undefined) updateData.metadata = JSON.stringify(updates.metadata);

    await redis.hSet(key, updateData);
    await redis.expire(key, this.config.sessionTtl);

    return this.getSession(sessionId);
  }

  async updateSessionStatus(sessionId: string, status: BrowserSessionStatus, metadata?: Record<string, unknown>): Promise<void> {
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
    const redis = await this.getRedisClient();
    const pattern = this.getSessionKey('*');
    const keys = await redis.keys(pattern);

    const sessions: BrowserSession[] = [];

    for (const key of keys) {
      const data = await redis.hGetAll(key);
      if (data.id) {
        sessions.push(this.parseBrowserSession(data));
      }
    }

    return sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async getSessionsByParentId(parentSessionId: string): Promise<BrowserSession[]> {
    const redis = await this.getRedisClient();
    const pattern = this.getSessionKey('*');
    const keys = await redis.keys(pattern);

    const sessions: BrowserSession[] = [];

    for (const key of keys) {
      const data = await redis.hGetAll(key);
      if (data.sessionId === parentSessionId && data.id) {
        sessions.push(this.parseBrowserSession(data));
      }
    }

    return sessions;
  }

  async getActiveSessions(): Promise<BrowserSession[]> {
    const redis = await this.getRedisClient();
    const pattern = this.getSessionKey('*');
    const keys = await redis.keys(pattern);

    const sessions: BrowserSession[] = [];

    for (const key of keys) {
      const data = await redis.hGetAll(key);
      if (data.id && (data.status === 'running' || data.status === 'starting')) {
        sessions.push(this.parseBrowserSession(data));
      }
    }

    return sessions;
  }

  async deleteSession(sessionId: string): Promise<void> {
    const redis = await this.getRedisClient();
    const sessionKey = this.getSessionKey(sessionId);
    const connectionsKey = this.getConnectionsKey(sessionId);

    await redis.del(sessionKey);
    await redis.del(connectionsKey);
  }

  // Connection Management
  async addConnection(sessionId: string, connectionId: string, type: ConnectionType = 'sse'): Promise<void> {
    const redis = await this.getRedisClient();
    const key = this.getConnectionsKey(sessionId);

    await redis.sAdd(key, connectionId);
    await redis.expire(key, this.config.sessionTtl);

    const connectionInfo: ConnectionInfo = {
      connectionId,
      sessionId,
      type,
      connectedAt: new Date(),
      lastActivity: new Date(),
    };

    await redis.hSet(this.getConnectionInfoKey(connectionId), {
      connectionId,
      sessionId,
      type,
      connectedAt: connectionInfo.connectedAt.toISOString(),
      lastActivity: connectionInfo.lastActivity.toISOString(),
    });

    await this.updateSession(sessionId, {});
  }

  async removeConnection(sessionId: string, connectionId: string): Promise<void> {
    const redis = await this.getRedisClient();
    const key = this.getConnectionsKey(sessionId);

    await redis.sRem(key, connectionId);
    await redis.del(this.getConnectionInfoKey(connectionId));
  }

  async getConnections(sessionId: string): Promise<string[]> {
    const redis = await this.getRedisClient();
    const key = this.getConnectionsKey(sessionId);
    return redis.sMembers(key);
  }

  async getConnectionInfo(connectionId: string): Promise<ConnectionInfo | undefined> {
    const redis = await this.getRedisClient();
    const data = await redis.hGetAll(this.getConnectionInfoKey(connectionId));

    if (!data.connectionId) return undefined;

    return {
      connectionId: data.connectionId,
      sessionId: data.sessionId,
      type: data.type as ConnectionType,
      connectedAt: new Date(data.connectedAt),
      lastActivity: new Date(data.lastActivity),
    };
  }

  // Event Management
  async publishEvent(sessionId: string, event: AutomationEvent): Promise<void> {
    const redis = await this.getRedisClient();
    await redis.publish(`${this.config.keyPrefix}:events:${sessionId}`, JSON.stringify(event));
    await this.eventPublisher.publishEvent(sessionId, event);
  }

  async subscribeToEvents(sessionId: string, callback: EventCallback): Promise<string> {
    return await this.eventPublisher.subscribe(sessionId, callback);
  }

  async unsubscribeFromEvents(subscriptionId: string): Promise<void> {
    await this.eventPublisher.unsubscribe(subscriptionId);
  }

  // Cleanup and Maintenance
  async cleanupExpiredSessions(): Promise<void> {
    const redis = await this.getRedisClient();
    const now = new Date();
    const sessionTtlMs = this.config.sessionTtl * 1000;

    const sessionKeys = await redis.keys(this.getSessionKey('*'));
    for (const key of sessionKeys) {
      const data = await redis.hGetAll(key);
      if (data.updatedAt) {
        const lastActive = new Date(data.updatedAt);
        if (now.getTime() - lastActive.getTime() > sessionTtlMs) {
          await redis.del(key);
          const sessionId = key.replace(`${this.config.keyPrefix}:session:`, '');
          await redis.del(this.getConnectionsKey(sessionId));
        }
      }
    }
  }

  async cleanupStaleInfrastructure(): Promise<void> {
    const redis = await this.getRedisClient();
    const now = new Date();
    const heartbeatTimeoutMs = this.config.heartbeatTimeout * 1000;

    const sessionKeys = await redis.keys(this.getSessionKey('*'));
    for (const key of sessionKeys) {
      const data = await redis.hGetAll(key);
      if (data.lastHeartbeat) {
        const lastHeartbeat = new Date(data.lastHeartbeat);
        if (now.getTime() - lastHeartbeat.getTime() > heartbeatTimeoutMs) {
          // Mark as lost but don't delete immediately
          await redis.hSet(key, { status: 'lost' });
        }
      }
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
    const redis = await this.getRedisClient();
    const sessions = await this.getAllSessions();

    let activeSessions = 0;
    let pausedSessions = 0;
    let failedSessions = 0;
    let staleInfrastructure = 0;

    const now = new Date();
    const heartbeatTimeoutMs = this.config.heartbeatTimeout * 1000;

    for (const session of sessions) {
      switch (session.status) {
        case 'running':
        case 'starting':
          activeSessions++;
          break;
        case 'paused':
          pausedSessions++;
          break;
        case 'failed':
        case 'lost':
          failedSessions++;
          break;
      }

      if (now.getTime() - session.lastHeartbeat.getTime() > heartbeatTimeoutMs) {
        staleInfrastructure++;
      }
    }

    const connectionKeys = await redis.keys(this.getConnectionsKey('*'));
    let totalConnections = 0;
    for (const key of connectionKeys) {
      const count = await redis.sCard(key);
      totalConnections += count;
    }

    return {
      totalSessions: sessions.length,
      activeSessions,
      pausedSessions,
      failedSessions,
      totalConnections,
      staleInfrastructure,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const redis = await this.getRedisClient();
      await redis.ping();
      return true;
    } catch (error) {
      console.error('[RedisSessionStateManager] Health check failed:', error);
      return false;
    }
  }

  // Private helper methods
  private parseBrowserSession(data: Record<string, string>): BrowserSession {
    return {
      id: data.id,
      sessionId: data.sessionId,
      taskId: data.taskId,
      taskArn: data.taskArn || null,
      status: data.status as BrowserSessionStatus,
      startedAt: new Date(data.startedAt),
      updatedAt: new Date(data.updatedAt),
      lastHeartbeat: new Date(data.lastHeartbeat),
      browserUrl: data.browserUrl || null,
      vncUrl: data.vncUrl || null,
      privateIp: data.privateIp || null,
      publicIp: data.publicIp || null,
      itemsProcessed: parseInt(data.itemsProcessed || '0'),
      savedConfigId: data.savedConfigId || undefined,
      healthStatus: data.healthStatus || undefined,
      connectUrl: data.connectUrl || undefined,
      metadata: data.metadata ? JSON.parse(data.metadata) : undefined,
    };
  }

  private getSessionKey(sessionId: string): string {
    return `${this.config.keyPrefix}:session:${sessionId}`;
  }

  private getConnectionsKey(sessionId: string): string {
    return `${this.config.keyPrefix}:connections:${sessionId}`;
  }

  private getConnectionInfoKey(connectionId: string): string {
    return `${this.config.keyPrefix}:connection-info:${connectionId}`;
  }

  // Auto cleanup
  private startAutoCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      Promise.all([
        this.cleanupExpiredSessions(),
        this.cleanupStaleInfrastructure()
      ]).catch((error) => {
        console.error('[RedisSessionStateManager] Auto cleanup error:', error);
      });
    }, this.config.cleanupInterval * 1000);
  }

  private stopAutoCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }

  // Cleanup
  async destroy(): Promise<void> {
    this.stopAutoCleanup();
    this.eventPublisher.destroy();

    if (this.connectionPool.length > 0) {
      console.log(`[RedisSessionStateManager] Closing ${this.connectionPool.length} pooled connections`);
      await Promise.all(
        this.connectionPool.map(async (client, index) => {
          try {
            await client.quit();
            console.log(`[RedisSessionStateManager] Redis Client ${index} closed`);
          } catch (error) {
            console.error(`[RedisSessionStateManager] Error closing Redis Client ${index}:`, error);
          }
        })
      );
      this.connectionPool = [];
      this.poolIndex = 0;
    }
  }
}