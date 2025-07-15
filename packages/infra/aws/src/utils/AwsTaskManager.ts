/**
 * AWS ECS Task Manager
 * Manages ECS Fargate tasks for browser automation containers
 */

import {
  ECSClient,
  RunTaskCommand,
  StopTaskCommand,
  DescribeTasksCommand,
  ListTasksCommand,
  Task,
  Container,
  Attachment,
  NetworkBinding,
} from '@aws-sdk/client-ecs';

import {
  ApplicationAutoScalingClient,
  RegisterScalableTargetCommand,
  PutScalingPolicyCommand,
} from '@aws-sdk/client-application-auto-scaling';

import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

import { TaskInfo } from '@wallcrawler/infra-common';
import { AwsTaskConfig, EcsTaskInfo, EcsContainerInfo, EcsNetworkBinding } from '../types';

export interface AwsTaskManagerConfig {
  region: string;
  clusterName: string;
  taskDefinition: string;
  subnetIds: string[];
  securityGroupIds: string[];
  autoScaling?: {
    minCapacity?: number;
    maxCapacity?: number;
    targetCpuUtilization?: number;
    targetMemoryUtilization?: number;
  };
  costOptimization?: {
    useFargateSpot?: boolean;
    enableHibernation?: boolean;
    idleTimeout?: number;
  };
}

/**
 * Manages ECS tasks for browser automation
 */
export class AwsTaskManager {
  private readonly ecsClient: ECSClient;
  private readonly autoScalingClient: ApplicationAutoScalingClient;
  private readonly cloudWatchClient: CloudWatchClient;
  private readonly config: AwsTaskManagerConfig;

  constructor(config: AwsTaskManagerConfig) {
    this.config = config;
    this.ecsClient = new ECSClient({ region: config.region });
    this.autoScalingClient = new ApplicationAutoScalingClient({ region: config.region });
    this.cloudWatchClient = new CloudWatchClient({ region: config.region });
  }

  // =============================================================================
  // Task Lifecycle Management
  // =============================================================================

  async startTask(config: AwsTaskConfig): Promise<TaskInfo> {
    console.log(`[AwsTaskManager] Starting ECS task for session: ${config.sessionId}`);

    try {
      const capacityProviderStrategy =
        config.useFargateSpot || this.config.costOptimization?.useFargateSpot
          ? [
              { capacityProvider: 'FARGATE_SPOT', weight: 1, base: 0 },
              { capacityProvider: 'FARGATE', weight: 0, base: 0 },
            ]
          : [{ capacityProvider: 'FARGATE', weight: 1, base: 1 }];

      const command = new RunTaskCommand({
        cluster: config.clusterName,
        taskDefinition: config.taskDefinition,
        launchType: undefined, // Use capacity provider strategy instead
        capacityProviderStrategy,
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: config.subnetIds,
            securityGroups: config.securityGroupIds,
            assignPublicIp: 'DISABLED', // Use private subnets with NAT
          },
        },
        overrides: {
          containerOverrides: config.containerOverrides
            ? [
                {
                  name: 'BrowserContainer', // Match container name from CDK
                  environment: Object.entries(config.containerOverrides.environment || {}).map(([name, value]) => ({
                    name,
                    value,
                  })),
                  ...(config.containerOverrides.cpu && { cpu: config.containerOverrides.cpu }),
                  ...(config.containerOverrides.memory && { memory: config.containerOverrides.memory }),
                },
              ]
            : undefined,
        },
        tags: Object.entries({
          UserId: config.userId,
          SessionId: config.sessionId,
          Environment: config.environment,
          ...(config.tags || {}),
        }).map(([key, value]) => ({ key, value })),
        enableExecuteCommand: true, // Enable ECS Exec for debugging
      });

      const response = await this.ecsClient.send(command);

      if (!response.tasks || response.tasks.length === 0) {
        throw new Error('Failed to start ECS task: No tasks returned');
      }

      const task = response.tasks[0];
      if (!task.taskArn) {
        throw new Error('Failed to start ECS task: No task ARN returned');
      }

      const taskId = this.extractTaskId(task.taskArn);

      // Send custom metric for task start
      await this.sendMetric('TasksStarted', 1, config.sessionId);

      const taskInfo: TaskInfo = {
        taskId,
        taskArn: task.taskArn,
        status: 'starting',
        lastStatus: task.lastStatus || 'UNKNOWN',
        createdAt: task.createdAt,
        healthStatus: task.healthStatus,
        metadata: {
          sessionId: config.sessionId,
          environment: config.environment,
          region: config.region,
          clusterName: config.clusterName,
          useFargateSpot: config.useFargateSpot,
        },
      };

      console.log(`[AwsTaskManager] Started ECS task: ${taskId}`);
      return taskInfo;
    } catch (error) {
      console.error('[AwsTaskManager] Failed to start ECS task:', error);
      throw error;
    }
  }

  async stopTask(taskId: string, reason?: string): Promise<void> {
    console.log(`[AwsTaskManager] Stopping ECS task: ${taskId}`);

    try {
      const taskArn = await this.resolveTaskArn(taskId);
      if (!taskArn) {
        throw new Error(`Task ${taskId} not found`);
      }

      const command = new StopTaskCommand({
        cluster: this.config.clusterName,
        task: taskArn,
        reason: reason || 'Stopped by AwsTaskManager',
      });

      await this.ecsClient.send(command);

      // Send custom metric for task stop
      await this.sendMetric('TasksStopped', 1);

      console.log(`[AwsTaskManager] Stopped ECS task: ${taskId}`);
    } catch (error) {
      console.error('[AwsTaskManager] Failed to stop ECS task:', error);
      throw error;
    }
  }

  async getTaskInfo(taskId: string): Promise<TaskInfo | null> {
    try {
      const taskArn = await this.resolveTaskArn(taskId);
      if (!taskArn) {
        return null;
      }

      const command = new DescribeTasksCommand({
        cluster: this.config.clusterName,
        tasks: [taskArn],
        include: ['TAGS'],
      });

      const response = await this.ecsClient.send(command);

      if (!response.tasks || response.tasks.length === 0) {
        return null;
      }

      const task = response.tasks[0];
      return this.convertEcsTaskToTaskInfo(task);
    } catch (error) {
      console.error('[AwsTaskManager] Failed to get task info:', error);
      return null;
    }
  }

  async findTaskBySessionId(sessionId: string): Promise<TaskInfo | null> {
    try {
      const command = new ListTasksCommand({
        cluster: this.config.clusterName,
        desiredStatus: 'RUNNING',
      });

      const response = await this.ecsClient.send(command);

      if (!response.taskArns || response.taskArns.length === 0) {
        return null;
      }

      // Get task details to check for session ID
      const describeCommand = new DescribeTasksCommand({
        cluster: this.config.clusterName,
        tasks: response.taskArns,
        include: ['TAGS'],
      });

      const describeResponse = await this.ecsClient.send(describeCommand);

      if (!describeResponse.tasks) {
        return null;
      }

      // Find task with matching session ID tag
      const matchingTask = describeResponse.tasks.find((task) => {
        return task.tags?.some((tag) => tag.key === 'SessionId' && tag.value === sessionId);
      });

      if (matchingTask) {
        return this.convertEcsTaskToTaskInfo(matchingTask);
      }

      return null;
    } catch (error) {
      console.error('[AwsTaskManager] Failed to find task by session ID:', error);
      return null;
    }
  }

  async findTasksByUserId(userId: string): Promise<TaskInfo[]> {
    try {
      const command = new ListTasksCommand({
        cluster: this.config.clusterName,
        desiredStatus: 'RUNNING',
      });

      const response = await this.ecsClient.send(command);

      if (!response.taskArns || response.taskArns.length === 0) {
        return [];
      }

      // Get task details to check for user ID
      const describeCommand = new DescribeTasksCommand({
        cluster: this.config.clusterName,
        tasks: response.taskArns,
        include: ['TAGS'],
      });

      const describeResponse = await this.ecsClient.send(describeCommand);

      if (!describeResponse.tasks) {
        return [];
      }

      // Find tasks with matching user ID tag
      const matchingTasks = describeResponse.tasks.filter((task) => {
        return task.tags?.some((tag) => tag.key === 'UserId' && tag.value === userId);
      });

      return matchingTasks.map((task) => this.convertEcsTaskToTaskInfo(task));
    } catch (error) {
      console.error('[AwsTaskManager] Failed to find tasks by user ID:', error);
      return [];
    }
  }

  async findAvailableContainerForUser(userId: string): Promise<TaskInfo | null> {
    try {
      const userTasks = await this.findTasksByUserId(userId);

      // For now, return the first running container for the user
      // In the future, we could add logic to check capacity
      const runningTasks = userTasks.filter((task) => task.status === 'running');

      return runningTasks.length > 0 ? runningTasks[0] : null;
    } catch (error) {
      console.error('[AwsTaskManager] Failed to find available container for user:', error);
      return null;
    }
  }

  async getTaskEndpoint(taskId: string, timeoutMs: number = 60000): Promise<string | null> {
    console.log(`[AwsTaskManager] Getting endpoint for task: ${taskId}`);

    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        const taskInfo = await this.getTaskInfo(taskId);

        if (!taskInfo || taskInfo.lastStatus !== 'RUNNING') {
          await this.sleep(5000);
          continue;
        }

        // Get the private IP from the task
        if (taskInfo.privateIp) {
          const port = 8080; // Browser container port from CDK
          const endpoint = `http://${taskInfo.privateIp}:${port}`;

          console.log(`[AwsTaskManager] Found endpoint for task ${taskId}: ${endpoint}`);
          return endpoint;
        }

        await this.sleep(5000);
      } catch (error) {
        console.error(`[AwsTaskManager] Error getting task endpoint: ${error}`);
        await this.sleep(5000);
      }
    }

    console.error(`[AwsTaskManager] Timeout waiting for task endpoint: ${taskId}`);
    return null;
  }

  // =============================================================================
  // Task Information Conversion
  // =============================================================================

  private convertEcsTaskToTaskInfo(task: Task): TaskInfo {
    const taskId = task.taskArn ? this.extractTaskId(task.taskArn) : 'unknown';

    // Extract private IP from network attachments
    let privateIp: string | undefined;
    if (task.attachments) {
      for (const attachment of task.attachments) {
        if (attachment.type === 'ElasticNetworkInterface') {
          const privateIpDetail = attachment.details?.find((detail) => detail.name === 'privateIPv4Address');
          if (privateIpDetail?.value) {
            privateIp = privateIpDetail.value;
            break;
          }
        }
      }
    }

    // Extract session ID and user ID from tags - both are required
    const sessionIdTag = task.tags?.find((tag) => tag.key === 'SessionId');
    const userIdTag = task.tags?.find((tag) => tag.key === 'UserId');
    const sessionId = sessionIdTag?.value;
    const userId = userIdTag?.value;

    if (!userId) {
      throw new Error(`Task ${taskId} is missing required UserId tag`);
    }

    return {
      taskId,
      taskArn: task.taskArn || '',
      userId,
      status: this.mapEcsStatusToTaskStatus(task.lastStatus),
      lastStatus: task.lastStatus || 'UNKNOWN',
      healthStatus: task.healthStatus,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      stoppedAt: task.stoppedAt,
      privateIp,
      metadata: {
        sessionId,
        userId,
        clusterArn: task.clusterArn,
        taskDefinitionArn: task.taskDefinitionArn,
        desiredStatus: task.desiredStatus,
        cpu: task.cpu,
        memory: task.memory,
        version: task.version,
        containers: task.containers?.map(this.convertContainer),
        attachments: task.attachments?.map(this.convertAttachment),
      },
    };
  }

  private convertContainer(container: Container): EcsContainerInfo {
    return {
      name: container.name || '',
      containerArn: container.containerArn,
      lastStatus: container.lastStatus,
      healthStatus: container.healthStatus,
      exitCode: container.exitCode,
      reason: container.reason,
      networkBindings: container.networkBindings?.map(this.convertNetworkBinding) || [],
    };
  }

  private convertNetworkBinding(binding: NetworkBinding): EcsNetworkBinding {
    return {
      bindIP: binding.bindIP,
      containerPort: binding.containerPort,
      hostPort: binding.hostPort,
      protocol: binding.protocol,
    };
  }

  private convertAttachment(attachment: Attachment) {
    return {
      id: attachment.id,
      type: attachment.type,
      status: attachment.status,
      details: attachment.details || [],
    };
  }

  private mapEcsStatusToTaskStatus(ecsStatus?: string): string {
    switch (ecsStatus) {
      case 'PENDING':
        return 'starting';
      case 'RUNNING':
        return 'running';
      case 'STOPPING':
        return 'stopping';
      case 'STOPPED':
        return 'stopped';
      default:
        return 'unknown';
    }
  }

  // =============================================================================
  // Utility Methods
  // =============================================================================

  private extractTaskId(taskArn: string): string {
    // Extract task ID from ARN like: arn:aws:ecs:region:account:task/cluster-name/task-id
    const parts = taskArn.split('/');
    return parts[parts.length - 1];
  }

  private async resolveTaskArn(taskId: string): Promise<string | null> {
    // If it's already an ARN, return it
    if (taskId.startsWith('arn:aws:ecs:')) {
      return taskId;
    }

    // Otherwise, search for the task by ID
    try {
      const command = new ListTasksCommand({
        cluster: this.config.clusterName,
      });

      const response = await this.ecsClient.send(command);

      if (!response.taskArns) {
        return null;
      }

      // Find matching task ARN
      return response.taskArns.find((arn) => arn.endsWith(`/${taskId}`)) || null;
    } catch (error) {
      console.error('[AwsTaskManager] Failed to resolve task ARN:', error);
      return null;
    }
  }

  private async sendMetric(metricName: string, value: number, sessionId?: string): Promise<void> {
    try {
      const command = new PutMetricDataCommand({
        Namespace: 'Wallcrawler/Application',
        MetricData: [
          {
            MetricName: metricName,
            Value: value,
            Unit: 'Count',
            Timestamp: new Date(),
            Dimensions: sessionId
              ? [
                  {
                    Name: 'SessionId',
                    Value: sessionId,
                  },
                ]
              : undefined,
          },
        ],
      });

      await this.cloudWatchClient.send(command);
    } catch (error) {
      console.error('[AwsTaskManager] Failed to send metric:', error);
      // Don't throw - metrics are not critical
    }
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // =============================================================================
  // Cleanup and Management
  // =============================================================================

  async cleanup(): Promise<void> {
    console.log('[AwsTaskManager] Cleaning up ECS task manager...');

    try {
      // Stop all running tasks (optional - might want to leave them running)
      const command = new ListTasksCommand({
        cluster: this.config.clusterName,
        desiredStatus: 'RUNNING',
      });

      const response = await this.ecsClient.send(command);

      if (response.taskArns && response.taskArns.length > 0) {
        console.log(`[AwsTaskManager] Found ${response.taskArns.length} running tasks during cleanup`);
        // Optionally stop them here if needed
      }
    } catch (error) {
      console.error('[AwsTaskManager] Error during cleanup:', error);
    }
  }

  // =============================================================================
  // Auto Scaling (Future Enhancement)
  // =============================================================================

  async setupAutoScaling(): Promise<void> {
    if (!this.config.autoScaling) {
      return;
    }

    try {
      // Register scalable target
      const registerCommand = new RegisterScalableTargetCommand({
        ServiceNamespace: 'ecs',
        ResourceId: `service/${this.config.clusterName}/${this.config.clusterName}-browser-service`,
        ScalableDimension: 'ecs:service:DesiredCount',
        MinCapacity: this.config.autoScaling.minCapacity || 1,
        MaxCapacity: this.config.autoScaling.maxCapacity || 10,
      });

      await this.autoScalingClient.send(registerCommand);

      // Setup CPU scaling policy
      if (this.config.autoScaling.targetCpuUtilization) {
        const cpuPolicyCommand = new PutScalingPolicyCommand({
          PolicyName: `${this.config.clusterName}-cpu-scaling`,
          ServiceNamespace: 'ecs',
          ResourceId: `service/${this.config.clusterName}/${this.config.clusterName}-browser-service`,
          ScalableDimension: 'ecs:service:DesiredCount',
          PolicyType: 'TargetTrackingScaling',
          TargetTrackingScalingPolicyConfiguration: {
            TargetValue: this.config.autoScaling.targetCpuUtilization,
            PredefinedMetricSpecification: {
              PredefinedMetricType: 'ECSServiceAverageCPUUtilization',
            },
            ScaleOutCooldown: 120, // 2 minutes
            ScaleInCooldown: 600, // 10 minutes
          },
        });

        await this.autoScalingClient.send(cpuPolicyCommand);
      }

      console.log('[AwsTaskManager] Auto scaling configured');
    } catch (error) {
      console.error('[AwsTaskManager] Failed to setup auto scaling:', error);
    }
  }
}
