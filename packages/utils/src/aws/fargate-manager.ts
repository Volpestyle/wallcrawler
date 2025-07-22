import { ECSClient, RunTaskCommand, DescribeTasksCommand } from '@aws-sdk/client-ecs';
import { initRedisClient } from '../redis/redis-client';

export interface FargateConfig {
    ecsClusterName: string;
    browserTaskDefinitionArn: string;
    redisEndpoint: string;
    redisTlsEnabled: boolean;
    environment: string;
    containerSubnets?: string[];
    containerSecurityGroupId?: string;
}

/**
 * Ensure Fargate task is running for session, spawn only if needed
 */
export async function ensureFargateTask(sessionId: string, config?: FargateConfig): Promise<any> {
    // Use config parameter or fall back to environment variables
    const fargateConfig = config || {
        ecsClusterName: process.env.ECS_CLUSTER_NAME!,
        browserTaskDefinitionArn: process.env.BROWSER_TASK_DEFINITION_ARN!,
        redisEndpoint: process.env.REDIS_ENDPOINT!,
        redisTlsEnabled: process.env.REDIS_TLS_ENABLED === 'true',
        environment: process.env.ENVIRONMENT || 'dev',
        containerSubnets: process.env.CONTAINER_SUBNETS?.split(','),
        containerSecurityGroupId: process.env.CONTAINER_SECURITY_GROUP_ID,
    };

    const redis = await initRedisClient();

    // Check if session already has a running task
    const sessionData = await redis.hGetAll(`session:${sessionId}`);
    const existingTaskArn = sessionData.taskArn;

    if (existingTaskArn && existingTaskArn !== 'unknown') {
        // Verify task is still running
        try {
            const ecsClient = new ECSClient({});
            const describeResponse = await ecsClient.send(
                new DescribeTasksCommand({
                    cluster: fargateConfig.ecsClusterName,
                    tasks: [existingTaskArn],
                })
            );

            const task = describeResponse.tasks?.[0];
            if (task && (task.lastStatus === 'RUNNING' || task.lastStatus === 'PENDING')) {
                console.log(`Task ${existingTaskArn} is already running for session ${sessionId}`);
                return {
                    taskArn: existingTaskArn,
                    status: task.lastStatus.toLowerCase(),
                    existing: true,
                };
            } else {
                console.log(`Task ${existingTaskArn} is not running (status: ${task?.lastStatus}), will spawn new task`);
                // Clear stale task ARN
                await redis.hDel(`session:${sessionId}`, 'taskArn');
            }
        } catch (error) {
            console.warn(`Failed to check existing task ${existingTaskArn}:`, error);
            // Clear potentially invalid task ARN
            await redis.hDel(`session:${sessionId}`, 'taskArn');
        }
    }

    // No running task found, spawn a new one
    return await spawnFargateTask(sessionId, fargateConfig);
}

/**
 * Spawn Fargate task for browser session with retry logic
 */
async function spawnFargateTask(sessionId: string, config: FargateConfig): Promise<any> {
    const maxRetries = 3;
    const baseDelayMs = 1000; // 1 second
    const maxDelayMs = 30000; // 30 seconds

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            console.log(`Spawning Fargate task for session ${sessionId} (attempt ${attempt + 1}/${maxRetries + 1})`);

            const ecsClient = new ECSClient({});
            const runTaskResponse = await ecsClient.send(
                new RunTaskCommand({
                    cluster: config.ecsClusterName,
                    taskDefinition: config.browserTaskDefinitionArn,
                    launchType: 'FARGATE',
                    networkConfiguration: {
                        awsvpcConfiguration: {
                            subnets: config.containerSubnets || [],
                            securityGroups: config.containerSecurityGroupId ? [config.containerSecurityGroupId] : [],
                            assignPublicIp: config.environment === 'dev' ? 'ENABLED' : 'DISABLED',
                        },
                    },
                    overrides: {
                        containerOverrides: [
                            {
                                name: 'BrowserContainer',
                                environment: [
                                    { name: 'SESSION_ID', value: sessionId },
                                    { name: 'REDIS_ENDPOINT', value: config.redisEndpoint },
                                    { name: 'REDIS_TLS_ENABLED', value: config.redisTlsEnabled.toString() },
                                ],
                            },
                        ],
                    },
                    tags: [
                        { key: 'SessionId', value: sessionId },
                        { key: 'Environment', value: config.environment },
                        { key: 'CreatedBy', value: 'WebSocketLambda' },
                    ],
                    // Add client token for idempotency
                    clientToken: `${sessionId}-${Date.now()}`,
                })
            );

            const taskArn = runTaskResponse.tasks?.[0]?.taskArn;
            if (!taskArn) {
                throw new Error('Failed to start Fargate task - no task ARN returned');
            }

            // Store task info in Redis
            const redis = await initRedisClient();
            await redis.hSet(`session:${sessionId}`, {
                taskArn,
                status: 'starting',
                taskStartedAt: new Date().toISOString(),
            });

            console.log(`Successfully started task ${taskArn} for session ${sessionId}`);

            return {
                taskArn,
                status: 'starting',
                createdAt: new Date().toISOString(),
                existing: false,
            };

        } catch (error: any) {
            const isRetryableError =
                error.name === 'ThrottlingException' ||
                error.name === 'ServiceUnavailableException' ||
                error.name === 'InternalServerError' ||
                error.message?.includes('Network interface provision') ||
                error.message?.includes('timeout') ||
                (error.$metadata?.httpStatusCode && error.$metadata.httpStatusCode >= 500);

            if (!isRetryableError || attempt === maxRetries) {
                console.error(`Failed to spawn Fargate task for session ${sessionId} after ${attempt + 1} attempts:`, error);
                throw new Error(`ECS RunTask failed: ${error.message || 'Unknown error'}`);
            }

            // Calculate delay with exponential backoff and jitter
            const delayMs = Math.min(
                baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000, // Add jitter
                maxDelayMs
            );

            console.warn(`Retryable error for session ${sessionId} (attempt ${attempt + 1}): ${error.message}. Retrying in ${delayMs}ms...`);

            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
}

// FargateConfig type is exported above with the interface declaration 