import { APIGatewayProxyWebsocketEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { WebSocketMessage, WebSocketMessageSchema, BrowserState, InterventionAction } from '../types/intervention';
import { createLogger } from '../utils/logger';
import { verifyAuthToken } from '../utils/auth';

const logger = createLogger('websocket-handler');

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const connectionsTable = process.env.CONNECTIONS_TABLE || 'wallcrawler-ws-connections';
const sessionsTable = process.env.SESSIONS_TABLE || 'wallcrawler-sessions';

export async function handleConnect(
  event: APIGatewayProxyWebsocketEventV2
): Promise<APIGatewayProxyResultV2> {
  const connectionId = event.requestContext.connectionId!;
  
  try {
    // Extract and verify auth token from query string
    const token = (event as any).queryStringParameters?.token;
    if (!token) {
      return { statusCode: 401, body: 'Unauthorized' };
    }

    const authPayload = await verifyAuthToken(token);
    if (!authPayload) {
      return { statusCode: 401, body: 'Invalid token' };
    }

    // Store connection mapping
    await dynamoClient.send(new PutCommand({
      TableName: connectionsTable,
      Item: {
        PK: `CONNECTION#${connectionId}`,
        SK: `CONNECTION#${connectionId}`,
        connectionId,
        userId: authPayload.userId,
        sessionId: authPayload.sessionId,
        connectedAt: Date.now(),
        ttl: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
      }
    }));

    // Also create reverse mapping for quick lookup
    await dynamoClient.send(new PutCommand({
      TableName: connectionsTable,
      Item: {
        PK: `SESSION#${authPayload.sessionId}`,
        SK: `CONNECTION#${connectionId}`,
        connectionId,
        userId: authPayload.userId,
        connectedAt: Date.now(),
        ttl: Math.floor(Date.now() / 1000) + (24 * 60 * 60)
      }
    }));

    logger.info('WebSocket connected', {
      connectionId,
      userId: authPayload.userId,
      sessionId: authPayload.sessionId
    });

    return { statusCode: 200, body: 'Connected' };
  } catch (error) {
    logger.error('Connection failed', error);
    return { statusCode: 500, body: 'Internal error' };
  }
}

export async function handleDisconnect(
  event: APIGatewayProxyWebsocketEventV2
): Promise<APIGatewayProxyResultV2> {
  const connectionId = event.requestContext.connectionId!;

  try {
    // Get connection info before deleting
    const connectionInfo = await dynamoClient.send(new GetCommand({
      TableName: connectionsTable,
      Key: {
        PK: `CONNECTION#${connectionId}`,
        SK: `CONNECTION#${connectionId}`
      }
    }));

    if (connectionInfo.Item) {
      // Delete connection record
      await dynamoClient.send(new DeleteCommand({
        TableName: connectionsTable,
        Key: {
          PK: `CONNECTION#${connectionId}`,
          SK: `CONNECTION#${connectionId}`
        }
      }));

      // Delete reverse mapping
      await dynamoClient.send(new DeleteCommand({
        TableName: connectionsTable,
        Key: {
          PK: `SESSION#${connectionInfo.Item.sessionId}`,
          SK: `CONNECTION#${connectionId}`
        }
      }));
    }

    logger.info('WebSocket disconnected', { connectionId });
    return { statusCode: 200, body: 'Disconnected' };
  } catch (error) {
    logger.error('Disconnect failed', error);
    return { statusCode: 500, body: 'Internal error' };
  }
}

export async function handleMessage(
  event: APIGatewayProxyWebsocketEventV2
): Promise<APIGatewayProxyResultV2> {
  const connectionId = event.requestContext.connectionId!;
  const apiGatewayClient = new ApiGatewayManagementApiClient({
    endpoint: `https://${event.requestContext.domainName}/${event.requestContext.stage}`
  });

  try {
    // Parse and validate message
    const message = JSON.parse(event.body || '{}');
    const validatedMessage = WebSocketMessageSchema.parse(message);

    // Get connection info
    const connectionInfo = await dynamoClient.send(new GetCommand({
      TableName: connectionsTable,
      Key: {
        PK: `CONNECTION#${connectionId}`,
        SK: `CONNECTION#${connectionId}`
      }
    }));

    if (!connectionInfo.Item) {
      return { statusCode: 401, body: 'Connection not found' };
    }

    const { sessionId } = connectionInfo.Item;

    // Handle different message types
    switch (validatedMessage.type) {
      case 'user-action':
        await handleUserAction(
          sessionId,
          validatedMessage.payload.action as InterventionAction
        );
        break;

      case 'complete':
        await handleInterventionComplete(
          sessionId,
          validatedMessage.payload.success
        );
        break;

      default:
        logger.warn('Unknown message type', { type: validatedMessage.type });
    }

    return { statusCode: 200, body: 'Message processed' };
  } catch (error) {
    logger.error('Message handling failed', error);
    
    // Send error back to client
    try {
      await apiGatewayClient.send(new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: JSON.stringify({
          type: 'error',
          payload: {
            message: error instanceof Error ? error.message : 'Unknown error',
            code: 'MESSAGE_PROCESSING_ERROR'
          }
        } as WebSocketMessage)
      }));
    } catch (sendError) {
      logger.error('Failed to send error message', sendError);
    }

    return { statusCode: 500, body: 'Internal error' };
  }
}

async function handleUserAction(
  sessionId: string,
  action: InterventionAction
): Promise<void> {
  logger.info('Handling user action', { sessionId, action });

  // Get the automation session
  const sessionResponse = await dynamoClient.send(new GetCommand({
    TableName: sessionsTable,
    Key: {
      PK: `SESSION#${sessionId}`,
      SK: `SESSION#${sessionId}`
    }
  }));

  if (!sessionResponse.Item) {
    throw new Error('Session not found');
  }

  // Forward the action to the automation Lambda/ECS task
  // This would typically be done via SQS or EventBridge
  await forwardActionToAutomation(sessionId, action);

  // Update session with the action
  await dynamoClient.send(new PutCommand({
    TableName: sessionsTable,
    Item: {
      ...sessionResponse.Item,
      lastAction: action,
      lastActionAt: Date.now()
    }
  }));
}

async function handleInterventionComplete(
  sessionId: string,
  success: boolean
): Promise<void> {
  logger.info('Intervention complete', { sessionId, success });

  // Update intervention status
  await dynamoClient.send(new PutCommand({
    TableName: sessionsTable,
    Item: {
      PK: `SESSION#${sessionId}`,
      SK: `INTERVENTION#COMPLETE`,
      completedAt: Date.now(),
      success,
      ttl: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // Keep for 7 days
    }
  }));

  // Notify the automation to resume
  await notifyAutomationToResume(sessionId, success);
}

export async function sendBrowserState(
  sessionId: string,
  state: BrowserState
): Promise<void> {
  const apiGatewayEndpoint = process.env.WEBSOCKET_API_ENDPOINT;
  if (!apiGatewayEndpoint) {
    logger.warn('WebSocket API endpoint not configured');
    return;
  }

  const apiGatewayClient = new ApiGatewayManagementApiClient({
    endpoint: apiGatewayEndpoint
  });

  // Get all connections for this session
  const connectionsResponse = await dynamoClient.send(new GetCommand({
    TableName: connectionsTable,
    Key: {
      PK: `SESSION#${sessionId}`,
      SK: `CONNECTION#`
    }
  }));

  if (!connectionsResponse.Item) {
    logger.info('No active connections for session', { sessionId });
    return;
  }

  const connectionId = connectionsResponse.Item.connectionId;

  try {
    await apiGatewayClient.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify({
        type: 'browser-state',
        payload: { state }
      } as WebSocketMessage)
    }));

    logger.info('Browser state sent', { sessionId, connectionId });
  } catch (error) {
    if ((error as any).statusCode === 410) {
      // Connection is stale, clean it up
      logger.info('Removing stale connection', { connectionId });
      await dynamoClient.send(new DeleteCommand({
        TableName: connectionsTable,
        Key: {
          PK: `SESSION#${sessionId}`,
          SK: `CONNECTION#${connectionId}`
        }
      }));
    } else {
      logger.error('Failed to send browser state', error);
    }
  }
}

// Helper functions that would integrate with your automation system
async function forwardActionToAutomation(
  sessionId: string,
  action: InterventionAction
): Promise<void> {
  // Implementation would send action to SQS/EventBridge
  // for the automation Lambda/ECS task to process
  logger.info('Forwarding action to automation', { sessionId, action });
}

async function notifyAutomationToResume(
  sessionId: string,
  success: boolean
): Promise<void> {
  // Implementation would notify the automation to resume
  // typically via SQS/EventBridge
  logger.info('Notifying automation to resume', { sessionId, success });
}