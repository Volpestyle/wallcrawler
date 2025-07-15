/**
 * AWS Browser Automation Provider
 * Implements browser automation using AWS services:
 * - ECS Fargate for browser containers
 * - Redis (ElastiCache) for session state
 * - S3 for artifact storage
 * - API Gateway WebSocket for real-time communication
 */

import {
  IBrowserProvider,
  ProviderSession,
  SessionCreateParams,
  BrowserConnectionResult,
  Artifact,
  ArtifactList,
} from '@wallcrawler/stagehand';

import {
  IBrowserAutomationProvider,
  ISessionStateManager,
  AutomationTaskConfig,
  TaskInfo,
  ContainerResponse,
  HealthStatus,
  ContainerMethod,
  AutomationEvent,
} from '@wallcrawler/infra-common';

import { AwsProviderConfig, AwsTaskConfig } from './types';
import { AwsSessionStateManager } from './AwsSessionStateManager';
import { AwsTaskManager } from './utils/AwsTaskManager';
import { S3ArtifactManager } from './utils/S3ArtifactManager';
import { WebSocketManager } from './utils/WebSocketManager';
import { ContainerCommunicator } from '@wallcrawler/infra-common';

/**
 * AWS Provider for browser automation
 * Orchestrates AWS services to provide scalable browser automation
 */
export class AwsProvider implements IBrowserProvider, IBrowserAutomationProvider {
  // IBrowserProvider properties
  readonly type = 'aws' as const;
  readonly name = 'AWS Browser Automation Provider';

  private readonly config: AwsProviderConfig;
  private readonly sessionStateManager: AwsSessionStateManager;
  private readonly taskManager: AwsTaskManager;
  private readonly artifactManager: S3ArtifactManager;
  private readonly webSocketManager: WebSocketManager;
  private readonly containerCommunicator: ContainerCommunicator;

  constructor(config: AwsProviderConfig) {
    this.config = config;

    // Initialize session state manager with Redis
    this.sessionStateManager = new AwsSessionStateManager({
      backend: 'redis',
      connectionConfig: {
        endpoint: config.redis.endpoint,
        port: config.redis.port || 6379,
        password: config.redis.password,
        db: config.redis.db || 0,
      },
      sessionTtl: config.sessionState?.sessionTtl || 4 * 60 * 60, // 4 hours
      taskTtl: config.sessionState?.taskTtl || 8 * 60 * 60, // 8 hours
      cleanupInterval: config.sessionState?.cleanupInterval || 60 * 60, // 1 hour
      autoCleanup: config.sessionState?.autoCleanup ?? true,
      keyPrefix: 'wallcrawler:',
      heartbeatTimeout: 5 * 60, // 5 minutes
    });

    // Initialize ECS task manager
    this.taskManager = new AwsTaskManager({
      region: config.region,
      clusterName: config.ecsClusterName,
      taskDefinition: config.ecsTaskDefinition,
      subnetIds: config.subnetIds,
      securityGroupIds: config.securityGroupIds,
      autoScaling: config.autoScaling,
      costOptimization: config.costOptimization,
    });

    // Initialize S3 artifact manager (if configured)
    this.artifactManager = new S3ArtifactManager({
      region: config.s3?.region || config.region,
      bucketName: config.s3?.bucketName || '',
      keyPrefix: config.s3?.keyPrefix || 'artifacts/',
      enabled: !!config.s3?.bucketName,
    });

    // Initialize WebSocket manager (if configured)
    this.webSocketManager = new WebSocketManager({
      region: config.region,
      apiId: config.websocket?.apiId || '',
      stage: config.websocket?.stage || 'dev',
      endpoint: config.websocket?.endpoint,
      enabled: !!config.websocket?.apiId,
    });

    // Initialize container communicator
    this.containerCommunicator = new ContainerCommunicator({
      defaultPort: config.container?.browserPort || 8080,
      healthCheckPath: '/health',
      defaultTimeout: config.networking?.timeout || 30000,
      defaultRetries: 3,
      enableLogging: true,
    });

    console.log(`[AwsProvider] Initialized AWS provider in region ${config.region}`);
  }

  // =============================================================================
  // Task Management (IBrowserAutomationProvider)
  // =============================================================================

  async startAutomationTask(config: AutomationTaskConfig): Promise<TaskInfo> {
    console.log(`[AwsProvider] Starting automation task for session: ${config.sessionId}`);

    try {
      // Convert to AWS-specific task config
      const awsTaskConfig: AwsTaskConfig = {
        ...config,
        clusterName: this.config.ecsClusterName,
        taskDefinition: this.config.ecsTaskDefinition,
        subnetIds: this.config.subnetIds,
        securityGroupIds: this.config.securityGroupIds,
        useFargateSpot: this.config.costOptimization?.useFargateSpot,
        containerOverrides: {
          environment: {
            SESSION_ID: config.sessionId,
            USER_ID: config.userId,
            CONTAINER_USER_ID: config.userId, // Required by container app
            ENVIRONMENT: config.environment,
            REGION: config.region,
            REDIS_ENDPOINT: this.config.redis.endpoint,
            REDIS_PORT: (this.config.redis.port || 6379).toString(),
            ...(this.config.redis.password && { REDIS_PASSWORD: this.config.redis.password }),
            ...(this.config.websocket?.endpoint && { WEBSOCKET_ENDPOINT: this.config.websocket.endpoint }),
            ...config.environmentVariables,
          },
        },
      };

      // Start ECS task
      const taskInfo = await this.taskManager.startTask(awsTaskConfig);

      // Create session entry in state manager
      await this.sessionStateManager.createSession({
        id: `${config.sessionId}-${taskInfo.taskId}`,
        sessionId: config.sessionId,
        taskId: taskInfo.taskId,
        taskArn: taskInfo.taskArn,
        status: 'starting',
        startedAt: new Date(),
        updatedAt: new Date(),
        lastHeartbeat: new Date(),
        browserUrl: null,
        vncUrl: null,
        privateIp: null,
        publicIp: null,
        itemsProcessed: 0,
        metadata: {
          userId: config.userId,
          region: config.region,
          environment: config.environment,
          ...taskInfo.metadata,
        },
      });

      console.log(`[AwsProvider] Started ECS task ${taskInfo.taskId} for session ${config.sessionId}`);
      return taskInfo;
    } catch (error) {
      console.error('[AwsProvider] Failed to start automation task:', error);
      throw error;
    }
  }

  async stopAutomationTask(taskId: string, reason?: string): Promise<void> {
    console.log(`[AwsProvider] Stopping automation task: ${taskId}`);

    try {
      // Update session status first
      const session = await this.sessionStateManager.getSessionByTaskId(taskId);
      if (session) {
        await this.sessionStateManager.updateSessionStatus(session.id, 'stopping');
      }

      // Stop ECS task
      await this.taskManager.stopTask(taskId, reason);

      console.log(`[AwsProvider] Stopped ECS task ${taskId}`);
    } catch (error) {
      console.error('[AwsProvider] Failed to stop automation task:', error);
      throw error;
    }
  }

  async getTaskInfo(taskId: string): Promise<TaskInfo | null> {
    try {
      return await this.taskManager.getTaskInfo(taskId);
    } catch (error) {
      console.error('[AwsProvider] Failed to get task info:', error);
      return null;
    }
  }

  async findTaskBySessionId(sessionId: string): Promise<TaskInfo | null> {
    try {
      // First try session state manager
      const sessions = await this.sessionStateManager.getSessionsByParentId(sessionId);
      if (sessions.length > 0) {
        const session = sessions[0]; // Get the most recent
        return this.getTaskInfo(session.taskId);
      }

      // Fallback to ECS search
      return await this.taskManager.findTaskBySessionId(sessionId);
    } catch (error) {
      console.error('[AwsProvider] Failed to find task by session ID:', error);
      return null;
    }
  }

  async listActiveTasks(): Promise<TaskInfo[]> {
    try {
      const activeSessions = await this.sessionStateManager.getActiveSessions();
      const taskInfoPromises = activeSessions.map((session) => this.getTaskInfo(session.taskId));
      const taskInfos = await Promise.all(taskInfoPromises);
      return taskInfos.filter((info): info is TaskInfo => info !== null);
    } catch (error) {
      console.error('[AwsProvider] Failed to list active tasks:', error);
      return [];
    }
  }

  async getOrCreateUserContainer(userId: string): Promise<TaskInfo> {
    console.log(`[AwsProvider] Getting or creating container for user: ${userId}`);

    try {
      // First check if user has an existing container
      const existingContainer = await this.findContainerByUserId(userId);
      if (existingContainer) {
        console.log(`[AwsProvider] Found existing container ${existingContainer.taskId} for user ${userId}`);
        return existingContainer;
      }

      // Create new container for user
      const sessionId = `user-container-${userId}-${Date.now()}`;
      const taskConfig: AutomationTaskConfig = {
        sessionId,
        userId,
        environment: 'user-container',
        region: this.config.region,
        environmentVariables: {
          CONTAINER_MODE: 'user-dedicated',
        },
        tags: {
          ContainerType: 'UserDedicated',
        },
      };

      const taskInfo = await this.startAutomationTask(taskConfig);
      console.log(`[AwsProvider] Created new container ${taskInfo.taskId} for user ${userId}`);

      return taskInfo;
    } catch (error) {
      console.error('[AwsProvider] Failed to get or create user container:', error);
      throw error;
    }
  }

  async findContainerByUserId(userId: string): Promise<TaskInfo | null> {
    try {
      return await this.taskManager.findAvailableContainerForUser(userId);
    } catch (error) {
      console.error('[AwsProvider] Failed to find container by user ID:', error);
      return null;
    }
  }

  async listUserContainers(userId: string): Promise<TaskInfo[]> {
    try {
      return await this.taskManager.findTasksByUserId(userId);
    } catch (error) {
      console.error('[AwsProvider] Failed to list user containers:', error);
      return [];
    }
  }

  // =============================================================================
  // Container Communication
  // =============================================================================

  async getTaskEndpoint(taskId: string, timeoutMs: number = 60000): Promise<string | null> {
    try {
      return await this.taskManager.getTaskEndpoint(taskId, timeoutMs);
    } catch (error) {
      console.error('[AwsProvider] Failed to get task endpoint:', error);
      return null;
    }
  }

  async callContainerEndpoint<T = unknown>(
    endpoint: string,
    path: string,
    method: ContainerMethod = 'GET',
    body?: Record<string, unknown>,
    retries?: number
  ): Promise<ContainerResponse<T>> {
    return this.containerCommunicator.callEndpoint(endpoint, path, method, body, retries);
  }

  async startContainerAutomation(
    taskId: string,
    sessionId: string,
    params: Record<string, unknown>
  ): Promise<ContainerResponse<{ message: string; sessionId?: string }>> {
    try {
      const endpoint = await this.getTaskEndpoint(taskId);
      if (!endpoint) {
        return {
          success: false,
          error: 'Could not get container endpoint',
        };
      }

      return this.containerCommunicator.startAutomation(endpoint, sessionId, params);
    } catch (error) {
      return {
        success: false,
        error: `Failed to start container automation: ${error}`,
      };
    }
  }

  async stopContainerAutomation(taskId: string): Promise<ContainerResponse<{ message: string }>> {
    try {
      const endpoint = await this.getTaskEndpoint(taskId, 10000);
      if (!endpoint) {
        return {
          success: false,
          error: 'Could not get container endpoint',
        };
      }

      return this.containerCommunicator.stopAutomation(endpoint);
    } catch (error) {
      return {
        success: false,
        error: `Failed to stop container automation: ${error}`,
      };
    }
  }

  // =============================================================================
  // Health & Monitoring
  // =============================================================================

  async getContainerHealth(taskId: string): Promise<ContainerResponse<HealthStatus>> {
    try {
      const endpoint = await this.getTaskEndpoint(taskId, 10000);
      if (!endpoint) {
        return {
          success: false,
          error: 'Could not get container endpoint',
        };
      }

      return this.containerCommunicator.checkHealth(endpoint);
    } catch (error) {
      return {
        success: false,
        error: `Failed to get container health: ${error}`,
      };
    }
  }

  async enableVncStreaming(taskId: string): Promise<string> {
    try {
      const taskInfo = await this.getTaskInfo(taskId);
      if (!taskInfo || !taskInfo.privateIp) {
        throw new Error(`Task ${taskId} not found or no IP address available`);
      }

      const vncPort = this.config.container?.vncPort || 5900;
      const vncUrl = `vnc://${taskInfo.privateIp}:${vncPort}`;

      // Update session with VNC URL
      const session = await this.sessionStateManager.getSessionByTaskId(taskId);
      if (session) {
        await this.sessionStateManager.updateSession(session.id, {
          vncUrl,
          status: 'running',
        });
      }

      return vncUrl;
    } catch (error) {
      console.error('[AwsProvider] Failed to enable VNC streaming:', error);
      throw error;
    }
  }

  async getContainerVncInfo(taskId: string): Promise<ContainerResponse<{ vncUrl?: string; status: string }>> {
    try {
      const session = await this.sessionStateManager.getSessionByTaskId(taskId);
      if (!session) {
        return {
          success: false,
          error: 'Session not found',
        };
      }

      return {
        success: true,
        data: {
          vncUrl: session.vncUrl || undefined,
          status: session.vncUrl ? 'available' : 'not_configured',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get VNC info: ${error}`,
      };
    }
  }

  // =============================================================================
  // Session State Management
  // =============================================================================

  getSessionStateManager(): ISessionStateManager {
    return this.sessionStateManager;
  }

  // =============================================================================
  // Real-time Communication
  // =============================================================================

  async subscribeToEvents(sessionId: string, callback: (event: AutomationEvent) => void): Promise<string> {
    return this.sessionStateManager.subscribeToEvents(sessionId, callback);
  }

  async unsubscribeFromEvents(subscriptionId: string): Promise<void> {
    return this.sessionStateManager.unsubscribeFromEvents(subscriptionId);
  }

  async publishEvent(sessionId: string, eventType: string, data: Record<string, unknown>): Promise<void> {
    const event: AutomationEvent = {
      type: 'progress' as const,
      timestamp: new Date().toISOString(),
      sessionId,
      data: {
        progress: 0,
        message: eventType,
        ...data,
      },
    };

    return this.sessionStateManager.publishEvent(sessionId, event);
  }

  // =============================================================================
  // IBrowserProvider Methods
  // =============================================================================

  async createSession(params: SessionCreateParams = {}): Promise<ProviderSession> {
    const sessionId = `aws-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    return {
      sessionId,
      connectUrl: '', // Will be populated when task starts
      provider: 'aws',
      metadata: {
        type: 'automation',
        region: this.config.region,
        ...params.userMetadata,
      },
    };
  }

  async resumeSession(sessionId: string): Promise<ProviderSession> {
    const session = await this.sessionStateManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const endpoint = session.browserUrl || (await this.getTaskEndpoint(session.taskId));

    return {
      sessionId: session.id,
      connectUrl: endpoint || '',
      provider: 'aws',
      metadata: session.metadata,
    };
  }

  async connectToBrowser(_session: ProviderSession): Promise<BrowserConnectionResult> {
    throw new Error(
      'connectToBrowser is not supported for AwsProvider. ' + 'Use startAutomationTask and getTaskEndpoint instead.'
    );
  }

  async endSession(sessionId: string): Promise<void> {
    try {
      // Find and stop any running tasks for this session
      const task = await this.findTaskBySessionId(sessionId);
      if (task) {
        await this.stopAutomationTask(task.taskId, 'Session ended');
      }

      // Clean up session state
      await this.sessionStateManager.deleteSession(sessionId);
    } catch (error) {
      console.error('[AwsProvider] Failed to end session:', error);
      throw error;
    }
  }

  async saveArtifact(sessionId: string, filePath: string, data: Buffer): Promise<Artifact> {
    return this.artifactManager.saveArtifact(sessionId, filePath, data);
  }

  async getArtifacts(sessionId: string, cursor?: string): Promise<ArtifactList> {
    return this.artifactManager.getArtifacts(sessionId, cursor);
  }

  async downloadArtifact(sessionId: string, artifactId: string): Promise<Buffer> {
    return this.artifactManager.downloadArtifact(sessionId, artifactId);
  }

  // =============================================================================
  // Provider Management
  // =============================================================================

  async cleanup(): Promise<void> {
    console.log('[AwsProvider] Cleaning up AWS provider resources...');

    try {
      // Stop all active tasks
      const activeSessions = await this.sessionStateManager.getActiveSessions();
      const stopPromises = activeSessions.map(async (session) => {
        try {
          await this.taskManager.stopTask(session.taskId, 'Provider cleanup');
        } catch (error) {
          console.error(`[AwsProvider] Error stopping task ${session.taskId}:`, error);
        }
      });

      await Promise.allSettled(stopPromises);

      // Cleanup managers
      await this.sessionStateManager.destroy();
      await this.taskManager.cleanup();
      await this.webSocketManager.cleanup();

      console.log('[AwsProvider] Cleanup completed');
    } catch (error) {
      console.error('[AwsProvider] Error during cleanup:', error);
    }
  }

  // =============================================================================
  // Configuration and Utilities
  // =============================================================================

  getConfig(): AwsProviderConfig {
    return { ...this.config };
  }

  async getProviderStats(): Promise<{
    provider: { type: string; name: string; region: string };
    sessions: any;
    tasks: { running: number };
  }> {
    return {
      provider: {
        type: this.type,
        name: this.name,
        region: this.config.region,
      },
      sessions: await this.sessionStateManager.getStats(),
      tasks: {
        running: (await this.sessionStateManager.getActiveSessions()).length,
      },
    };
  }
}
