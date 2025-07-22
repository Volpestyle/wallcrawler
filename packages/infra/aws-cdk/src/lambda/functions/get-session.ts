import type { APIGatewayProxyHandler } from 'aws-lambda';
import { initRedisClient } from '@wallcrawler/utils/redis';
import type { SessionDetails } from '@wallcrawler/utils/types';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const redis = await initRedisClient();
    const sessionId = event.pathParameters?.sessionId;

    if (!sessionId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Session ID required' }),
      };
    }

    // Get session data from Redis (stored as hash)
    const sessionData = await redis.hGetAll(`session:${sessionId}`);

    if (!sessionData || Object.keys(sessionData).length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          error: 'Session not found',
          sessionId,
        }),
      };
    }

    // Get active connections for this session
    const connections = await redis.sMembers(`session:${sessionId}:connections`);
    const activeConnections = connections.length;

    // Check if there are pending messages
    const pendingMessages = await redis.lLen(`session:${sessionId}:messages`);

    // Return properly typed SessionDetails response
    const sessionDetails: SessionDetails = {
      id: sessionId,
      status: sessionData.status || 'unknown',
      userId: sessionData.userId,
      createdAt: sessionData.createdAt,
      lastActivity: sessionData.lastActivity,
      lastHeartbeat: sessionData.lastHeartbeat,
      timeout: sessionData.timeout ? parseInt(sessionData.timeout) : null,
      browserSettings: sessionData.browserSettings ? JSON.parse(sessionData.browserSettings) : {},
      taskArn: sessionData.taskArn,
      taskStatus: sessionData.taskStatus,
      activeConnections,
      pendingMessages,
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sessionDetails),
    };
  } catch (error) {
    console.error('Error getting session:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to get session',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};
