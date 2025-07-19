import { APIGatewayProxyHandler } from 'aws-lambda';
import { ECSClient, DescribeTasksCommand } from '@aws-sdk/client-ecs';
import { initRedisClient } from '../utils/redis-client';

const ecsClient = new ECSClient({});
const CLUSTER_NAME = process.env.CLUSTER_NAME!;

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    // Initialize Redis client
    const client = await initRedisClient();

    const sessionId = event.pathParameters?.sessionId;

    if (!sessionId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Session ID required' }),
      };
    }

    // Get session data from Redis
    const sessionData = await client.get(`session:${sessionId}`);

    if (!sessionData) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          error: 'Session not found',
          sessionId,
        }),
      };
    }

    const session = JSON.parse(sessionData);
    const taskArn = session.taskArn;

    // Get sibling sessions on the same container
    const siblingSessions: string[] = [];
    if (taskArn) {
      const allSessionKeys = await client.keys('session:*');
      for (const key of allSessionKeys) {
        const otherSessionData = await client.get(key);
        if (otherSessionData) {
          const otherSession = JSON.parse(otherSessionData);
          if (otherSession.taskArn === taskArn && otherSession.sessionId !== sessionId) {
            siblingSessions.push(otherSession.sessionId);
          }
        }
      }
    }

    // Get task status from ECS
    if (taskArn) {
      try {
        const describeResponse = await ecsClient.send(
          new DescribeTasksCommand({
            cluster: CLUSTER_NAME,
            tasks: [taskArn],
          })
        );

        const task = describeResponse.tasks?.[0];
        if (task) {
          session.taskStatus = task.lastStatus;
          session.taskHealth = task.healthStatus;

          // Check if task is still running
          if (task.lastStatus !== 'RUNNING') {
            session.status = 'terminated';
          }
        }
      } catch (error) {
        console.error('Failed to describe task:', error);
        // Continue without task status
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: sessionId,
        status: session.status,
        userId: session.userId,
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
        timeout: session.timeout,
        browserSettings: session.browserSettings,
        taskArn: session.taskArn,
        taskStatus: session.taskStatus,
        siblingSessions, // List of other session IDs on the same container
      }),
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
