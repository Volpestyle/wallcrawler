import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ECSClient, RunTaskCommand, DescribeServicesCommand } from '@aws-sdk/client-ecs';
import { type RedisClient, initRedisClient } from '@wallcrawler/utils/redis';
import { createToken, getJweSecret } from '@wallcrawler/utils/auth';

const ecsClient = new ECSClient({});

const ENVIRONMENT = process.env.ENVIRONMENT!;
const JWE_SECRET_ARN = process.env.JWE_SECRET_ARN!;
const ECS_CLUSTER_ARN = process.env.ECS_CLUSTER_ARN!;
const ECS_SERVICE_NAME = process.env.ECS_SERVICE_NAME!;
const ECS_TASK_DEFINITION_ARN = process.env.ECS_TASK_DEFINITION_ARN!;
const SUBNET_IDS = process.env.SUBNET_IDS!;
const SECURITY_GROUP_ID = process.env.SECURITY_GROUP_ID!;
const MAX_SESSIONS_PER_CONTAINER = parseInt(process.env.MAX_SESSIONS_PER_CONTAINER || '20');
const MAX_CONTAINERS = parseInt(process.env.MAX_CONTAINERS || '10');

export interface CreateSessionRequest {
  browserSettings?: Record<string, unknown>;
  timeout?: number;
}

/**
 * Check if we need to start a new ECS task based on current capacity
 */
async function checkAndStartTask(redis: RedisClient, sessionId: string): Promise<void> {
  try {
    // Get current running task count
    const describeResponse = await ecsClient.send(new DescribeServicesCommand({
      cluster: ECS_CLUSTER_ARN,
      services: [ECS_SERVICE_NAME],
    }));

    const service = describeResponse.services?.[0];
    const runningCount = service?.runningCount || 0;
    const pendingCount = service?.pendingCount || 0;

    console.log(`Current ECS service state: running=${runningCount}, pending=${pendingCount}`);

    // Count active sessions across all containers
    const sessionKeys = await redis.keys('session:*');
    const activeSessions = await Promise.all(
      sessionKeys.map(async (key: string) => {
        const sessionData = await redis.hGetAll(key);
        return sessionData.status === 'active' || sessionData.status === 'pending' ? 1 : 0;
      })
    );
    const totalActiveSessions = activeSessions.reduce((sum: number, count: number) => sum + count, 0);

    const totalCapacity = runningCount * MAX_SESSIONS_PER_CONTAINER;
    const needsNewTask = totalActiveSessions >= totalCapacity && (runningCount + pendingCount) < MAX_CONTAINERS;

    console.log(`Capacity check: active=${totalActiveSessions}, capacity=${totalCapacity}, needsNew=${needsNewTask}`);

    if (needsNewTask) {
      console.log(`Starting new ECS task for session ${sessionId}`);

      const runTaskResponse = await ecsClient.send(new RunTaskCommand({
        cluster: ECS_CLUSTER_ARN,
        taskDefinition: ECS_TASK_DEFINITION_ARN,
        count: 1,
        launchType: 'FARGATE',
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: SUBNET_IDS.split(','),
            securityGroups: [SECURITY_GROUP_ID],
            assignPublicIp: 'ENABLED',
          },
        },
        overrides: {
          containerOverrides: [{
            name: 'BrowserContainer',
            environment: [
              { name: 'REDIS_ENDPOINT', value: process.env.REDIS_ENDPOINT! },
              { name: 'S3_BUCKET', value: process.env.S3_BUCKET! },
              { name: 'MAX_SESSIONS', value: MAX_SESSIONS_PER_CONTAINER.toString() },
              { name: 'ENVIRONMENT', value: ENVIRONMENT },
            ],
          }],
        },
      }));

      const taskArn = runTaskResponse.tasks?.[0]?.taskArn;
      if (taskArn) {
        console.log(`Started ECS task: ${taskArn}`);

        // Add session to pending queue for the new task to pick up
        await redis.lPush('pending-sessions', sessionId);
        await redis.hSet(`session:${sessionId}`, 'taskArn', taskArn);
      }
    } else {
      // Add to pending queue for existing containers to pick up
      await redis.lPush('pending-sessions', sessionId);
      console.log(`Added session ${sessionId} to pending queue for existing containers`);
    }
  } catch (error) {
    console.error('Error in capacity check/task start:', error);
    // Fallback: add to pending queue anyway
    await redis.lPush('pending-sessions', sessionId);
  }
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const redis = await initRedisClient();

    // Get API key from request context (already validated by API Gateway)
    const apiKey = event.requestContext.identity.apiKey;
    if (!apiKey) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'API key missing from request context' }),
      };
    }

    // Derive user ID from API key
    const userId = `user_${apiKey.substring(0, 8)}`;

    // Parse request body
    const body: CreateSessionRequest = JSON.parse(event.body || '{}');

    const {
      browserSettings = {},
      timeout = 60 // Default 60 minute timeout
    } = body;

    // Generate session ID
    const sessionId = `ses_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

    // Store session metadata in Redis
    const sessionData = {
      sessionId,
      userId,
      status: 'pending',
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      timeout: timeout * 60 * 1000, // Convert to milliseconds
      browserSettings: JSON.stringify(browserSettings),
    };

    // Store as hash for easier updates
    await redis.hSet(`session:${sessionId}`, sessionData);
    await redis.expire(`session:${sessionId}`, timeout * 60); // TTL in seconds

    // Check capacity and potentially start new ECS task
    await checkAndStartTask(redis, sessionId);

    // Create JWT token for WebSocket authentication
    const secret = await getJweSecret(JWE_SECRET_ARN);
    const token = await createToken({
      sessionId,
      userId,
      browserSettings,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (timeout * 60),
    }, secret);

    // Always use direct CDP URL for best performance and tool compatibility
    const cdpEndpoint = process.env.CDP_ENDPOINT;
    let connectUrl: string;

    if (cdpEndpoint) {
      // Construct CDP WebSocket URL that will be routed through NLB to container
      connectUrl = `wss://${cdpEndpoint}/cdp?sessionId=${sessionId}&token=${token}`;
    } else {
      // Fallback to WebSocket API if CDP endpoint not configured
      console.warn('CDP endpoint not configured, falling back to WebSocket API');
      const wsApiId = process.env.WEBSOCKET_API_ID;
      if (!wsApiId) {
        throw new Error('WEBSOCKET_API_ID not configured');
      }
      const region = process.env.AWS_REGION || 'us-east-1';
      connectUrl = `wss://${wsApiId}.execute-api.${region}.amazonaws.com/${ENVIRONMENT}?sessionId=${sessionId}&token=${token}`;
    }

    console.log(`Created session ${sessionId} for user ${userId}`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: true,
        data: {
          sessionId: sessionId,
          connectUrl: connectUrl,
          token: token,
          available: true,
        },
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
