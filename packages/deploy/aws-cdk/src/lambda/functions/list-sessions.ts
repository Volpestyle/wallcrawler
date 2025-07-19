import { APIGatewayProxyHandler } from 'aws-lambda';
import { initRedisClient } from '../utils/redis-client';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    // Initialize Redis client
    const client = await initRedisClient();

    // Get API key from request context (already validated by API Gateway)
    const apiKey = event.requestContext.identity.apiKey;
    if (!apiKey) {
      // This should not happen with API Gateway validation, but handle it gracefully
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'API key missing from request context' }),
      };
    }

    // Derive user ID from API key
    const userId = `user_${apiKey.substring(0, 8)}`;

    // Get all session keys
    const sessionKeys = await client.keys('session:*');
    const sessions: Array<{
      id: string;
      status: string;
      createdAt: string;
      lastActivity: string;
      timeout: number;
      browserSettings: Record<string, unknown>;
      taskArn?: string;
    }> = [];

    // Filter sessions by user
    for (const key of sessionKeys) {
      const sessionData = await client.get(key);
      if (sessionData) {
        const session = JSON.parse(sessionData);
        if (session.userId === userId) {
          sessions.push({
            id: session.sessionId,
            status: session.status,
            createdAt: session.createdAt,
            lastActivity: session.lastActivity,
            timeout: session.timeout,
            browserSettings: session.browserSettings,
            taskArn: session.taskArn, // Include container identifier for multi-session info
          });
        }
      }
    }

    // Sort by creation time (newest first)
    sessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessions,
        count: sessions.length,
      }),
    };
  } catch (error) {
    console.error('Error listing sessions:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to list sessions',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};
