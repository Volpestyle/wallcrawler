import { APIGatewayProxyHandler } from 'aws-lambda';
import { ECSClient, StopTaskCommand, DescribeTasksCommand } from '@aws-sdk/client-ecs';
import { ElasticLoadBalancingV2Client, DeregisterTargetsCommand } from '@aws-sdk/client-elastic-load-balancing-v2';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { createClient } from 'redis';

const ecsClient = new ECSClient({});
const elbClient = new ElasticLoadBalancingV2Client({});
const ssmClient = new SSMClient({});

const REDIS_ENDPOINT = process.env.REDIS_ENDPOINT!;
const CLUSTER_NAME = process.env.CLUSTER_NAME!;
const ENVIRONMENT = process.env.ENVIRONMENT!;
const PROJECT_NAME = process.env.PROJECT_NAME || 'wallcrawler';

let redisClient: ReturnType<typeof createClient>;
let targetGroupArn: string;

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const sessionId = event.pathParameters?.sessionId;

    if (!sessionId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Session ID required' }),
      };
    }

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

    // Get session data from Redis
    const sessionData = await redisClient.get(`session:${sessionId}`);

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

    // Get target group ARN from SSM
    if (!targetGroupArn) {
      const targetGroupParam = await ssmClient.send(
        new GetParameterCommand({
          Name: `/${PROJECT_NAME}/${ENVIRONMENT}/websocket-target-group-arn`,
        })
      );
      targetGroupArn = targetGroupParam.Parameter!.Value!;
    }

    // Check for other sessions on the same task
    let shouldStopTask = true;
    if (taskArn) {
      const allSessionKeys = await redisClient.keys('session:*');
      let activeSessionsOnTask = 0;

      for (const key of allSessionKeys) {
        const otherSessionData = await redisClient.get(key);
        if (otherSessionData) {
          const otherSession = JSON.parse(otherSessionData);
          if (
            otherSession.taskArn === taskArn &&
            otherSession.sessionId !== sessionId &&
            otherSession.status !== 'terminated' &&
            otherSession.status !== 'cleaned'
          ) {
            activeSessionsOnTask++;
          }
        }
      }

      shouldStopTask = activeSessionsOnTask === 0;
    }

    // Stop the ECS task only if no other active sessions
    if (shouldStopTask && taskArn) {
      try {
        const describeResponse = await ecsClient.send(
          new DescribeTasksCommand({
            cluster: CLUSTER_NAME,
            tasks: [taskArn],
          })
        );

        const task = describeResponse.tasks?.[0];
        if (task && task.lastStatus === 'RUNNING') {
          await ecsClient.send(
            new StopTaskCommand({
              cluster: CLUSTER_NAME,
              task: taskArn,
              reason: `Session ${sessionId} terminated by user - last session on container`,
            })
          );
          console.log(`Stopped ECS task ${taskArn}`);
        }
      } catch (error) {
        console.error('Failed to stop task:', error);
        // Continue even if task stop fails
      }

      // Deregister from target group
      if (session.privateIp && targetGroupArn) {
        try {
          await elbClient.send(
            new DeregisterTargetsCommand({
              TargetGroupArn: targetGroupArn,
              Targets: [
                {
                  Id: session.privateIp,
                  Port: 8080,
                },
              ],
            })
          );
          console.log(`Deregistered ${session.privateIp} from target group`);
        } catch (error) {
          console.error('Failed to deregister target:', error);
          // Continue even if deregistration fails
        }
      }
    } else if (taskArn) {
      console.log(`Skipping task stop for ${taskArn} - other active sessions present`);
    }

    // Update session status in Redis
    session.status = 'terminated';
    session.terminatedAt = new Date().toISOString();

    await redisClient.setEx(
      `session:${sessionId}`,
      300, // Keep terminated session info for 5 minutes
      JSON.stringify(session)
    );

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: sessionId,
        status: 'terminated',
        terminatedAt: session.terminatedAt,
        message: 'Session terminated successfully',
      }),
    };
  } catch (error) {
    console.error('Error deleting session:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to delete session',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};
