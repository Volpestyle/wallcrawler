import { 
  ApiGatewayManagementApiClient, 
  PostToConnectionCommand,
  GetConnectionCommand
} from '@aws-sdk/client-apigatewaymanagementapi';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  PutCommand, 
  GetCommand, 
  UpdateCommand,
  DeleteCommand,
  QueryCommand
} from '@aws-sdk/lib-dynamodb';
import { EventEmitter } from 'eventemitter3';
import { 
  PortalTransport,
  PortalTransportConfig,
  PortalAuthInfo,
  PortalTransportCapabilities,
  PortalMessage,
  PortalTransportError,
  CreateSessionConfig,
  PortalConnectionInfo
} from 'wallcrawler/types/portal-transport';
import {
  PortalSession,
  PortalBrowserState,
  PortalCommand,
  PortalEvent,
  PortalStats
} from 'wallcrawler/types/portal';
import { createLogger } from 'wallcrawler/utils/logger';
import { generatePortalUrl } from './utils/portal';

const logger = createLogger('aws-portal-transport');

/**
 * AWS Portal Transport
 * 
 * Provides portal functionality using AWS services:
 * - API Gateway WebSocket for real-time communication
 * - DynamoDB for session and connection management
 * - CloudFront for serving portal web UI
 * - Lambda for handling portal operations
 */
export class AWSPortalTransport extends EventEmitter implements PortalTransport {
  private config: PortalTransportConfig | null = null;
  private apiGatewayClient: ApiGatewayManagementApiClient | null = null;
  private dynamoClient: DynamoDBDocumentClient;
  private connectionInfo: PortalConnectionInfo | null = null;
  private sessionsTable: string;
  private connectionsTable: string;
  private statsTable: string;

  constructor(
    region: string = 'us-east-1',
    sessionsTable: string = 'wallcrawler-portal-sessions',
    connectionsTable: string = 'wallcrawler-portal-connections',
    statsTable: string = 'wallcrawler-portal-stats'
  ) {
    super();
    
    const dynamodbClient = new DynamoDBClient({ region });
    this.dynamoClient = DynamoDBDocumentClient.from(dynamodbClient);
    this.sessionsTable = sessionsTable;
    this.connectionsTable = connectionsTable;
    this.statsTable = statsTable;
  }

  async initialize(config: PortalTransportConfig): Promise<void> {
    this.config = config;
    
    // Initialize API Gateway client if we have the endpoint
    if (config.aws?.apiGatewayId && config.aws?.stage) {
      const endpoint = `https://${config.aws.apiGatewayId}.execute-api.${config.aws.region}.amazonaws.com/${config.aws.stage}`;
      this.apiGatewayClient = new ApiGatewayManagementApiClient({
        region: config.aws.region,
        endpoint
      });
    }

    logger.info('AWS portal transport initialized', {
      region: config.aws?.region,
      apiGatewayId: config.aws?.apiGatewayId,
      stage: config.aws?.stage
    });
  }

  async connect(sessionId: string, auth?: PortalAuthInfo): Promise<PortalConnectionInfo> {
    if (!this.config) {
      throw new PortalTransportError('Transport not initialized', 'CONFIGURATION_ERROR');
    }

    try {
      // Create connection info
      this.connectionInfo = {
        connectionId: `aws-${sessionId}-${Date.now()}`,
        protocol: 'websocket',
        endpoint: this.config.aws?.apiGatewayId 
          ? `wss://${this.config.aws.apiGatewayId}.execute-api.${this.config.aws.region}.amazonaws.com/${this.config.aws.stage}/`
          : 'wss://portal.wallcrawler.com/ws',
        authenticationType: auth ? 'token' : 'session',
        connectedAt: Date.now(),
        lastPingAt: Date.now()
      };

      // Store connection in DynamoDB
      await this.dynamoClient.send(new PutCommand({
        TableName: this.connectionsTable,
        Item: {
          PK: `CONNECTION#${this.connectionInfo.connectionId}`,
          SK: `SESSION#${sessionId}`,
          connectionId: this.connectionInfo.connectionId,
          sessionId,
          endpoint: this.connectionInfo.endpoint,
          protocol: this.connectionInfo.protocol,
          connectedAt: this.connectionInfo.connectedAt,
          lastPingAt: this.connectionInfo.lastPingAt,
          authType: this.connectionInfo.authenticationType,
          ttl: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours TTL
        }
      }));

      logger.info('Connected to AWS portal', {
        sessionId,
        connectionId: this.connectionInfo.connectionId,
        endpoint: this.connectionInfo.endpoint
      });

      this.emit('connected', this.connectionInfo);
      return this.connectionInfo;

    } catch (error) {
      logger.error('Failed to connect to AWS portal', error);
      throw new PortalTransportError(
        `Failed to connect: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'CONNECTION_FAILED'
      );
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connectionInfo) {
      return;
    }

    try {
      // Remove connection from DynamoDB
      await this.dynamoClient.send(new DeleteCommand({
        TableName: this.connectionsTable,
        Key: {
          PK: `CONNECTION#${this.connectionInfo.connectionId}`,
          SK: `SESSION#${this.connectionInfo.connectionId.split('-')[1]}`
        }
      }));

      logger.info('Disconnected from AWS portal', {
        connectionId: this.connectionInfo.connectionId
      });

      this.connectionInfo = null;
      this.emit('disconnected');

    } catch (error) {
      logger.error('Error disconnecting from AWS portal', error);
    }
  }

  async sendBrowserState(state: PortalBrowserState): Promise<void> {
    const message: PortalMessage = {
      id: this.generateMessageId(),
      type: 'browser-state',
      timestamp: Date.now(),
      sessionId: state.sessionId,
      payload: state,
      metadata: {
        source: 'aws-transport',
        version: '1.0.0'
      }
    };

    await this.broadcastToSession(state.sessionId, message);
  }

  async sendEvent(event: PortalEvent): Promise<void> {
    const message: PortalMessage = {
      id: this.generateMessageId(),
      type: 'event',
      timestamp: Date.now(),
      sessionId: event.payload?.sessionId || 'unknown',
      payload: event,
      metadata: {
        source: 'aws-transport',
        version: '1.0.0'
      }
    };

    await this.broadcastToSession(message.sessionId, message);
  }

  onCommand(handler: (command: PortalCommand) => void): void {
    this.on('command', handler);
  }

  onConnectionChange(handler: (connected: boolean, info?: PortalConnectionInfo) => void): void {
    this.on('connected', (info) => handler(true, info));
    this.on('disconnected', () => handler(false));
  }

  onError(handler: (error: Error) => void): void {
    this.on('error', handler);
  }

  getConnectionInfo(): PortalConnectionInfo | null {
    return this.connectionInfo;
  }

  isConnected(): boolean {
    return this.connectionInfo !== null;
  }

  getCapabilities(): PortalTransportCapabilities {
    return {
      supportsRealTimeUpdates: true,
      supportsBidirectionalCommunication: true,
      supportsFileTransfer: true,
      supportsVideoStreaming: false,
      supportsAuthentication: true,
      supportsEncryption: true,
      maxConcurrentConnections: 1000,
      maxMessageSize: 256 * 1024, // 256KB (API Gateway limit)
      averageLatency: 100,
      reliability: 'high',
      protocol: 'wss',
      version: '1.0.0',
      features: ['real-time', 'scalable', 'secure', 'managed']
    };
  }

  async createSession(config: CreateSessionConfig): Promise<PortalSession> {
    const session: PortalSession = {
      sessionId: config.sessionId,
      userId: config.userId,
      status: 'pending',
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      expiresAt: Date.now() + (config.timeoutMs || 30 * 60 * 1000),
      portalUrl: await generatePortalUrl(config.sessionId, config.sessionId),
      connectionId: this.connectionInfo?.connectionId
    };

    // Store session in DynamoDB
    await this.dynamoClient.send(new PutCommand({
      TableName: this.sessionsTable,
      Item: {
        PK: `SESSION#${config.sessionId}`,
        SK: `SESSION#${config.sessionId}`,
        ...session,
        config: config.config,
        metadata: config.metadata,
        ttl: Math.floor(session.expiresAt / 1000)
      }
    }));

    // Initialize stats
    await this.dynamoClient.send(new PutCommand({
      TableName: this.statsTable,
      Item: {
        PK: `STATS#${config.sessionId}`,
        SK: `STATS#${config.sessionId}`,
        sessionId: config.sessionId,
        totalDuration: 0,
        manualControlDuration: 0,
        actionsExecuted: 0,
        interventionsHandled: 0,
        averageResponseTime: 0,
        dataTransferred: 0,
        screenshotsTaken: 0,
        connectionDrops: 0,
        reconnections: 0,
        averageLatency: 0,
        createdAt: Date.now(),
        ttl: Math.floor((Date.now() + (7 * 24 * 60 * 60 * 1000)) / 1000) // 7 days
      }
    }));

    logger.info('AWS portal session created', {
      sessionId: config.sessionId,
      portalUrl: session.portalUrl
    });

    this.emit('sessionCreated', session);
    return session;
  }

  async getSession(sessionId: string): Promise<PortalSession | null> {
    try {
      const response = await this.dynamoClient.send(new GetCommand({
        TableName: this.sessionsTable,
        Key: {
          PK: `SESSION#${sessionId}`,
          SK: `SESSION#${sessionId}`
        }
      }));

      if (!response.Item) {
        return null;
      }

      const { PK, SK, config, metadata, ttl, ...session } = response.Item;
      return session as PortalSession;

    } catch (error) {
      logger.error('Error getting session from DynamoDB', error);
      return null;
    }
  }

  async updateSession(sessionId: string, updates: Partial<PortalSession>): Promise<PortalSession> {
    try {
      const updateExpression: string[] = [];
      const expressionAttributeNames: Record<string, string> = {};
      const expressionAttributeValues: Record<string, any> = {};

      // Build update expression
      Object.entries(updates).forEach(([key, value], index) => {
        const nameKey = `#attr${index}`;
        const valueKey = `:val${index}`;
        
        updateExpression.push(`${nameKey} = ${valueKey}`);
        expressionAttributeNames[nameKey] = key;
        expressionAttributeValues[valueKey] = value;
      });

      // Add lastActiveAt
      const lastActiveKey = `#attr${Object.keys(updates).length}`;
      const lastActiveValue = `:val${Object.keys(updates).length}`;
      updateExpression.push(`${lastActiveKey} = ${lastActiveValue}`);
      expressionAttributeNames[lastActiveKey] = 'lastActiveAt';
      expressionAttributeValues[lastActiveValue] = Date.now();

      const response = await this.dynamoClient.send(new UpdateCommand({
        TableName: this.sessionsTable,
        Key: {
          PK: `SESSION#${sessionId}`,
          SK: `SESSION#${sessionId}`
        },
        UpdateExpression: `SET ${updateExpression.join(', ')}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: 'ALL_NEW'
      }));

      if (!response.Attributes) {
        throw new PortalTransportError(`Session ${sessionId} not found`, 'SESSION_NOT_FOUND');
      }

      const { PK, SK, config, metadata, ttl, ...session } = response.Attributes;
      return session as PortalSession;

    } catch (error) {
      logger.error('Error updating session in DynamoDB', error);
      if (error instanceof PortalTransportError) {
        throw error;
      }
      throw new PortalTransportError(
        `Failed to update session: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'UNKNOWN_ERROR'
      );
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      // Update session status
      await this.updateSession(sessionId, { status: 'closed' });

      // Close any active connections for this session
      await this.closeSessionConnections(sessionId);

      logger.info('AWS portal session closed', { sessionId });

    } catch (error) {
      logger.error('Error closing AWS portal session', error);
    }
  }

  async getStats(sessionId: string): Promise<PortalStats> {
    try {
      const response = await this.dynamoClient.send(new GetCommand({
        TableName: this.statsTable,
        Key: {
          PK: `STATS#${sessionId}`,
          SK: `STATS#${sessionId}`
        }
      }));

      if (!response.Item) {
        throw new PortalTransportError(`Stats for session ${sessionId} not found`, 'SESSION_NOT_FOUND');
      }

      const { PK, SK, ttl, createdAt, ...stats } = response.Item;
      return stats as PortalStats;

    } catch (error) {
      logger.error('Error getting stats from DynamoDB', error);
      if (error instanceof PortalTransportError) {
        throw error;
      }
      throw new PortalTransportError(
        `Failed to get stats: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'UNKNOWN_ERROR'
      );
    }
  }

  async cleanup(): Promise<void> {
    // Cleanup is handled automatically by DynamoDB TTL
    this.removeAllListeners();
    logger.info('AWS portal transport cleanup completed');
  }

  /**
   * Handle incoming WebSocket command (called by Lambda function)
   */
  async handleWebSocketCommand(connectionId: string, command: PortalCommand): Promise<void> {
    try {
      // Verify connection exists
      const connection = await this.getConnectionInfo(connectionId);
      if (!connection) {
        logger.warn('Command received for unknown connection', { connectionId });
        return;
      }

      // Update connection activity
      await this.updateConnectionActivity(connectionId);

      // Emit command for processing
      this.emit('command', command);

      // Send immediate acknowledgment
      await this.sendCommandResponse(connectionId, {
        commandId: command.id || 'unknown',
        commandType: command.type,
        success: true,
        message: 'Command received',
        timestamp: Date.now()
      });

      logger.debug('WebSocket command processed', {
        connectionId,
        commandType: command.type,
        commandId: command.id
      });

    } catch (error) {
      logger.error('Error handling WebSocket command', error);
      this.emit('error', error as Error);
    }
  }

  /**
   * Handle WebSocket connection (called by Lambda function)
   */
  async handleWebSocketConnection(connectionId: string, sessionId: string): Promise<void> {
    try {
      // Store connection info
      await this.dynamoClient.send(new PutCommand({
        TableName: this.connectionsTable,
        Item: {
          PK: `CONNECTION#${connectionId}`,
          SK: `SESSION#${sessionId}`,
          connectionId,
          sessionId,
          connectedAt: Date.now(),
          lastPingAt: Date.now(),
          ttl: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours TTL
        }
      }));

      // Update session status
      await this.updateSession(sessionId, { status: 'connected' });

      logger.info('WebSocket connection established', { connectionId, sessionId });
      this.emit('connected', { connectionId, sessionId });

    } catch (error) {
      logger.error('Error handling WebSocket connection', error);
    }
  }

  /**
   * Handle WebSocket disconnection (called by Lambda function)
   */
  async handleWebSocketDisconnection(connectionId: string): Promise<void> {
    try {
      // Get connection info before deleting
      const connection = await this.getConnectionInfo(connectionId);
      
      // Remove connection
      if (connection) {
        await this.dynamoClient.send(new DeleteCommand({
          TableName: this.connectionsTable,
          Key: {
            PK: `CONNECTION#${connectionId}`,
            SK: `SESSION#${connection.sessionId}`
          }
        }));

        logger.info('WebSocket disconnection handled', { 
          connectionId, 
          sessionId: connection.sessionId 
        });
      }

    } catch (error) {
      logger.error('Error handling WebSocket disconnection', error);
    }
  }

  private async broadcastToSession(sessionId: string, message: PortalMessage): Promise<void> {
    if (!this.apiGatewayClient) {
      logger.warn('API Gateway client not initialized, cannot broadcast message');
      return;
    }

    try {
      // Get all connections for this session
      const connections = await this.getSessionConnections(sessionId);
      
      const messageData = JSON.stringify(message);

      // Send to all connections
      const sendPromises = connections.map(async (connection) => {
        try {
          await this.apiGatewayClient!.send(new PostToConnectionCommand({
            ConnectionId: connection.connectionId,
            Data: messageData
          }));
        } catch (error: any) {
          if (error.statusCode === 410) {
            // Connection is stale, remove it
            await this.removeStaleConnection(connection.connectionId, sessionId);
          } else {
            logger.error('Error sending message to connection', {
              connectionId: connection.connectionId,
              error
            });
          }
        }
      });

      await Promise.allSettled(sendPromises);

    } catch (error) {
      logger.error('Error broadcasting message to session', error);
    }
  }

  private async getSessionConnections(sessionId: string): Promise<Array<{ connectionId: string; sessionId: string }>> {
    try {
      const response = await this.dynamoClient.send(new QueryCommand({
        TableName: this.connectionsTable,
        IndexName: 'SessionIdIndex', // Assumes GSI exists
        KeyConditionExpression: 'sessionId = :sessionId',
        ExpressionAttributeValues: {
          ':sessionId': sessionId
        }
      }));

      return (response.Items || []).map(item => ({
        connectionId: item.connectionId,
        sessionId: item.sessionId
      }));

    } catch (error) {
      logger.error('Error getting session connections', error);
      return [];
    }
  }

  private async closeSessionConnections(sessionId: string): Promise<void> {
    if (!this.apiGatewayClient) {
      return;
    }

    try {
      const connections = await this.getSessionConnections(sessionId);

      for (const connection of connections) {
        try {
          // Close the WebSocket connection
          await this.apiGatewayClient.send(new PostToConnectionCommand({
            ConnectionId: connection.connectionId,
            Data: JSON.stringify({
              type: 'close',
              reason: 'Session closed'
            })
          }));

          // Remove from DynamoDB
          await this.dynamoClient.send(new DeleteCommand({
            TableName: this.connectionsTable,
            Key: {
              PK: `CONNECTION#${connection.connectionId}`,
              SK: `SESSION#${sessionId}`
            }
          }));

        } catch (error: any) {
          if (error.statusCode !== 410) { // Ignore if already disconnected
            logger.error('Error closing session connection', {
              connectionId: connection.connectionId,
              error
            });
          }
        }
      }

    } catch (error) {
      logger.error('Error closing session connections', error);
    }
  }

  private async getConnectionInfo(connectionId: string): Promise<{ sessionId: string } | null> {
    try {
      const response = await this.dynamoClient.send(new QueryCommand({
        TableName: this.connectionsTable,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `CONNECTION#${connectionId}`
        }
      }));

      const item = response.Items?.[0];
      return item ? { sessionId: item.sessionId } : null;

    } catch (error) {
      logger.error('Error getting connection info', error);
      return null;
    }
  }

  private async updateConnectionActivity(connectionId: string): Promise<void> {
    try {
      await this.dynamoClient.send(new UpdateCommand({
        TableName: this.connectionsTable,
        Key: {
          PK: `CONNECTION#${connectionId}`,
          SK: `SESSION#${connectionId.split('-')[1]}` // Extract session ID
        },
        UpdateExpression: 'SET lastPingAt = :timestamp',
        ExpressionAttributeValues: {
          ':timestamp': Date.now()
        }
      }));
    } catch (error) {
      logger.error('Error updating connection activity', error);
    }
  }

  private async removeStaleConnection(connectionId: string, sessionId: string): Promise<void> {
    try {
      await this.dynamoClient.send(new DeleteCommand({
        TableName: this.connectionsTable,
        Key: {
          PK: `CONNECTION#${connectionId}`,
          SK: `SESSION#${sessionId}`
        }
      }));

      logger.info('Removed stale connection', { connectionId, sessionId });

    } catch (error) {
      logger.error('Error removing stale connection', error);
    }
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async sendCommandResponse(connectionId: string, response: any): Promise<void> {
    if (!this.apiGatewayClient) {
      logger.warn('API Gateway client not initialized, cannot send command response');
      return;
    }

    try {
      const message = {
        id: this.generateMessageId(),
        type: 'command-response',
        timestamp: Date.now(),
        payload: response
      };

      await this.apiGatewayClient.send(new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: JSON.stringify(message)
      }));

    } catch (error: any) {
      if (error.statusCode === 410) {
        // Connection is stale, remove it
        const connectionInfo = await this.getConnectionInfo(connectionId);
        if (connectionInfo) {
          await this.removeStaleConnection(connectionId, connectionInfo.sessionId);
        }
      } else {
        logger.error('Error sending command response', {
          connectionId,
          error
        });
      }
    }
  }
}