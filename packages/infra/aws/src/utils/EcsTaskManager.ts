/**
 * ECS Task Manager - Extracted and generalized from career-agent
 * Handles ECS Fargate task lifecycle management for browser automation
 */

import {
  ECSClient,
  RunTaskCommand,
  StopTaskCommand,
  DescribeTasksCommand,
  ListTasksCommand,
  Task,
} from '@aws-sdk/client-ecs';

import {
  AutomationTaskConfig,
  TaskInfo,
  TaskStatus,
} from '@wallcrawler/infra-common';

/**
 * Configuration for ECS Task Manager
 */
export interface EcsTaskManagerConfig {
  /** AWS region */
  region: string;
  /** ECS cluster name */
  clusterName: string;
  /** Task definition name/ARN */
  taskDefinition: string;
  /** VPC subnets for task placement */
  subnets: string[];
  /** Security groups for task networking */
  securityGroups: string[];
  /** Container name in task definition */
  containerName?: string;
  /** Service name for task discovery */
  serviceName?: string;
  /** Environment name */
  environment?: string;
}

/**
 * ECS Task Manager for handling Fargate tasks
 */
export class EcsTaskManager {
  private readonly client: ECSClient;
  private readonly config: Required<EcsTaskManagerConfig>;

  constructor(config: EcsTaskManagerConfig) {
    this.client = new ECSClient({ region: config.region });
    
    this.config = {
      ...config,
      containerName: config.containerName ?? 'AutomationContainer',
      serviceName: config.serviceName ?? `automation-${config.environment ?? 'dev'}`,
      environment: config.environment ?? 'dev',
    };
  }

  /**
   * Start a new ECS task for automation
   */
  async startTask(taskConfig: AutomationTaskConfig): Promise<TaskInfo> {
    try {
      console.log(
        `[EcsTaskManager] Starting automation task for session: ${taskConfig.sessionId}`
      );

      const runTaskResponse = await this.client.send(
        new RunTaskCommand({
          cluster: this.config.clusterName,
          taskDefinition: this.config.taskDefinition,
          launchType: 'FARGATE',
          networkConfiguration: {
            awsvpcConfiguration: {
              subnets: this.config.subnets,
              securityGroups: this.config.securityGroups,
              assignPublicIp: 'DISABLED', // Private subnets with NAT
            },
          },
          overrides: {
            containerOverrides: [
              {
                name: this.config.containerName,
                environment: [
                  { name: 'SESSION_ID', value: taskConfig.sessionId },
                  { name: 'ENVIRONMENT', value: taskConfig.environment },
                  { name: 'REGION', value: taskConfig.region },
                  // Add any additional environment variables
                  ...Object.entries(taskConfig.environmentVariables ?? {}).map(([key, value]) => ({
                    name: key,
                    value,
                  })),
                ],
              },
            ],
          },
          tags: [
            { key: 'SessionId', value: taskConfig.sessionId },
            { key: 'Environment', value: taskConfig.environment },
            { key: 'Component', value: 'automation' },
            // Add any additional tags
            ...Object.entries(taskConfig.tags ?? {}).map(([key, value]) => ({
              key,
              value,
            })),
          ],
          enableExecuteCommand: true, // For debugging if needed
        })
      );

      if (!runTaskResponse.tasks || runTaskResponse.tasks.length === 0) {
        throw new Error('Failed to start automation task');
      }

      const task = runTaskResponse.tasks[0];
      const taskInfo: TaskInfo = {
        taskId: this.extractTaskId(task.taskArn!),
        taskArn: task.taskArn!,
        status: 'STARTING',
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        stoppedAt: task.stoppedAt,
        lastStatus: task.lastStatus || 'PENDING',
        healthStatus: task.healthStatus,
        metadata: {
          sessionId: taskConfig.sessionId,
          environment: taskConfig.environment,
          clusterName: this.config.clusterName,
        },
      };

      console.log(
        `[EcsTaskManager] Started task ${taskInfo.taskId} for session ${taskConfig.sessionId}`
      );

      return taskInfo;
    } catch (error) {
      console.error('[EcsTaskManager] Error starting automation task:', error);
      throw new Error(`Failed to start automation: ${error}`);
    }
  }

  /**
   * Stop an ECS task
   */
  async stopTask(taskArn: string, reason?: string): Promise<void> {
    try {
      console.log(`[EcsTaskManager] Stopping automation task: ${taskArn}`);

      await this.client.send(
        new StopTaskCommand({
          cluster: this.config.clusterName,
          task: taskArn,
          reason: reason || 'User requested stop',
        })
      );

      console.log(`[EcsTaskManager] Automation task stopped: ${taskArn}`);
    } catch (error) {
      console.error('[EcsTaskManager] Error stopping automation task:', error);
      throw new Error(`Failed to stop automation: ${error}`);
    }
  }

  /**
   * Get information about a specific task
   */
  async getTaskInfo(taskArn: string): Promise<TaskInfo | null> {
    try {
      const response = await this.client.send(
        new DescribeTasksCommand({
          cluster: this.config.clusterName,
          tasks: [taskArn],
          include: ['TAGS'],
        })
      );

      if (!response.tasks || response.tasks.length === 0) {
        return null;
      }

      const task = response.tasks[0];

      return {
        taskId: this.extractTaskId(task.taskArn!),
        taskArn: task.taskArn!,
        status: task.lastStatus || 'UNKNOWN',
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        stoppedAt: task.stoppedAt,
        lastStatus: task.lastStatus || 'UNKNOWN',
        healthStatus: task.healthStatus,
        privateIp: this.extractPrivateIp(task),
        publicIp: this.extractPublicIp(task),
        metadata: {
          clusterName: this.config.clusterName,
          tags: task.tags?.reduce((acc, tag) => {
            if (tag.key && tag.value) {
              acc[tag.key] = tag.value;
            }
            return acc;
          }, {} as Record<string, string>),
        },
      };
    } catch (error) {
      console.error('[EcsTaskManager] Error getting task info:', error);
      throw new Error(`Failed to get task info: ${error}`);
    }
  }

  /**
   * Find a task by session ID using tags
   */
  async findTaskBySessionId(sessionId: string): Promise<TaskInfo | null> {
    try {
      // List tasks with our service
      const listResponse = await this.client.send(
        new ListTasksCommand({
          cluster: this.config.clusterName,
          serviceName: this.config.serviceName,
        })
      );

      if (!listResponse.taskArns || listResponse.taskArns.length === 0) {
        return null;
      }

      // Get detailed task info
      const describeResponse = await this.client.send(
        new DescribeTasksCommand({
          cluster: this.config.clusterName,
          tasks: listResponse.taskArns,
          include: ['TAGS'],
        })
      );

      // Find task with matching SessionId tag
      const matchingTask = describeResponse.tasks?.find((task: Task) =>
        task.tags?.some(
          (tag: { key?: string; value?: string }) => 
            tag.key === 'SessionId' && tag.value === sessionId
        )
      );

      if (!matchingTask) {
        return null;
      }

      return this.getTaskInfo(matchingTask.taskArn!);
    } catch (error) {
      console.error('[EcsTaskManager] Error finding task by session ID:', error);
      return null;
    }
  }

  /**
   * List all active tasks
   */
  async listActiveTasks(): Promise<TaskInfo[]> {
    try {
      const listResponse = await this.client.send(
        new ListTasksCommand({
          cluster: this.config.clusterName,
          serviceName: this.config.serviceName,
          desiredStatus: 'RUNNING',
        })
      );

      if (!listResponse.taskArns || listResponse.taskArns.length === 0) {
        return [];
      }

      const describeResponse = await this.client.send(
        new DescribeTasksCommand({
          cluster: this.config.clusterName,
          tasks: listResponse.taskArns,
          include: ['TAGS'],
        })
      );

      const taskInfoPromises = (describeResponse.tasks || []).map((task: Task) =>
        this.getTaskInfo(task.taskArn!)
      );

      const taskInfos = await Promise.all(taskInfoPromises);
      return taskInfos.filter((info): info is TaskInfo => info !== null);
    } catch (error) {
      console.error('[EcsTaskManager] Error listing active tasks:', error);
      return [];
    }
  }

  /**
   * Wait for task to reach a specific status
   */
  async waitForTaskStatus(
    taskArn: string,
    targetStatus: string,
    maxWaitTime: number = 300000
  ): Promise<TaskInfo | null> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const taskInfo = await this.getTaskInfo(taskArn);

      if (!taskInfo) {
        throw new Error(`Task ${taskArn} not found`);
      }

      if (taskInfo.lastStatus === targetStatus) {
        return taskInfo;
      }

      if (taskInfo.lastStatus === 'STOPPED') {
        throw new Error(`Task ${taskArn} stopped unexpectedly`);
      }

      await this.sleep(5000); // Wait 5 seconds before retry
    }

    throw new Error(
      `Task ${taskArn} did not reach status ${targetStatus} within ${maxWaitTime}ms`
    );
  }

  /**
   * Extract task ID from task ARN
   */
  private extractTaskId(taskArn: string): string {
    // Extract task ID from ARN: arn:aws:ecs:region:account:task/cluster/task-id
    const parts = taskArn.split('/');
    return parts[parts.length - 1];
  }

  /**
   * Extract private IP from ECS task networking details
   */
  private extractPrivateIp(task: Task): string | undefined {
    if (task.attachments) {
      for (const attachment of task.attachments) {
        if (
          attachment.type === 'ElasticNetworkInterface' &&
          attachment.details
        ) {
          for (const detail of attachment.details) {
            if (detail.name === 'privateIPv4Address' && detail.value) {
              return detail.value;
            }
          }
        }
      }
    }
    return undefined;
  }

  /**
   * Extract public IP from ECS task networking details
   */
  private extractPublicIp(task: Task): string | undefined {
    if (task.attachments) {
      for (const attachment of task.attachments) {
        if (
          attachment.type === 'ElasticNetworkInterface' &&
          attachment.details
        ) {
          for (const detail of attachment.details) {
            if (detail.name === 'publicIPv4Address' && detail.value) {
              return detail.value;
            }
          }
        }
      }
    }
    return undefined;
  }

  /**
   * Sleep utility
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get ECS client configuration
   */
  getConfig(): EcsTaskManagerConfig {
    return { ...this.config };
  }
}