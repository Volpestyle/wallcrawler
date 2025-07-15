import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { JWETokenManager } from '../utils/jwe-utils';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { createClient } from 'redis';

const secretsClient = new SecretsManagerClient({});

const REDIS_ENDPOINT = process.env.REDIS_ENDPOINT!;
const ENVIRONMENT = process.env.ENVIRONMENT!;
const JWE_SECRET_ARN = process.env.JWE_SECRET_ARN!;
const API_KEYS_SECRET_ARN = process.env.API_KEYS_SECRET_ARN!;
const ALB_DNS_NAME = process.env.ALB_DNS_NAME!;

let jweTokenManager: JWETokenManager;
let redisClient: ReturnType<typeof createClient>;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    // Initialize JWE token manager if not already done
    if (!jweTokenManager) {
      const jweSecretResponse = await secretsClient.send(
        new GetSecretValueCommand({
          SecretId: JWE_SECRET_ARN,
        })
      );
      const jweSecret = jweSecretResponse.SecretString!;

      jweTokenManager = new JWETokenManager(jweSecret);
    }

    // Validate API key
    const apiKey = event.headers['x-api-key'];
    if (!apiKey) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'API key required' }),
      };
    }

    const apiKeysResponse = await secretsClient.send(new GetSecretValueCommand({ SecretId: API_KEYS_SECRET_ARN }));
    const apiKeys = JSON.parse(apiKeysResponse.SecretString!).API_KEYS;

    if (!apiKeys || !apiKeys.includes(apiKey)) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Invalid API key' }),
      };
    }

    // Parse request body
    const body = JSON.parse(event.body || '{}') as { browserSettings?: Record<string, unknown>; timeout?: number };
    const { browserSettings = {} as Record<string, unknown>, timeout = 60 } = body; // Default 60 minute timeout

    // Generate session ID
    const sessionId = `ses_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    const userId = `user_${apiKey.substring(0, 8)}`; // Derive user ID from API key

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

    // Store session metadata
    const sessionData = {
      sessionId,
      userId,
      status: 'pending',
      createdAt: new Date().toISOString(),
      timeout: timeout * 60 * 1000,
      browserSettings,
    };

    await redisClient.setEx(
      `session:${sessionId}`,
      timeout * 60, // TTL in seconds
      JSON.stringify(sessionData)
    );

    // Create JWE token for WebSocket authentication
    const token = await jweTokenManager.createToken(
      {
        sessionId,
        userId,
        browserOptions: browserSettings,
        sub: apiKey,
      },
      `${timeout}m`
    );

    // WebSocket URL using path-based routing
    const protocol = ENVIRONMENT === 'production' ? 'wss' : 'ws';
    const connectUrl = `${protocol}://${ALB_DNS_NAME}/sessions/${sessionId}/ws`;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: sessionId,
        status: 'pending',
        createdAt: sessionData.createdAt,
        timeout: timeout * 60 * 1000,
        browserSettings,
        connectUrl,
        token, // JWE token for WebSocket authentication (use in Authorization header)
      }),
    };
  } catch (error) {
    console.error('Error creating session:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to create session',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};
