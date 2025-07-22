import type { APIGatewayProxyWebsocketHandlerV2, APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { initRedisClient } from '@wallcrawler/utils/redis';
import { ECSClient, StopTaskCommand, DescribeTasksCommand } from '@aws-sdk/client-ecs';

const ecsClusterName = process.env.ECS_CLUSTER_NAME!;

/**
 * Check if session has any remaining connections
 */
async function hasRemainingConnections(redis: Awaited<ReturnType<typeof initRedisClient>>, sessionId: string): Promise<boolean> {
    const connections = await redis.sMembers(`session:${sessionId}:connections`);
    return connections.length > 0;
}

/**
 * Stop Fargate task if session has no more connections
 */
async function stopTaskIfIdle(sessionId: string): Promise<void> {
    try {
        const redis = await initRedisClient();

        // Get task ARN from session metadata
        const taskArn = await redis.hGet(`session:${sessionId}`, 'taskArn');

        if (!taskArn) {
            console.log(`No task ARN found for session ${sessionId}`);
            return;
        }

        // Check if task is still running
        const ecsClient = new ECSClient({});
        const describeResponse = await ecsClient.send(
            new DescribeTasksCommand({
                cluster: ecsClusterName,
                tasks: [taskArn],
            })
        );

        const task = describeResponse.tasks?.[0];
        if (!task || task.lastStatus !== 'RUNNING') {
            console.log(`Task ${taskArn} is not running, skipping stop`);
            return;
        }

        // Stop the task
        await ecsClient.send(
            new StopTaskCommand({
                cluster: ecsClusterName,
                task: taskArn,
                reason: 'Session ended - no active connections',
            })
        );

        console.log(`Stopped task ${taskArn} for session ${sessionId}`);

        // Update session status
        await redis.hSet(`session:${sessionId}`, {
            status: 'stopped',
            stoppedAt: new Date().toISOString(),
        });

    } catch (error) {
        console.error(`Failed to stop task for session ${sessionId}:`, error);
    }
}

/**
 * WebSocket Disconnect Handler
 * Cleans up connection mappings and stops tasks if no connections remain
 */
export const handler: APIGatewayProxyWebsocketHandlerV2 = async (
    event: APIGatewayProxyWebsocketEventV2
) => {
    console.log('WebSocket Disconnect Event:', JSON.stringify(event, null, 2));

    const { requestContext: { connectionId } } = event;

    try {
        const redis = await initRedisClient();

        // Get connection mapping
        const connectionData = await redis.get(`connection:${connectionId}`);

        if (!connectionData) {
            console.log(`No connection data found for ${connectionId}`);
            return { statusCode: 200 };
        }

        const connectionMapping = JSON.parse(connectionData);
        const { sessionId } = connectionMapping;

        console.log(`Cleaning up connection ${connectionId} for session ${sessionId}`);

        // Remove connection from session's connection set
        await redis.sRem(`session:${sessionId}:connections`, connectionId);

        // Delete connection mapping
        await redis.del(`connection:${connectionId}`);

        // Check if this was the last connection for the session
        const hasConnections = await hasRemainingConnections(redis, sessionId);

        if (!hasConnections) {
            console.log(`No remaining connections for session ${sessionId}, stopping task`);

            // Update session status
            await redis.hSet(`session:${sessionId}`, {
                status: 'disconnected',
                lastActivity: new Date().toISOString(),
            });

            // Stop Fargate task
            await stopTaskIfIdle(sessionId);

            // Set session expiration (cleanup in 1 hour)
            await redis.expire(`session:${sessionId}`, 3600);
            await redis.expire(`session:${sessionId}:connections`, 3600);
        } else {
            console.log(`Session ${sessionId} still has active connections`);

            // Update session last activity
            await redis.hSet(`session:${sessionId}`, {
                lastActivity: new Date().toISOString(),
            });
        }

        console.log(`Successfully cleaned up connection ${connectionId}`);

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Disconnected successfully',
                sessionId,
                connectionId,
            }),
        };

    } catch (error) {
        console.error('WebSocket disconnect error:', error);

        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Disconnect cleanup failed',
                details: error instanceof Error ? error.message : 'Unknown error',
            }),
        };
    }
}; 