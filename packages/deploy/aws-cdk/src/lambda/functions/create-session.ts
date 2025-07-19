import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { JWETokenManager } from '../utils/jwe-utils';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { initRedisClient } from '../utils/redis-client';

const secretsClient = new SecretsManagerClient({});

const ENVIRONMENT = process.env.ENVIRONMENT!;
const JWE_SECRET_ARN = process.env.JWE_SECRET_ARN!;
const ALB_DNS_NAME = process.env.ALB_DNS_NAME!;

let jweTokenManager: JWETokenManager;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    // Initialize Redis client
    const client = await initRedisClient();

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

    // Get API key from request context (already validated by API Gateway)
    const apiKey = event.requestContext.identity.apiKey;
    if (!apiKey) {
      // This should not happen with API Gateway validation, but handle it gracefully
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'API key missing from request context' }),
      };
    }

    // Derive user ID from API key (consistent with existing logic)
    const userId = `user_${apiKey.substring(0, 8)}`;

    // Parse request body
    const body = JSON.parse(event.body || '{}') as { browserSettings?: Record<string, unknown>; timeout?: number };
    const { browserSettings = {} as Record<string, unknown>, timeout = 60 } = body; // Default 60 minute timeout

    // Generate session ID
    const sessionId = `ses_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

    // Store session metadata
    const sessionData = {
      sessionId,
      userId,
      status: 'pending',
      createdAt: new Date().toISOString(),
      timeout: timeout * 60 * 1000,
      browserSettings,
    };

    await client.setEx(
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
