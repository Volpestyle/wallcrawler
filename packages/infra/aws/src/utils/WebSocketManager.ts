/**
 * WebSocket Manager for AWS API Gateway
 * Manages real-time communication with browser automation clients
 */

import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
  DeleteConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';

import { FrameStreamMessage, WebSocketConnectionData } from '../types';

export interface WebSocketManagerConfig {
  region: string;
  apiId: string;
  stage: string;
  endpoint?: string;
  enabled?: boolean;
}

/**
 * Manages WebSocket connections and messaging via API Gateway
 */
export class WebSocketManager {
  private readonly client: ApiGatewayManagementApiClient;
  private readonly config: WebSocketManagerConfig;
  private readonly endpoint: string;

  constructor(config: WebSocketManagerConfig) {
    this.config = config;

    // Build endpoint URL if not provided
    this.endpoint =
      config.endpoint || `https://${config.apiId}.execute-api.${config.region}.amazonaws.com/${config.stage}`;

    this.client = new ApiGatewayManagementApiClient({
      region: config.region,
      endpoint: this.endpoint,
    });
  }

  // =============================================================================
  // Connection Management
  // =============================================================================

  async sendMessageToConnection(connectionId: string, message: any): Promise<boolean> {
    if (!this.config.enabled) {
      console.log('[WebSocketManager] WebSocket messaging is disabled');
      return false;
    }

    try {
      const command = new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: typeof message === 'string' ? message : JSON.stringify(message),
      });

      await this.client.send(command);
      return true;
    } catch (error: any) {
      if (error.statusCode === 410) {
        // Connection is stale, should be removed
        console.log(`[WebSocketManager] Connection ${connectionId} is stale, removing`);
        await this.removeConnection(connectionId);
        return false;
      }

      console.error(`[WebSocketManager] Failed to send message to connection ${connectionId}:`, error);
      return false;
    }
  }

  async sendMessageToAllConnections(
    connectionIds: string[],
    message: any
  ): Promise<{
    successful: number;
    failed: number;
    staleConnections: string[];
  }> {
    if (!this.config.enabled) {
      return { successful: 0, failed: 0, staleConnections: [] };
    }

    console.log(`[WebSocketManager] Sending message to ${connectionIds.length} connections`);

    const results = await Promise.allSettled(
      connectionIds.map((connectionId) => this.sendMessageToConnection(connectionId, message))
    );

    let successful = 0;
    let failed = 0;
    const staleConnections: string[] = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) {
        successful++;
      } else {
        failed++;
        // Connection might be stale if the send failed
        staleConnections.push(connectionIds[index]);
      }
    });

    console.log(`[WebSocketManager] Message sent - Success: ${successful}, Failed: ${failed}`);

    return { successful, failed, staleConnections };
  }

  async removeConnection(connectionId: string): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    try {
      const command = new DeleteConnectionCommand({
        ConnectionId: connectionId,
      });

      await this.client.send(command);
      console.log(`[WebSocketManager] Removed connection: ${connectionId}`);
    } catch (error) {
      console.error(`[WebSocketManager] Failed to remove connection ${connectionId}:`, error);
    }
  }

  // =============================================================================
  // Frame Streaming
  // =============================================================================

  async streamFrame(
    sessionId: string,
    connectionIds: string[],
    frameData: string | Buffer,
    timestamp?: string
  ): Promise<{ successful: number; failed: number }> {
    const frameMessage: FrameStreamMessage = {
      type: 'frame',
      sessionId,
      timestamp: timestamp || new Date().toISOString(),
      data: frameData,
    };

    const result = await this.sendMessageToAllConnections(connectionIds, frameMessage);
    return { successful: result.successful, failed: result.failed };
  }

  async streamEvent(
    sessionId: string,
    connectionIds: string[],
    eventType: string,
    eventData: any
  ): Promise<{ successful: number; failed: number }> {
    const eventMessage: FrameStreamMessage = {
      type: 'event',
      sessionId,
      timestamp: new Date().toISOString(),
      data: {
        eventType,
        ...eventData,
      },
    };

    const result = await this.sendMessageToAllConnections(connectionIds, eventMessage);
    return { successful: result.successful, failed: result.failed };
  }

  async streamStatus(
    sessionId: string,
    connectionIds: string[],
    status: string,
    metadata?: any
  ): Promise<{ successful: number; failed: number }> {
    const statusMessage: FrameStreamMessage = {
      type: 'status',
      sessionId,
      timestamp: new Date().toISOString(),
      data: {
        status,
        ...metadata,
      },
    };

    const result = await this.sendMessageToAllConnections(connectionIds, statusMessage);
    return { successful: result.successful, failed: result.failed };
  }

  // =============================================================================
  // Broadcast Utilities
  // =============================================================================

  async broadcastToSession(
    sessionId: string,
    connectionIds: string[],
    messageType: 'frame' | 'event' | 'status',
    data: any
  ): Promise<{ successful: number; failed: number; staleConnections: string[] }> {
    if (connectionIds.length === 0) {
      return { successful: 0, failed: 0, staleConnections: [] };
    }

    const message: FrameStreamMessage = {
      type: messageType,
      sessionId,
      timestamp: new Date().toISOString(),
      data,
    };

    return await this.sendMessageToAllConnections(connectionIds, message);
  }

  async sendHeartbeat(connectionIds: string[]): Promise<void> {
    if (!this.config.enabled || connectionIds.length === 0) {
      return;
    }

    const heartbeatMessage = {
      type: 'heartbeat',
      timestamp: new Date().toISOString(),
    };

    await this.sendMessageToAllConnections(connectionIds, heartbeatMessage);
  }

  // =============================================================================
  // Connection Health
  // =============================================================================

  async testConnection(connectionId: string): Promise<boolean> {
    const testMessage = {
      type: 'ping',
      timestamp: new Date().toISOString(),
    };

    return await this.sendMessageToConnection(connectionId, testMessage);
  }

  async cleanupStaleConnections(connectionIds: string[]): Promise<string[]> {
    if (!this.config.enabled) {
      return [];
    }

    console.log(`[WebSocketManager] Testing ${connectionIds.length} connections for staleness`);

    const testResults = await Promise.allSettled(
      connectionIds.map(async (connectionId) => {
        const isHealthy = await this.testConnection(connectionId);
        return { connectionId, isHealthy };
      })
    );

    const staleConnections: string[] = [];

    testResults.forEach((result) => {
      if (result.status === 'fulfilled' && !result.value.isHealthy) {
        staleConnections.push(result.value.connectionId);
      }
    });

    // Remove stale connections
    if (staleConnections.length > 0) {
      console.log(`[WebSocketManager] Removing ${staleConnections.length} stale connections`);

      await Promise.allSettled(staleConnections.map((connectionId) => this.removeConnection(connectionId)));
    }

    return staleConnections;
  }

  // =============================================================================
  // Monitoring and Analytics
  // =============================================================================

  async getConnectionStats(): Promise<{
    endpoint: string;
    isEnabled: boolean;
    apiId: string;
    stage: string;
    region: string;
  }> {
    return {
      endpoint: this.endpoint,
      isEnabled: this.config.enabled || false,
      apiId: this.config.apiId,
      stage: this.config.stage,
      region: this.config.region,
    };
  }

  // =============================================================================
  // Configuration and Utilities
  // =============================================================================

  isEnabled(): boolean {
    return this.config.enabled && !!this.config.apiId;
  }

  getEndpoint(): string {
    return this.endpoint;
  }

  getConfig(): WebSocketManagerConfig {
    return { ...this.config };
  }

  async cleanup(): Promise<void> {
    console.log('[WebSocketManager] Cleaning up WebSocket manager...');
    // No persistent connections to clean up for API Gateway WebSocket
    // All cleanup is handled by the API Gateway service
  }

  // =============================================================================
  // Helper Methods for Integration
  // =============================================================================

  createConnectionUrl(sessionId?: string): string {
    const wsEndpoint = this.endpoint.replace('https://', 'wss://');
    return sessionId ? `${wsEndpoint}?sessionId=${sessionId}` : wsEndpoint;
  }

  async sendCustomMessage(
    connectionIds: string[],
    messageType: string,
    payload: any
  ): Promise<{ successful: number; failed: number; staleConnections: string[] }> {
    const message = {
      type: messageType,
      timestamp: new Date().toISOString(),
      payload,
    };

    return await this.sendMessageToAllConnections(connectionIds, message);
  }

  async notifySessionStart(connectionIds: string[], sessionId: string, taskId: string, metadata?: any): Promise<void> {
    await this.streamEvent(sessionId, connectionIds, 'session_started', {
      taskId,
      metadata,
    });
  }

  async notifySessionStop(connectionIds: string[], sessionId: string, reason?: string): Promise<void> {
    await this.streamEvent(sessionId, connectionIds, 'session_stopped', {
      reason,
    });
  }

  async notifyError(connectionIds: string[], sessionId: string, error: string, details?: any): Promise<void> {
    await this.streamEvent(sessionId, connectionIds, 'error', {
      error,
      details,
    });
  }
}
