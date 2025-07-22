import type { APIGatewayProxyWebsocketHandlerV2, APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { initRedisClient } from '@wallcrawler/utils/redis';
import { ensureFargateTask } from '@wallcrawler/utils/aws';

interface WebSocketMessage {
    type: string;
    id?: number;
    method?: string;
    params?: unknown;
    sessionId?: string;
    data?: unknown;
    event?: unknown;
}

// TaskInfo interface removed as it's no longer used

const _redisEndpoint = process.env.REDIS_ENDPOINT!;
const _redisTlsEnabled = process.env.REDIS_TLS_ENABLED === 'true';
const _ecsClusterName = process.env.ECS_CLUSTER_NAME!;
const _browserTaskDefinitionArn = process.env.BROWSER_TASK_DEFINITION_ARN!;
const _environment = process.env.ENVIRONMENT || 'dev';

/**
 * Get API Gateway Management API client
 */
function getApiGatewayClient(event: APIGatewayProxyWebsocketEventV2) {
    const { domainName, stage } = event.requestContext;
    const endpoint = `https://${domainName}/${stage}`;

    return new ApiGatewayManagementApiClient({
        endpoint,
    });
}

/**
 * Send message to WebSocket connection
 */
async function sendToConnection(
    apiGatewayClient: ApiGatewayManagementApiClient,
    connectionId: string,
    data: unknown
) {
    try {
        await apiGatewayClient.send(
            new PostToConnectionCommand({
                ConnectionId: connectionId,
                Data: JSON.stringify(data),
            })
        );
    } catch (error) {
        console.error(`Failed to send message to connection ${connectionId}:`, error);
        throw error;
    }
}

/**
 * Get session ID from connection
 */
async function getSessionFromConnection(connectionId: string): Promise<string | null> {
    const redis = await initRedisClient();
    const connectionData = await redis.get(`connection:${connectionId}`);

    if (!connectionData) {
        return null;
    }

    const connectionMapping = JSON.parse(connectionData);
    return connectionMapping.sessionId;
}

/**
 * Get all connections for a session
 */
async function _getSessionConnections(sessionId: string): Promise<string[]> {
    const redis = await initRedisClient();
    return redis.sMembers(`session:${sessionId}:connections`);
}

/**
 * Forward message to Fargate task
 * Note: In a real implementation, this would use WebSocket or HTTP to communicate with the task
 * For now, we'll simulate by storing the message in Redis for the task to pick up
 */
async function forwardToFargateTask(sessionId: string, message: WebSocketMessage): Promise<void> {
    const redis = await initRedisClient();

    // Store message in Redis queue for the task to process
    const messageWithTimestamp = {
        ...message,
        timestamp: new Date().toISOString(),
        sessionId,
    };

    await redis.lPush(`session:${sessionId}:messages`, JSON.stringify(messageWithTimestamp));
    await redis.expire(`session:${sessionId}:messages`, 3600); // Expire in 1 hour

    console.log(`Forwarded message to task for session ${sessionId}:`, message.type);
}

/**
 * WebSocket Message Handler
 * Routes CDP commands and manages Fargate tasks
 */
export const handler: APIGatewayProxyWebsocketHandlerV2 = async (
    event: APIGatewayProxyWebsocketEventV2
) => {
    console.log('WebSocket Message Event:', JSON.stringify(event, null, 2));

    const { requestContext: { connectionId }, body } = event;
    const apiGatewayClient = getApiGatewayClient(event);

    try {
        // Parse incoming message
        let message: WebSocketMessage;
        try {
            message = JSON.parse(body || '{}');
        } catch (error) {
            console.error('Invalid JSON in message body:', error);
            throw new Error('Invalid JSON in message body');
        }

        // Get session ID from connection
        const sessionId = await getSessionFromConnection(connectionId);
        if (!sessionId) {
            throw new Error('Session not found for connection');
        }

        console.log(`Processing message type: ${message.type} for session: ${sessionId}`);

        // Update connection activity
        const redis = await initRedisClient();
        await redis.hSet(`session:${sessionId}`, {
            lastActivity: new Date().toISOString(),
        });

        // Handle different message types
        switch (message.type) {
            case 'CDP_COMMAND':
                // Ensure Fargate task is running (reuse existing if available)
                await ensureFargateTask(sessionId);

                // Forward CDP command to Fargate task
                await forwardToFargateTask(sessionId, message);

                // For now, send acknowledgment (real implementation would wait for task response)
                await sendToConnection(apiGatewayClient, connectionId, {
                    type: 'CDP_RESPONSE',
                    id: message.id,
                    result: { success: true, message: 'Command forwarded to browser' },
                });
                break;

            case 'AI_ACTION':
                // Ensure Fargate task is running (reuse existing if available)
                await ensureFargateTask(sessionId);

                // Forward AI action to Fargate task
                await forwardToFargateTask(sessionId, message);

                // Send acknowledgment
                await sendToConnection(apiGatewayClient, connectionId, {
                    type: 'AI_ACTION_RESPONSE',
                    result: { success: true, message: 'Action forwarded to browser' },
                });
                break;

            case 'INPUT_EVENT':
                // Forward input event to task
                await forwardToFargateTask(sessionId, message);

                // Send acknowledgment
                await sendToConnection(apiGatewayClient, connectionId, {
                    type: 'INPUT_RESPONSE',
                    result: { success: true, message: 'Input forwarded to browser' },
                });
                break;

            case 'START_SCREENCAST':
                // Forward screencast request to task
                await forwardToFargateTask(sessionId, message);

                // Send acknowledgment
                await sendToConnection(apiGatewayClient, connectionId, {
                    type: 'SCREENCAST_STARTED',
                    result: { success: true, message: 'Screencast started' },
                });
                break;

            case 'STOP_SCREENCAST':
                // Forward stop request to task
                await forwardToFargateTask(sessionId, message);

                // Send acknowledgment
                await sendToConnection(apiGatewayClient, connectionId, {
                    type: 'SCREENCAST_STOPPED',
                    result: { success: true, message: 'Screencast stopped' },
                });
                break;

            case 'PING':
                // Health check
                await sendToConnection(apiGatewayClient, connectionId, {
                    type: 'PONG',
                    timestamp: new Date().toISOString(),
                });
                break;

            default:
                console.warn(`Unknown message type: ${message.type}`);
                await sendToConnection(apiGatewayClient, connectionId, {
                    type: 'ERROR',
                    error: `Unknown message type: ${message.type}`,
                });
        }

        return { statusCode: 200 };

    } catch (error) {
        console.error('WebSocket message error:', error);

        try {
            await sendToConnection(apiGatewayClient, connectionId, {
                type: 'ERROR',
                error: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date().toISOString(),
            });
        } catch (sendError) {
            console.error('Failed to send error message:', sendError);
        }

        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Message processing failed',
                details: error instanceof Error ? error.message : 'Unknown error',
            }),
        };
    }
}; 