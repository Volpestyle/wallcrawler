import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { initRedisClient } from '@wallcrawler/utils/redis';
import { ECSClient, StopTaskCommand, DescribeTasksCommand } from '@aws-sdk/client-ecs';

const ecsClient = new ECSClient({});
const CLUSTER_NAME = process.env.ECS_CLUSTER_NAME!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const sessionId = event.pathParameters?.sessionId;
        if (!sessionId) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    success: false,
                    message: 'Session ID is required'
                }),
            };
        }

        const redis = await initRedisClient();

        // Get session data
        const sessionData = await redis.hGetAll(`session:${sessionId}`);
        if (!sessionData || Object.keys(sessionData).length === 0) {
            return {
                statusCode: 404,
                body: JSON.stringify({
                    success: false,
                    message: 'Session not found'
                }),
            };
        }

        // Stop ECS task if exists
        const taskArn = sessionData.taskArn;
        if (taskArn && taskArn !== 'unknown') {
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
                    console.log(`Stopping task ${taskArn} for session ${sessionId}`);

                    await ecsClient.send(
                        new StopTaskCommand({
                            cluster: CLUSTER_NAME,
                            task: taskArn,
                            reason: 'Session ended by client',
                        })
                    );
                }
            } catch (error) {
                console.error(`Failed to stop task ${taskArn}:`, error);
            }
        }

        // Clean up session data
        await redis.del(`session:${sessionId}`);
        await redis.del(`session:${sessionId}:connections`);
        await redis.del(`session:${sessionId}:messages`);
        await redis.del(`session:${sessionId}:commands`);

        // Clean up connection mappings
        const connections = await redis.sMembers(`session:${sessionId}:connections`);
        for (const connectionId of connections) {
            await redis.del(`connection:${connectionId}`);
        }

        console.log(`Session ${sessionId} ended successfully`);

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                success: true,
                message: 'Session ended successfully'
            }),
        };

    } catch (error) {
        console.error('Error ending session:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                success: false,
                message: 'Failed to end session',
                error: error instanceof Error ? error.message : 'Unknown error',
            }),
        };
    }
}; 