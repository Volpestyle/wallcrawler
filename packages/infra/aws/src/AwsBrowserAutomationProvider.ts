/**
 * Enhanced AWS Browser Automation Provider
 * Extends the base AwsProvider with automation-specific capabilities
 */

import {
  IBrowserAutomationProvider,
  ISessionStateManager,
  AutomationTaskConfig,
  TaskInfo,
  ContainerResponse,
  HealthStatus,
  ContainerMethod,
  ContainerCommunicator,
  TaskMonitor,
  TaskMonitorStats,
  AutomationEvent,
} from '@wallcrawler/infra-common';

import {
  IBrowserProvider,
  ProviderSession,
  SessionCreateParams,
  Artifact,
  ArtifactList,
  BrowserConnectionResult,
  ProviderType,
} from '@wallcrawler/stagehand';

import { RedisSessionStateManager, RedisSessionStateConfig } from './RedisSessionStateManager';
import { EcsTaskManager, EcsTaskManagerConfig } from './utils/EcsTaskManager';
import { NetworkExtractor, NetworkExtractorConfig } from './utils/NetworkExtractor';

/**
 * Configuration for AWS Browser Automation Provider
 */
export interface AwsBrowserAutomationConfig {
  /** AWS region */
  region?: string;
  
  /** ECS cluster name */
  ecsCluster?: string;
  
  /** VPC configuration */
  vpcConfig?: {
    subnets: string[];
    securityGroups: string[];
  };
  /** Redis configuration for session state */
  redis?: RedisSessionStateConfig;
  
  /** ECS configuration */
  ecs?: Partial<EcsTaskManagerConfig>;
  
  /** Network configuration */
  networking?: NetworkExtractorConfig;
  
  /** Container communication configuration */
  container?: {
    /** Default container port */
    defaultPort?: number;
    /** Health check path */
    healthCheckPath?: string;
    /** Default timeout for requests */
    timeout?: number;
    /** Default retries */
    retries?: number;
  };
  
  /** Task monitoring configuration */
  monitoring?: {
    /** Enable automatic task monitoring */
    enabled?: boolean;
    /** Monitoring interval */
    interval?: number;
    /** Health check timeout */
    timeout?: number;
  };
}

/**
 * Enhanced AWS provider with browser automation capabilities
 */
export class AwsBrowserAutomationProvider implements IBrowserProvider, IBrowserAutomationProvider {
  readonly type: ProviderType = 'aws';
  readonly name = 'AWS Browser Automation Provider';
  private readonly sessionStateManager: RedisSessionStateManager;
  private readonly ecsTaskManager: EcsTaskManager;
  private readonly networkExtractor: NetworkExtractor;
  private readonly containerCommunicator: ContainerCommunicator;
  private readonly taskMonitor: TaskMonitor;
  private readonly automationConfig: AwsBrowserAutomationConfig;

  constructor(config: AwsBrowserAutomationConfig) {
    this.automationConfig = config;

    // Initialize session state manager
    this.sessionStateManager = new RedisSessionStateManager({
      backend: 'redis',
      connectionConfig: {},
      redisUrl: config.redis?.redisUrl || process.env.REDIS_URL,
      sessionTtl: config.redis?.sessionTtl || 4 * 60 * 60,
      taskTtl: config.redis?.taskTtl || 8 * 60 * 60,
      keyPrefix: config.redis?.keyPrefix || 'automation',
      autoCleanup: config.redis?.autoCleanup ?? true,
      ...config.redis,
    });

    // Initialize ECS task manager
    this.ecsTaskManager = new EcsTaskManager({
      region: config.region || process.env.AWS_REGION || 'us-east-1',
      clusterName: config.ecsCluster || process.env.ECS_CLUSTER_NAME || 'automation-cluster',
      taskDefinition: config.ecs?.taskDefinition || process.env.ECS_TASK_DEFINITION || 'automation-task',
      subnets: config.vpcConfig?.subnets || [],
      securityGroups: config.vpcConfig?.securityGroups || [],
      containerName: config.ecs?.containerName || 'AutomationContainer',
      environment: config.ecs?.environment || process.env.NODE_ENV || 'dev',
      ...config.ecs,
    });

    // Initialize network extractor
    this.networkExtractor = new NetworkExtractor({
      loadBalancerDns: config.networking?.loadBalancerDns || process.env.AUTOMATION_LOAD_BALANCER_DNS,
      defaultPort: config.networking?.defaultPort || config.container?.defaultPort || 3000,
      vncPort: config.networking?.vncPort || 6080,
      ...config.networking,
    });

    // Initialize container communicator
    this.containerCommunicator = new ContainerCommunicator({
      defaultPort: config.container?.defaultPort || 3000,
      healthCheckPath: config.container?.healthCheckPath || '/health',
      defaultTimeout: config.container?.timeout || 30000,
      defaultRetries: config.container?.retries || 3,
      enableLogging: true,
    });

    // Initialize task monitor
    this.taskMonitor = new TaskMonitor({
      checkInterval: config.monitoring?.interval || 30000,
      maxTimeout: config.monitoring?.timeout || 10000,
      enableLogging: true,
    });

    // Start monitoring if enabled
    if (config.monitoring?.enabled !== false) {
      this.startTaskMonitoring();
    }
  }

  // Task Management
  async startAutomationTask(config: AutomationTaskConfig): Promise<TaskInfo> {
    console.log(`[AwsBrowserAutomationProvider] Starting automation task for session: ${config.sessionId}`);

    try {
      // Start ECS task
      const taskInfo = await this.ecsTaskManager.startTask(config);

      // Create browser session in session state
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
        privateIp: taskInfo.privateIp || null,
        publicIp: taskInfo.publicIp || null,
        itemsProcessed: 0,
        metadata: taskInfo.metadata,
      });

      // Add to monitoring
      this.taskMonitor.addTask(taskInfo.taskId);

      console.log(`[AwsBrowserAutomationProvider] Started task ${taskInfo.taskId}`);
      
      return taskInfo;
    } catch (error) {
      console.error('[AwsBrowserAutomationProvider] Failed to start automation task:', error);
      throw error;
    }
  }

  async stopAutomationTask(taskId: string, reason?: string): Promise<void> {
    console.log(`[AwsBrowserAutomationProvider] Stopping automation task: ${taskId}`);

    try {
      // Get session by task ID
      const session = await this.sessionStateManager.getSessionByTaskId(taskId);
      if (session && session.taskArn) {
        // Stop ECS task
        await this.ecsTaskManager.stopTask(session.taskArn, reason);

        // Update session status
        await this.sessionStateManager.updateSessionStatus(session.id, 'stopping');
      }

      // Remove from monitoring
      this.taskMonitor.removeTask(taskId);

      console.log(`[AwsBrowserAutomationProvider] Stopped task ${taskId}`);
    } catch (error) {
      console.error('[AwsBrowserAutomationProvider] Failed to stop automation task:', error);
      throw error;
    }
  }

  async getTaskInfo(taskId: string): Promise<TaskInfo | null> {
    try {
      // Get session by task ID
      const session = await this.sessionStateManager.getSessionByTaskId(taskId);
      if (!session || !session.taskArn) {
        return null;
      }

      // Get fresh ECS task info
      const ecsTaskInfo = await this.ecsTaskManager.getTaskInfo(session.taskArn);
      if (!ecsTaskInfo) {
        return null;
      }

      // Merge with session state data
      return {
        ...ecsTaskInfo,
        metadata: {
          ...ecsTaskInfo.metadata,
          ...session.metadata,
          vncUrl: session.vncUrl,
          lastHeartbeat: session.lastHeartbeat,
        },
      };
    } catch (error) {
      console.error('[AwsBrowserAutomationProvider] Failed to get task info:', error);
      return null;
    }
  }

  async findTaskBySessionId(sessionId: string): Promise<TaskInfo | null> {
    try {
      // Try session state first - get sessions by parent session ID
      const sessions = await this.sessionStateManager.getSessionsByParentId(sessionId);
      if (sessions.length > 0) {
        // Get the most recent session
        const session = sessions[0];
        return this.getTaskInfo(session.taskId);
      }

      // Fall back to ECS search
      return this.ecsTaskManager.findTaskBySessionId(sessionId);
    } catch (error) {
      console.error('[AwsBrowserAutomationProvider] Failed to find task by session ID:', error);
      return null;
    }
  }

  async listActiveTasks(): Promise<TaskInfo[]> {
    try {
      const activeSessions = await this.sessionStateManager.getActiveSessions();
      const taskInfoPromises = activeSessions.map(session => this.getTaskInfo(session.taskId));
      const taskInfos = await Promise.all(taskInfoPromises);
      
      return taskInfos.filter((info): info is TaskInfo => info !== null);
    } catch (error) {
      console.error('[AwsBrowserAutomationProvider] Failed to list active tasks:', error);
      return [];
    }
  }

  // Container Communication
  async getTaskEndpoint(taskId: string, timeoutMs: number = 120000): Promise<string | null> {
    try {
      const taskInfo = await this.getTaskInfo(taskId);
      if (!taskInfo) {
        return null;
      }

      const startTime = Date.now();

      while (Date.now() - startTime < timeoutMs) {
        // Get fresh task info
        const currentTaskInfo = await this.ecsTaskManager.getTaskInfo(taskInfo.taskArn);
        
        if (!currentTaskInfo || currentTaskInfo.lastStatus !== 'RUNNING') {
          await this.sleep(5000);
          continue;
        }

        // Use network extractor to get endpoint
        const connectUrl = this.networkExtractor.constructConnectUrl(
          currentTaskInfo.privateIp,
          currentTaskInfo.publicIp
        );

        if (connectUrl) {
          return connectUrl;
        }

        await this.sleep(5000);
      }

      throw new Error(`Timeout waiting for task endpoint: ${taskId}`);
    } catch (error) {
      console.error('[AwsBrowserAutomationProvider] Failed to get task endpoint:', error);
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

  // Health & Monitoring
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
    const taskInfo = await this.getTaskInfo(taskId);
    if (!taskInfo) {
      throw new Error(`Task ${taskId} not found`);
    }

    const vncUrl = this.networkExtractor.constructVncUrl(
      taskInfo.privateIp,
      taskInfo.publicIp
    );

    if (!vncUrl) {
      throw new Error(`Could not construct VNC URL for task ${taskId}`);
    }

    // Update session with VNC URL
    const session = await this.sessionStateManager.getSessionByTaskId(taskId);
    if (session) {
      await this.sessionStateManager.updateSession(session.id, { 
        vncUrl,
        status: 'running'
      });
    }

    return vncUrl;
  }

  async getContainerVncInfo(taskId: string): Promise<ContainerResponse<{ vncUrl?: string; status: string }>> {
    try {
      const endpoint = await this.getTaskEndpoint(taskId, 10000);
      if (!endpoint) {
        return {
          success: false,
          error: 'Could not get container endpoint',
        };
      }

      return this.containerCommunicator.getVncInfo(endpoint);
    } catch (error) {
      return {
        success: false,
        error: `Failed to get VNC info: ${error}`,
      };
    }
  }

  // Session State Management
  getSessionStateManager(): ISessionStateManager {
    return this.sessionStateManager;
  }

  // Real-time Communication
  async subscribeToEvents(sessionId: string, callback: (event: AutomationEvent) => void): Promise<string> {
    return this.sessionStateManager.subscribeToEvents(sessionId, callback);
  }

  async unsubscribeFromEvents(subscriptionId: string): Promise<void> {
    return this.sessionStateManager.unsubscribeFromEvents(subscriptionId);
  }

  async publishEvent(sessionId: string, eventType: string, data: Record<string, unknown>): Promise<void> {
    // Create a basic event structure that matches the union type
    const event: AutomationEvent = {
      type: 'progress' as const, // Default to progress type for generic events
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

  // Task Monitoring
  private startTaskMonitoring(): void {
    this.taskMonitor.startMonitoring(async (taskId: string) => {
      try {
        const healthResponse = await this.getContainerHealth(taskId);
        if (healthResponse.success && healthResponse.data && typeof healthResponse.data === 'object') {
          return healthResponse.data;
        }
        return undefined;
      } catch (error) {
        console.error(`[AwsBrowserAutomationProvider] Health check failed for task ${taskId}:`, error);
        return undefined;
      }
    });
  }

  private stopTaskMonitoring(): void {
    this.taskMonitor.stopMonitoring();
  }

  // IBrowserProvider methods
  async createSession(params: SessionCreateParams = {}): Promise<ProviderSession> {
    const sessionId = `aws-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Create browser session
    const browserSession = {
      id: sessionId,
      sessionId,
      taskId: `task-${sessionId}`,
      taskArn: null,
      status: 'starting' as const,
      startedAt: new Date(),
      updatedAt: new Date(),
      lastHeartbeat: new Date(),
      browserUrl: null,
      vncUrl: null,
      privateIp: null,
      publicIp: null,
      itemsProcessed: 0,
      metadata: { type: 'automation', ...params.userMetadata },
    };
    
    await this.sessionStateManager.createSession(browserSession);
    
    return {
      sessionId,
      provider: 'aws',
      metadata: { type: 'automation', ...params.userMetadata },
    };
  }

  async resumeSession(sessionId: string): Promise<ProviderSession> {
    const session = await this.sessionStateManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    
    // Update session as resumed
    await this.sessionStateManager.updateSession(sessionId, {
      status: 'running',
      updatedAt: new Date(),
    });
    
    return {
      sessionId,
      provider: 'aws',
      metadata: session.metadata,
    };
  }

  async connectToBrowser(session: ProviderSession): Promise<BrowserConnectionResult> {
    // Find or start automation task for this session
    let taskInfo = await this.findTaskBySessionId(session.sessionId);
    
    if (!taskInfo) {
      // Start a new automation task
      const config = {
        sessionId: session.sessionId,
        region: this.automationConfig.region || 'us-east-1',
        taskDefinition: this.automationConfig.ecs?.taskDefinition || 'automation-task',
        containerName: this.automationConfig.ecs?.containerName || 'AutomationContainer',
        environment: this.automationConfig.ecs?.environment || 'dev',
      };
      
      taskInfo = await this.startAutomationTask(config);
    }
    
    // Get the endpoint URL
    const connectUrl = await this.getTaskEndpoint(taskInfo.taskId);
    if (!connectUrl) {
      throw new Error(`Failed to get connection URL for session ${session.sessionId}`);
    }
    
    // For AWS provider, we return browser connection info
    // The actual Browser instance would be created by the caller using Playwright
    return {
      browser: null as any, // Will be set by caller
      session: {
        ...session,
        connectUrl,
        debugUrl: taskInfo.metadata?.debugUrl as string,
      },
    };
  }

  async endSession(sessionId: string): Promise<void> {
    // Find and stop any running tasks
    const taskInfo = await this.findTaskBySessionId(sessionId);
    if (taskInfo) {
      await this.stopAutomationTask(taskInfo.taskId, 'Session ended');
    }
    
    // Clean up session data
    await this.sessionStateManager.deleteSession(sessionId);
  }

  async saveArtifact(sessionId: string, path: string, data: Buffer): Promise<Artifact> {
    // For AWS provider, we could save to S3, but for now just create artifact metadata
    const artifactId = `${sessionId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const artifact: Artifact = {
      id: artifactId,
      name: path.split('/').pop() || path,
      size: data.length,
      mimeType: this.getMimeType(path),
      createdAt: new Date(),
      path,
      metadata: { sessionId },
    };
    
    // TODO: Implement actual S3 storage here
    console.log(`[AwsBrowserAutomationProvider] Would save artifact ${artifactId} to S3`);
    
    return artifact;
  }

  async getArtifacts(sessionId: string, cursor?: string): Promise<ArtifactList> {
    // TODO: Implement actual artifact listing from S3
    console.log(`[AwsBrowserAutomationProvider] Would list artifacts for session ${sessionId}`);
    
    return {
      artifacts: [],
      totalCount: 0,
      hasMore: false,
    };
  }

  async downloadArtifact(sessionId: string, artifactId: string): Promise<Buffer> {
    // TODO: Implement actual artifact download from S3
    console.log(`[AwsBrowserAutomationProvider] Would download artifact ${artifactId} for session ${sessionId}`);
    
    return Buffer.alloc(0);
  }

  private getMimeType(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      pdf: 'application/pdf',
      txt: 'text/plain',
      json: 'application/json',
    };
    return mimeTypes[ext || ''] || 'application/octet-stream';
  }

  // Enhanced cleanup
  async cleanup(): Promise<void> {
    console.log('[AwsBrowserAutomationProvider] Cleaning up resources...');

    try {
      // Stop task monitoring
      this.stopTaskMonitoring();

      // Stop all running tasks
      const activeSessions = await this.sessionStateManager.getActiveSessions();
      const stopPromises = activeSessions.map(async (session) => {
        try {
          if (session.taskArn) {
            await this.ecsTaskManager.stopTask(session.taskArn, 'Provider cleanup');
          }
        } catch (error) {
          console.error(`[AwsBrowserAutomationProvider] Error stopping task ${session.taskId}:`, error);
        }
      });

      await Promise.allSettled(stopPromises);

      // Cleanup session state manager
      await this.sessionStateManager.destroy();

      // No parent cleanup needed

      console.log('[AwsBrowserAutomationProvider] Cleanup completed');
    } catch (error) {
      console.error('[AwsBrowserAutomationProvider] Error during cleanup:', error);
    }
  }

  // Utility methods
  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Get configuration
  getAutomationConfig(): AwsBrowserAutomationConfig {
    return { ...this.automationConfig };
  }

  // Get monitoring stats
  async getMonitoringStats(): Promise<{
    provider: {
      type: string;
      name: string;
    };
    sessions: {
      totalSessions: number;
      activeSessions: number;
      pausedSessions: number;
      failedSessions: number;
      totalConnections: number;
      staleInfrastructure: number;
    };
    tasks: {
      monitored: TaskMonitorStats;
      running: number;
    };
    monitoring: TaskMonitorStats;
  }> {
    return {
      provider: {
        type: this.type,
        name: this.name,
      },
      sessions: await this.sessionStateManager.getStats(),
      tasks: {
        monitored: this.taskMonitor.getStats(),
        running: (await this.sessionStateManager.getActiveSessions()).length,
      },
      monitoring: this.taskMonitor.getStats(),
    };
  }
}