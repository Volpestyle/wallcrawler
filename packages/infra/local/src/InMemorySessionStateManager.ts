/**
 * Unified In-Memory Session State Manager - For local development
 * Handles browser sessions as single entities in memory
 */

import {
  ISessionStateManager,
  SessionStateManagerConfig,
  BrowserSession,
  BrowserSessionStatus,
  ConnectionInfo,
  ConnectionType,
  AutomationEvent,
  EventCallback,
  BaseEventPublisher,
} from '@wallcrawler/infra-common';

/**
 * Configuration for in-memory session state manager
 */
export interface InMemorySessionStateConfig extends SessionStateManagerConfig {
  /** Maximum number of sessions to keep in memory */
  maxSessions?: number;
}

/**
 * Unified in-memory session state manager for local development
 * Implements simplified browser session management
 */
export class InMemorySessionStateManager implements ISessionStateManager {
  private readonly config: Required<InMemorySessionStateConfig>;
  private cleanupInterval?: NodeJS.Timeout;
  private readonly eventPublisher: BaseEventPublisher;

  // In-memory storage
  private readonly sessions = new Map<string, BrowserSession>();
  private readonly taskIdMapping = new Map<string, string>(); // taskId -> sessionId
  private readonly connections = new Map<string, Set<string>>(); // sessionId -> Set<connectionId>
  private readonly connectionInfo = new Map<string, ConnectionInfo>(); // connectionId -> ConnectionInfo

  constructor(config: InMemorySessionStateConfig = { backend: 'memory', connectionConfig: {} }) {
    // Initialize event publisher with composition
    this.eventPublisher = new BaseEventPublisher({
      eventRetention: config.sessionTtl ?? 4 * 60 * 60,
      enableLogging: true,
    });

    this.config = {
      backend: config.backend || 'memory',
      connectionConfig: config.connectionConfig || {},
      sessionTtl: config.sessionTtl ?? 4 * 60 * 60, // 4 hours
      taskTtl: config.taskTtl ?? 8 * 60 * 60, // 8 hours
      heartbeatTimeout: config.heartbeatTimeout ?? 5 * 60, // 5 minutes
      cleanupInterval: config.cleanupInterval ?? 60 * 60, // 1 hour
      autoCleanup: config.autoCleanup ?? true,
      maxSessions: config.maxSessions ?? 1000,
      keyPrefix: config.keyPrefix ?? 'memory',
    };

    if (this.config.autoCleanup) {
      this.startAutoCleanup();
    }
  }

  // Browser Session Management
  async createSession(session: BrowserSession): Promise<BrowserSession> {
    await this.ensureCapacity();

    const sessionCopy = { ...session };
    this.sessions.set(session.id, sessionCopy);
    this.taskIdMapping.set(session.taskId, session.id);

    console.log(`[InMemorySessionStateManager] Created session: ${session.id}`);
    return sessionCopy;
  }

  async getSession(sessionId: string): Promise<BrowserSession | undefined> {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    if (this.isSessionExpired(session)) {
      await this.deleteSession(sessionId);
      return undefined;
    }

    return { ...session };
  }

  async getSessionByTaskId(taskId: string): Promise<BrowserSession | undefined> {
    const sessionId = this.taskIdMapping.get(taskId);
    if (!sessionId) return undefined;

    return this.getSession(sessionId);
  }

  async updateSession(sessionId: string, updates: Partial<BrowserSession>): Promise<BrowserSession | undefined> {
    const existing = this.sessions.get(sessionId);
    if (!existing) return undefined;

    const updated: BrowserSession = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    };

    // Update task mapping if taskId changed
    if (updates.taskId && updates.taskId !== existing.taskId) {
      this.taskIdMapping.delete(existing.taskId);
      this.taskIdMapping.set(updates.taskId, sessionId);
    }

    this.sessions.set(sessionId, updated);
    return { ...updated };
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
    const sessions = Array.from(this.sessions.values())
      .filter((session) => !this.isSessionExpired(session))
      .map((session) => ({ ...session }));

    return sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async getSessionsByParentId(parentSessionId: string): Promise<BrowserSession[]> {
    const sessions = Array.from(this.sessions.values())
      .filter((session) => session.sessionId === parentSessionId && !this.isSessionExpired(session))
      .map((session) => ({ ...session }));

    return sessions;
  }

  async getActiveSessions(): Promise<BrowserSession[]> {
    const sessions = Array.from(this.sessions.values())
      .filter(
        (session) => !this.isSessionExpired(session) && (session.status === 'running' || session.status === 'starting')
      )
      .map((session) => ({ ...session }));

    return sessions;
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.taskIdMapping.delete(session.taskId);
    }

    this.sessions.delete(sessionId);
    this.connections.delete(sessionId);

    // Clean up related connection info
    const sessionConnections = this.connections.get(sessionId);
    if (sessionConnections) {
      for (const connectionId of sessionConnections) {
        this.connectionInfo.delete(connectionId);
      }
    }

    console.log(`[InMemorySessionStateManager] Deleted session: ${sessionId}`);
  }

  // Connection Management
  async addConnection(sessionId: string, connectionId: string, type: ConnectionType = 'sse'): Promise<void> {
    let sessionConnections = this.connections.get(sessionId);
    if (!sessionConnections) {
      sessionConnections = new Set();
      this.connections.set(sessionId, sessionConnections);
    }

    sessionConnections.add(connectionId);

    const connectionInfo: ConnectionInfo = {
      connectionId,
      sessionId,
      type,
      connectedAt: new Date(),
      lastActivity: new Date(),
    };

    this.connectionInfo.set(connectionId, connectionInfo);
    await this.updateSession(sessionId, {});

    console.log(`[InMemorySessionStateManager] Added connection ${connectionId} to session ${sessionId}`);
  }

  async removeConnection(sessionId: string, connectionId: string): Promise<void> {
    const sessionConnections = this.connections.get(sessionId);
    if (sessionConnections) {
      sessionConnections.delete(connectionId);
      if (sessionConnections.size === 0) {
        this.connections.delete(sessionId);
      }
    }

    this.connectionInfo.delete(connectionId);
    console.log(`[InMemorySessionStateManager] Removed connection ${connectionId} from session ${sessionId}`);
  }

  async getConnections(sessionId: string): Promise<string[]> {
    const sessionConnections = this.connections.get(sessionId);
    return sessionConnections ? Array.from(sessionConnections) : [];
  }

  async getConnectionInfo(connectionId: string): Promise<ConnectionInfo | undefined> {
    const info = this.connectionInfo.get(connectionId);
    return info ? { ...info } : undefined;
  }

  // Event Management
  async publishEvent(sessionId: string, event: AutomationEvent): Promise<void> {
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
    const now = new Date();
    const sessionTtlMs = this.config.sessionTtl * 1000;

    let cleanedCount = 0;
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now.getTime() - session.updatedAt.getTime() > sessionTtlMs) {
        await this.deleteSession(sessionId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`[InMemorySessionStateManager] Cleaned up ${cleanedCount} expired sessions`);
    }
  }

  async cleanupStaleInfrastructure(): Promise<void> {
    const now = new Date();
    const heartbeatTimeoutMs = this.config.heartbeatTimeout * 1000;

    let staleCount = 0;
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now.getTime() - session.lastHeartbeat.getTime() > heartbeatTimeoutMs) {
        // Mark as lost but don't delete immediately
        await this.updateSession(sessionId, { status: 'lost' });
        staleCount++;
      }
    }

    if (staleCount > 0) {
      console.log(`[InMemorySessionStateManager] Marked ${staleCount} sessions as lost due to stale infrastructure`);
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

    const totalConnections = Array.from(this.connections.values()).reduce(
      (total, connections) => total + connections.size,
      0
    );

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
    return true; // In-memory implementation is always healthy if the object exists
  }

  // Private helper methods
  private isSessionExpired(session: BrowserSession): boolean {
    const now = new Date();
    const lastActive = session.updatedAt;
    const ttlMs = this.config.sessionTtl * 1000;
    return now.getTime() - lastActive.getTime() > ttlMs;
  }

  private async ensureCapacity(): Promise<void> {
    if (this.sessions.size >= this.config.maxSessions) {
      const sessions = Array.from(this.sessions.entries()).sort(
        ([, a], [, b]) => a.updatedAt.getTime() - b.updatedAt.getTime()
      );

      const toRemove = sessions.slice(0, Math.ceil(this.config.maxSessions * 0.1)); // Remove 10%
      for (const [sessionId] of toRemove) {
        await this.deleteSession(sessionId);
      }
    }
  }

  private startAutoCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      Promise.all([this.cleanupExpiredSessions(), this.cleanupStaleInfrastructure()]).catch((error) => {
        console.error('[InMemorySessionStateManager] Auto cleanup error:', error);
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

    this.sessions.clear();
    this.taskIdMapping.clear();
    this.connections.clear();
    this.connectionInfo.clear();

    console.log('[InMemorySessionStateManager] Destroyed and cleared all data');
  }
}
