import type { APIGatewayProxyWebsocketHandlerV2, APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { initRedisClient } from '@wallcrawler/utils/redis';
import { getJweSecret } from '@wallcrawler/utils/auth';
import { jwtVerify } from 'jose';

interface JWTPayload {
    sessionId: string;
    exp: number;
    iat: number;
}

interface ConnectionMapping {
    sessionId: string;
    connectedAt: string;
    lastActivity: string;
}

const jweSecretArn = process.env.JWE_SECRET_ARN!;

/**
 * Validate JWT token and extract session ID
 */
async function validateToken(token: string): Promise<string> {
    try {
        const secret = await getJweSecret(jweSecretArn);
        const encoder = new TextEncoder();
        const { payload } = await jwtVerify<JWTPayload>(token, encoder.encode(secret));

        if (!payload.sessionId) {
            throw new Error('Session ID not found in token');
        }

        return payload.sessionId;
    } catch (error) {
        throw new Error(`Invalid token: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * WebSocket Connect Handler
 * Validates JWT token and stores connection mapping in Redis
 */
export const handler: APIGatewayProxyWebsocketHandlerV2 = async (
    event: APIGatewayProxyWebsocketEventV2
) => {
    console.log('WebSocket Connect Event:', JSON.stringify(event, null, 2));

    const { requestContext: { connectionId } } = event;

    try {
        // For WebSocket connections, query parameters and headers from the handshake
        // are not available in the typed event. Access them via the event object directly.
        const eventWithParams = event as APIGatewayProxyWebsocketEventV2 & {
            queryStringParameters?: { [name: string]: string } | null;
            headers?: { [name: string]: string } | null;
        };

        // Extract token from query parameters or Authorization header
        const token = eventWithParams.queryStringParameters?.token ||
            eventWithParams.headers?.authorization?.replace('Bearer ', '') ||
            eventWithParams.headers?.Authorization?.replace('Bearer ', '');

        if (!token) {
            console.error('No token provided in connection request');
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'Authentication token required' }),
            };
        }

        // Check if client is requesting immediate streaming (for screencast)
        const requestStream = eventWithParams.queryStringParameters?.requestStream === 'true';

        // Validate token and extract session ID
        const sessionId = await validateToken(token);
        console.log(`Valid token for session: ${sessionId}`);

        // Store connection mapping in Redis
        const redis = await initRedisClient();

        const connectionMapping: ConnectionMapping = {
            sessionId,
            connectedAt: new Date().toISOString(),
            lastActivity: new Date().toISOString(),
        };

        // Set connection mapping with TTL (1 hour)
        await redis.setEx(
            `connection:${connectionId}`,
            3600,
            JSON.stringify(connectionMapping)
        );

        // Add connection to session's connection set
        await redis.sAdd(`session:${sessionId}:connections`, connectionId);
        await redis.expire(`session:${sessionId}:connections`, 3600);

        // Update session last activity
        await redis.hSet(`session:${sessionId}`, {
            lastActivity: new Date().toISOString(),
            status: 'connected',
        });

        // If client requests streaming, provide direct container endpoint
        let streamingInfo = {};
        if (requestStream) {
            console.log(`Client requesting immediate streaming for session ${sessionId}`);

            try {
                // Get container NLB DNS from SSM or environment
                const containerNlbDns = process.env.CONTAINER_NLB_DNS;
                if (containerNlbDns) {
                    // Create direct streaming URL to container via NLB
                    const streamUrl = `ws://${containerNlbDns}:8080/internal/ws?token=${token}&sessionId=${sessionId}`;
                    streamingInfo = {
                        streamUrl,
                        streamingReady: true,
                    };

                    // Mark session as ready for streaming
                    await redis.hSet(`session:${sessionId}`, {
                        streamingReady: 'true',
                        streamUrl,
                    });
                } else {
                    console.warn('Container NLB DNS not available for direct streaming');
                    streamingInfo = {
                        streamingReady: false,
                        error: 'Direct streaming not available',
                    };
                }
            } catch (error) {
                console.warn(`Failed to setup streaming: ${error}`);
                streamingInfo = {
                    streamingReady: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        }

        console.log(`Connection ${connectionId} established for session ${sessionId}${requestStream ? ' (with streaming)' : ''}`);

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Connected successfully',
                sessionId,
                connectionId,
                ...streamingInfo,
            }),
        };

    } catch (error) {
        console.error('WebSocket connection error:', error);

        return {
            statusCode: 401,
            body: JSON.stringify({
                error: 'Authentication failed',
                details: error instanceof Error ? error.message : 'Unknown error',
            }),
        };
    }
}; 