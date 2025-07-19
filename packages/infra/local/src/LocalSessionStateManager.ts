/**
 * Local Session State Manager
 * In-memory implementation for managing browser automation sessions
 * Provides a simple alternative to AWS Redis-based session management
 */

import {
    ISessionStateManager,
    BrowserSession,
    BrowserSessionStatus,
    ConnectionInfo,
    ConnectionType,
} from '@wallcrawler/infra-common';

/**
 * In-memory session state manager for local development
 */
export class LocalSessionStateManager implements ISessionStateManager {
    private sessions = new Map<string, BrowserSession>();
    private sessionsByTaskId = new Map<string, string>(); // taskId -> sessionId
    private sessionsByParent = new Map<string, Set<string>>(); // parentId -> Set<sessionId>
    private connections = new Map<string, Set<string>>(); // sessionId -> Set<connectionId>
    private connectionInfo = new Map<string, ConnectionInfo>(); // connectionId -> ConnectionInfo

    constructor() {
        console.log('[LocalSessionStateManager] Initialized in-memory session manager');
    }

    // =============================================================================
    // Browser Session Management
    // =============================================================================

    async createSession(session: BrowserSession): Promise<BrowserSession> {
        console.log(`[LocalSessionStateManager] Creating session: ${session.id}`);

        this.sessions.set(session.id, { ...session });

        // Index by task ID
        if (session.taskId) {
            this.sessionsByTaskId.set(session.taskId, session.id);
        }

        // Index by parent session ID
        if (session.sessionId && session.sessionId !== session.id) {
            if (!this.sessionsByParent.has(session.sessionId)) {
                this.sessionsByParent.set(session.sessionId, new Set());
            }
            this.sessionsByParent.get(session.sessionId)!.add(session.id);
        }

        return { ...session };
    }

    async getSession(sessionId: string): Promise<BrowserSession | undefined> {
        const session = this.sessions.get(sessionId);
        return session ? { ...session } : undefined;
    }

    async getSessionByTaskId(taskId: string): Promise<BrowserSession | undefined> {
        const sessionId = this.sessionsByTaskId.get(taskId);
        if (!sessionId) {
            return undefined;
        }
        return this.getSession(sessionId);
    }

    async updateSession(sessionId: string, updates: Partial<BrowserSession>): Promise<BrowserSession | undefined> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return undefined;
        }

        const updatedSession = {
            ...session,
            ...updates,
            updatedAt: new Date(),
        };

        this.sessions.set(sessionId, updatedSession);

        // Update task ID index if changed
        if (updates.taskId && updates.taskId !== session.taskId) {
            if (session.taskId) {
                this.sessionsByTaskId.delete(session.taskId);
            }
            this.sessionsByTaskId.set(updates.taskId, sessionId);
        }

        console.log(`[LocalSessionStateManager] Updated session: ${sessionId}`);
        return { ...updatedSession };
    }

    async updateSessionStatus(
        sessionId: string,
        status: BrowserSessionStatus,
        metadata?: Record<string, unknown>
    ): Promise<void> {
        await this.updateSession(sessionId, {
            status,
            metadata: metadata ? { ...this.sessions.get(sessionId)?.metadata, ...metadata } : undefined,
        });
    }

    async recordHeartbeat(sessionId: string): Promise<void> {
        await this.updateSession(sessionId, {
            lastHeartbeat: new Date(),
        });
    }

    async getAllSessions(): Promise<BrowserSession[]> {
        return Array.from(this.sessions.values()).map(session => ({ ...session }));
    }

    async getSessionsByParentId(parentSessionId: string): Promise<BrowserSession[]> {
        const sessionIds = this.sessionsByParent.get(parentSessionId);
        if (!sessionIds) {
            return [];
        }

        const sessions: BrowserSession[] = [];
        for (const sessionId of sessionIds) {
            const session = await this.getSession(sessionId);
            if (session) {
                sessions.push(session);
            }
        }

        return sessions;
    }

    async getActiveSessions(): Promise<BrowserSession[]> {
        const allSessions = await this.getAllSessions();
        return allSessions.filter(session =>
            session.status === 'running' || session.status === 'starting'
        );
    }

    async deleteSession(sessionId: string): Promise<void> {
        console.log(`[LocalSessionStateManager] Deleting session: ${sessionId}`);

        const session = this.sessions.get(sessionId);
        if (!session) {
            return;
        }

        // Remove from main sessions map
        this.sessions.delete(sessionId);

        // Remove from task ID index
        if (session.taskId) {
            this.sessionsByTaskId.delete(session.taskId);
        }

        // Remove from parent session index
        if (session.sessionId && session.sessionId !== session.id) {
            const parentSessions = this.sessionsByParent.get(session.sessionId);
            if (parentSessions) {
                parentSessions.delete(sessionId);
                if (parentSessions.size === 0) {
                    this.sessionsByParent.delete(session.sessionId);
                }
            }
        }

        // Remove connections
        this.connections.delete(sessionId);
    }

    // =============================================================================
    // Connection Management
    // =============================================================================

    async addConnection(sessionId: string, connectionId: string, type: ConnectionType = 'websocket'): Promise<void> {
        console.log(`[LocalSessionStateManager] Adding connection: ${connectionId} to session: ${sessionId}`);

        if (!this.connections.has(sessionId)) {
            this.connections.set(sessionId, new Set());
        }

        this.connections.get(sessionId)!.add(connectionId);

        this.connectionInfo.set(connectionId, {
            connectionId,
            sessionId,
            type,
            connectedAt: new Date(),
            lastActivity: new Date(),
        });
    }

    async removeConnection(sessionId: string, connectionId: string): Promise<void> {
        console.log(`[LocalSessionStateManager] Removing connection: ${connectionId} from session: ${sessionId}`);

        const sessionConnections = this.connections.get(sessionId);
        if (sessionConnections) {
            sessionConnections.delete(connectionId);
            if (sessionConnections.size === 0) {
                this.connections.delete(sessionId);
            }
        }

        this.connectionInfo.delete(connectionId);
    }

    async getConnections(sessionId: string): Promise<string[]> {
        const connections = this.connections.get(sessionId);
        return connections ? Array.from(connections) : [];
    }

    async getConnectionInfo(connectionId: string): Promise<ConnectionInfo | undefined> {
        const info = this.connectionInfo.get(connectionId);
        return info ? { ...info } : undefined;
    }

    // =============================================================================
    // Cleanup and Maintenance
    // =============================================================================

    async cleanupExpiredSessions(): Promise<void> {
        console.log('[LocalSessionStateManager] Cleaning up expired sessions');

        const now = new Date();
        const sessionTtl = 4 * 60 * 60 * 1000; // 4 hours in milliseconds

        const expiredSessions: string[] = [];

        for (const [sessionId, session] of this.sessions) {
            const timeSinceUpdate = now.getTime() - session.updatedAt.getTime();
            if (timeSinceUpdate > sessionTtl) {
                expiredSessions.push(sessionId);
            }
        }

        for (const sessionId of expiredSessions) {
            await this.deleteSession(sessionId);
        }

        console.log(`[LocalSessionStateManager] Cleaned up ${expiredSessions.length} expired sessions`);
    }

    async cleanupStaleInfrastructure(): Promise<void> {
        console.log('[LocalSessionStateManager] Cleaning up stale infrastructure');

        const now = new Date();
        const heartbeatTimeout = 10 * 60 * 1000; // 10 minutes in milliseconds

        const staleSessions: string[] = [];

        for (const [sessionId, session] of this.sessions) {
            const timeSinceHeartbeat = now.getTime() - session.lastHeartbeat.getTime();
            if (timeSinceHeartbeat > heartbeatTimeout && session.status !== 'stopped') {
                staleSessions.push(sessionId);
            }
        }

        for (const sessionId of staleSessions) {
            await this.updateSessionStatus(sessionId, 'lost');
        }

        console.log(`[LocalSessionStateManager] Marked ${staleSessions.length} sessions as lost due to stale heartbeat`);
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
        const activeSessions = sessions.filter(s => s.status === 'running' || s.status === 'starting').length;
        const pausedSessions = sessions.filter(s => s.status === 'paused').length;
        const failedSessions = sessions.filter(s => s.status === 'failed').length;

        let totalConnections = 0;
        for (const connections of this.connections.values()) {
            totalConnections += connections.size;
        }

        // Calculate stale infrastructure
        const now = new Date();
        const heartbeatTimeout = 10 * 60 * 1000; // 10 minutes
        const staleInfrastructure = sessions.filter(session => {
            const timeSinceHeartbeat = now.getTime() - session.lastHeartbeat.getTime();
            return timeSinceHeartbeat > heartbeatTimeout && session.status !== 'stopped';
        }).length;

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
        // For local provider, always healthy
        return true;
    }
} 