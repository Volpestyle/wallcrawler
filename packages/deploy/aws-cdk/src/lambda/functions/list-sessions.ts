import { APIGatewayProxyHandler } from 'aws-lambda';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { createClient } from 'redis';

const secretsClient = new SecretsManagerClient({});

const REDIS_ENDPOINT = process.env.REDIS_ENDPOINT!;
const API_KEYS_SECRET_ARN = process.env.API_KEYS_SECRET_ARN!;

let redisClient: ReturnType<typeof createClient>;

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    // Validate API key
    const apiKey = event.headers['x-api-key'];
    if (!apiKey) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'API key required' }),
      };
    }

    // Validate API key
    const apiKeysResponse = await secretsClient.send(new GetSecretValueCommand({ SecretId: API_KEYS_SECRET_ARN }));
    const apiKeys = JSON.parse(apiKeysResponse.SecretString!);

    if (!apiKeys.API_KEYS || !apiKeys.API_KEYS.includes(apiKey)) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Invalid API key' }),
      };
    }

    // Derive user ID from API key
    const userId = `user_${apiKey.substring(0, 8)}`;

    // Connect to Redis if not connected
    if (!redisClient) {
      redisClient = createClient({
        socket: {
          host: REDIS_ENDPOINT,
          port: 6379,
        },
      });
      await redisClient.connect();
    }

    // Get all session keys
    const sessionKeys = await redisClient.keys('session:*');
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
      const sessionData = await redisClient.get(key);
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
