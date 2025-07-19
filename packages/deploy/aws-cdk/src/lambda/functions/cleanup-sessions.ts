import { ScheduledEvent, Context } from 'aws-lambda';
import { ECSClient, ListTasksCommand, StopTaskCommand, DescribeTasksCommand } from '@aws-sdk/client-ecs';
import { ElasticLoadBalancingV2Client, DeregisterTargetsCommand } from '@aws-sdk/client-elastic-load-balancing-v2';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { initRedisClient } from '../utils/redis-client';

const ecsClient = new ECSClient({});
const elbClient = new ElasticLoadBalancingV2Client({});
const ssmClient = new SSMClient({});

const CLUSTER_NAME = process.env.CLUSTER_NAME!;
const ENVIRONMENT = process.env.ENVIRONMENT!;
const PROJECT_NAME = process.env.PROJECT_NAME || 'wallcrawler';

let targetGroupArn: string;

interface SessionData {
  sessionId: string;
  userId: string;
  status: string;
  lastActivity: string;
  timeout: number;
  containerInfo: {
    taskArn: string;
    taskDefinition: string;
  };
}

export const handler = async (event: ScheduledEvent, context: Context): Promise<void> => {
  console.log('Starting session cleanup...', { event, context });

  try {
    // Initialize Redis client
    const client = await initRedisClient();

    // Get target group ARN
    if (!targetGroupArn) {
      const targetGroupParam = await ssmClient.send(
        new GetParameterCommand({
          Name: `/${PROJECT_NAME}/${ENVIRONMENT}/websocket-target-group-arn`,
        })
      );
      targetGroupArn = targetGroupParam.Parameter!.Value!;
    }

    // Get all session keys
    const sessionKeys = await client.keys('session:*');
    console.log(`Found ${sessionKeys.length} sessions to check`);

    const now = new Date();
    let cleanedCount = 0;
    let errorCount = 0;

    // Group sessions by taskArn for multi-session support
    const sessionsByTask = new Map<string, SessionData[]>();

    for (const key of sessionKeys) {
      try {
        const sessionData = await client.get(key);
        if (!sessionData) continue;

        const session: SessionData = JSON.parse(sessionData);
        const taskArn = session.containerInfo.taskArn;

        if (!sessionsByTask.has(taskArn)) {
          sessionsByTask.set(taskArn, []);
        }
        sessionsByTask.get(taskArn)!.push(session);
      } catch (error) {
        console.error(`Error processing session ${key}:`, error);
        errorCount++;
      }
    }

    // Process each container (task)
    for (const [taskArn, sessions] of sessionsByTask) {
      if (!taskArn || taskArn === 'unknown') continue;

      let activeSessions = 0;
      const expiredSessions: SessionData[] = [];

      for (const session of sessions) {
        const lastActivity = new Date(session.lastActivity);
        const timeSinceActivity = now.getTime() - lastActivity.getTime();
        const isExpired = timeSinceActivity > session.timeout + 30000;

        if (isExpired || session.status === 'terminated') {
          expiredSessions.push(session);
        } else {
          activeSessions++;
        }
      }

      // If no active sessions, cleanup the container
      if (activeSessions === 0 && expiredSessions.length > 0) {
        console.log(`Cleaning up idle container ${taskArn} with ${expiredSessions.length} expired sessions`);

        try {
          // Check if task is still running
          const describeResponse = await ecsClient.send(
            new DescribeTasksCommand({
              cluster: CLUSTER_NAME,
              tasks: [taskArn],
            })
          );

          const task = describeResponse.tasks?.[0];
          if (task && task.lastStatus === 'RUNNING') {
            console.log(`Stopping task ${taskArn}`);

            await ecsClient.send(
              new StopTaskCommand({
                cluster: CLUSTER_NAME,
                task: taskArn,
                reason: `Idle container cleanup - all sessions expired/terminated`,
              })
            );
          }

          // Deregister from target group
          await deregisterTaskFromTargetGroup(taskArn);

          // Cleanup expired sessions
          for (const session of expiredSessions) {
            const updatedSession = {
              ...session,
              status: 'cleaned',
              cleanedAt: new Date().toISOString(),
            };

            await client.setEx(
              `session:${session.sessionId}`,
              300, // Keep for 5 minutes for debugging
              JSON.stringify(updatedSession)
            );
            cleanedCount++;
          }
        } catch (error) {
          console.error(`Failed to cleanup container ${taskArn}:`, error);
          errorCount += expiredSessions.length;
        }
      }
    }

    // Also check for orphaned ECS tasks (tasks without sessions)
    await cleanupOrphanedTasks();

    console.log(`Session cleanup completed: ${cleanedCount} cleaned, ${errorCount} errors`);
  } catch (error) {
    console.error('Session cleanup failed:', error);
    throw error;
  }
};

async function deregisterTaskFromTargetGroup(taskArn: string): Promise<void> {
  if (!taskArn || taskArn === 'unknown') return;

  try {
    // Get task details to find IP
    const describeResponse = await ecsClient.send(
      new DescribeTasksCommand({
        cluster: CLUSTER_NAME,
        tasks: [taskArn],
      })
    );

    const task = describeResponse.tasks?.[0];
    if (!task?.attachments?.[0]?.details) return;

    // Extract private IP
    const networkInterface = task.attachments[0].details.find((d) => d.name === 'privateIPv4Address');

    if (!networkInterface?.value) return;

    const privateIp = networkInterface.value;

    // Deregister from target group
    await elbClient.send(
      new DeregisterTargetsCommand({
        TargetGroupArn: targetGroupArn,
        Targets: [
          {
            Id: privateIp,
            Port: 8080,
          },
        ],
      })
    );

    console.log(`Deregistered ${privateIp} from target group`);
  } catch (error) {
    console.error(`Failed to deregister task from target group:`, error);
  }
}

async function cleanupOrphanedTasks(): Promise<void> {
  try {
    // Get initialized Redis client
    const client = await initRedisClient();

    // List all running tasks in the cluster
    const listResponse = await ecsClient.send(
      new ListTasksCommand({
        cluster: CLUSTER_NAME,
        desiredStatus: 'RUNNING',
      })
    );

    if (!listResponse.taskArns || listResponse.taskArns.length === 0) {
      console.log('No running tasks found');
      return;
    }

    // Get task details
    const describeResponse = await ecsClient.send(
      new DescribeTasksCommand({
        cluster: CLUSTER_NAME,
        tasks: listResponse.taskArns,
      })
    );

    if (!describeResponse.tasks) return;

    // Check each task to see if it has an active session
    for (const task of describeResponse.tasks) {
      if (!task.taskArn) continue;

      // Extract session ID from task tags
      const sessionTag = task.tags?.find((tag) => tag.key === 'SessionId');
      if (!sessionTag?.value) continue;

      const sessionId = sessionTag.value;

      // Check if session exists in Redis
      const sessionData = await client.get(`session:${sessionId}`);

      if (!sessionData) {
        console.log(`Found orphaned task ${task.taskArn} for non-existent session ${sessionId}`);

        // Stop orphaned task
        await ecsClient.send(
          new StopTaskCommand({
            cluster: CLUSTER_NAME,
            task: task.taskArn,
            reason: `Orphaned task cleanup - session ${sessionId} not found`,
          })
        );

        // Deregister from target group
        await deregisterTaskFromTargetGroup(task.taskArn);
      }
    }
  } catch (error) {
    console.error('Failed to cleanup orphaned tasks:', error);
  }
}
