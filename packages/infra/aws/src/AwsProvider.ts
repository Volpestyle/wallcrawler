/**
 * AWS Browser Automation Provider
 * Implements browser automation using AWS services:
 * - ECS Fargate for browser containers
 * - Redis (ElastiCache) for session state
 * - S3 for artifact storage
 * - API Gateway WebSocket for real-time communication
 * - CDP WebSocket proxy for Stagehand integration
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
} from '@wallcrawler/infra-common';

import { Browser, BrowserContext, Page, CDPSession } from '@playwright/test';

import { AwsProviderConfig, AwsTaskConfig } from './types';
import { AwsSessionStateManager } from './AwsSessionStateManager';
import { AwsTaskManager } from './utils/AwsTaskManager';
import { S3ArtifactManager } from './utils/S3ArtifactManager';
import { WebSocketManager } from './utils/WebSocketManager';
import {
  ContainerCommunicator,
  ScreencastOptions,
  InputEvent,
} from '@wallcrawler/infra-common';
import { SSMClient, GetParametersByPathCommand, GetParametersByPathCommandOutput } from '@aws-sdk/client-ssm';

// Import EventEmitter only if needed for custom events
import { EventEmitter } from 'events';

interface CdpResponse {
  id: number;
  result?: object;
  error?: { message: string; code?: number; data?: object };
}

/**
 * AWS Provider for browser automation
 * Orchestrates AWS services to provide scalable browser automation
 * with full Stagehand CDP proxy support
 */
export class AwsProvider extends EventEmitter implements IBrowserProvider, IBrowserAutomationProvider {
  // IBrowserProvider properties
  readonly type = 'aws' as const;
  readonly name = 'AWS Browser Automation Provider';

  private config: AwsProviderConfig;
  private sessionStateManager!: AwsSessionStateManager;
  private taskManager!: AwsTaskManager;
  private artifactManager!: S3ArtifactManager;
  private webSocketManager!: WebSocketManager;
  private containerCommunicator!: ContainerCommunicator;
  private isInitialized = false;

  // Reinstate pendingCommands for async CDP handling
  private pendingCommands = new Map<number, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void; }>();
  private cdpCommandId = 0;

  // Remove CDP proxy properties
  // private cdpWebSockets = new Map<string, WebSocket>();
  // private cdpCommandId = 0;
  // private pendingCommands = new Map<
  //   number,
  //   {
  //     resolve: (value: unknown) => void;
  //     reject: (reason?: unknown) => void;
  //   }
  // >();

  constructor(config: AwsProviderConfig) {
    super();
    this.config = config;
  }

  /**
   * Initialize the provider (async initialization)
   * This method must be called before using any provider methods
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // Load configuration from SSM if requested
    if (this.config.loadFromSsm) {
      await this.loadConfigFromSsm();
    }

    // Validate required configuration
    this.validateConfig();

    // Initialize session state manager with Redis
    this.sessionStateManager = new AwsSessionStateManager({
      backend: 'redis',
      connectionConfig: {
        endpoint: this.config.redis!.endpoint,
        port: this.config.redis!.port || 6379,
        password: this.config.redis!.password,
        db: this.config.redis!.db || 0,
      },
      sessionTtl: this.config.sessionState?.sessionTtl || 4 * 60 * 60, // 4 hours
      taskTtl: this.config.sessionState?.taskTtl || 8 * 60 * 60, // 8 hours
      cleanupInterval: this.config.sessionState?.cleanupInterval || 60 * 60, // 1 hour
      autoCleanup: this.config.sessionState?.autoCleanup ?? true,
      keyPrefix: 'wallcrawler:',
      heartbeatTimeout: 5 * 60, // 5 minutes
    });

    // Initialize ECS task manager
    this.taskManager = new AwsTaskManager({
      region: this.config.region,
      clusterName: this.config.ecsClusterName!,
      taskDefinition: this.config.ecsTaskDefinition!,
      subnetIds: this.config.subnetIds!,
      securityGroupIds: this.config.securityGroupIds!,
      autoScaling: this.config.autoScaling,
      costOptimization: this.config.costOptimization,
    });

    // Initialize S3 artifact manager (if configured)
    this.artifactManager = new S3ArtifactManager({
      region: this.config.s3?.region || this.config.region,
      bucketName: this.config.s3?.bucketName || '',
      keyPrefix: this.config.s3?.keyPrefix || 'artifacts/',
      enabled: !!this.config.s3?.bucketName,
    });

    // Initialize WebSocket manager (if configured)
    this.webSocketManager = new WebSocketManager({
      region: this.config.region,
      apiId: this.config.websocket?.apiId || '',
      stage: this.config.websocket?.stage || 'dev',
      endpoint: this.config.websocket?.endpoint,
      enabled: !!this.config.websocket?.apiId,
    });

    // Initialize container communicator
    this.containerCommunicator = new ContainerCommunicator({
      defaultPort: this.config.container?.browserPort || 8080,
      healthCheckPath: '/health',
      defaultTimeout: this.config.networking?.timeout || 30000,
      defaultRetries: 3,
      enableLogging: true,
    });

    this.isInitialized = true;
    console.log(`[AwsProvider] Initialized AWS provider in region ${this.config.region}`);
  }

  /**
   * Validate that all required configuration is present
   */
  private validateConfig(): void {
    if (!this.config.apiKey) {
      throw new Error('API key is required for authentication. Provide it in config.');
    }
    if (!this.config.redis?.endpoint) {
      throw new Error('Redis endpoint is required. Either provide it in config or enable loadFromSsm.');
    }
    if (!this.config.ecsClusterName) {
      throw new Error('ECS cluster name is required. Either provide it in config or enable loadFromSsm.');
    }
    if (!this.config.ecsTaskDefinition) {
      throw new Error('ECS task definition is required. Either provide it in config or enable loadFromSsm.');
    }
    if (!this.config.subnetIds || this.config.subnetIds.length === 0) {
      throw new Error('Subnet IDs are required. Either provide them in config or enable loadFromSsm.');
    }
    if (!this.config.securityGroupIds || this.config.securityGroupIds.length === 0) {
      throw new Error('Security Group IDs are required. Either provide them in config or enable loadFromSsm.');
    }
  }

  /**
   * Load configuration from AWS Systems Manager Parameter Store
   */
  private async loadConfigFromSsm(): Promise<void> {
    const region = this.config.region || 'us-east-1';
    const ssmClient = new SSMClient({ region });
    const projectName = this.config.projectName || 'wallcrawler';
    const environment = this.config.environment || 'dev';
    const path = `/${projectName}/${environment}/`;

    console.log(`[AwsProvider] Loading configuration from SSM path: ${path}`);

    let nextToken: string | undefined;
    do {
      const command = new GetParametersByPathCommand({
        Path: path,
        WithDecryption: true,
        NextToken: nextToken,
      });
      const response: GetParametersByPathCommandOutput = await ssmClient.send(command);

      response.Parameters?.forEach(param => {
        const name = param.Name?.replace(path, '') || '';
        const value = param.Value || '';

        switch (name) {
          case 'redis-endpoint':
            this.config.redis = { ...this.config.redis, endpoint: value };
            break;
          case 'ecs-cluster-name':
            this.config.ecsClusterName = value;
            break;
          case 'ecs-browser-task-definition':
            this.config.ecsTaskDefinition = value;
            break;
          case 'vpc-private-subnet-ids':
            try {
              this.config.subnetIds = JSON.parse(value);
            } catch (e) {
              console.error(`Failed to parse SSM parameter ${name}:`, e);
            }
            break;
          case 'container-security-group-id':
            this.config.securityGroupIds = [value]; // Single security group as array
            break;
          case 's3-bucket-name':
            this.config.s3 = { ...this.config.s3, bucketName: value };
            break;
          default:
            console.warn(`[AwsProvider] Unknown SSM parameter: ${name}`);
        }
      });

      nextToken = response.NextToken;
    } while (nextToken);

    console.log(`[AwsProvider] Loaded configuration from SSM successfully`);
  }

  /**
   * Ensure the provider is initialized before using
   */
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('AwsProvider must be initialized before use. Call initialize() first.');
    }
  }

  // =============================================================================
  // Task Management (IBrowserAutomationProvider)
  // =============================================================================

  async startAutomationTask(config: AutomationTaskConfig): Promise<TaskInfo> {
    this.ensureInitialized();
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
    this.ensureInitialized();
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



  // =============================================================================
  // Session State Management
  // =============================================================================

  getSessionStateManager(): ISessionStateManager {
    return this.sessionStateManager;
  }



  // =============================================================================
  // IBrowserProvider Methods
  // =============================================================================

  async createSession(params: SessionCreateParams = {}): Promise<ProviderSession> {
    this.ensureInitialized();
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

  async connectToBrowser(session: ProviderSession): Promise<BrowserConnectionResult> {
    this.ensureInitialized();
    console.log(`[AwsProvider] Connecting to browser for session: ${session.sessionId}`);

    try {
      // For now, check if session has a task associated
      const taskInfo = await this.findTaskBySessionId(session.sessionId);
      let endpoint: string | null = null;

      if (taskInfo) {
        // Get endpoint from existing task
        endpoint = await this.getTaskEndpoint(taskInfo.taskId);
      } else {
        // Start a new automation task for this session
        const taskConfig: AutomationTaskConfig = {
          sessionId: session.sessionId,
          userId: typeof session.metadata?.userId === 'string' ? session.metadata.userId : 'unknown',
          environment: typeof session.metadata?.environment === 'string' ? session.metadata.environment : 'dev',
          region: this.config.region,
        };

        const newTaskInfo = await this.startAutomationTask(taskConfig);
        endpoint = await this.getTaskEndpoint(newTaskInfo.taskId);
      }

      if (!endpoint) {
        throw new Error(`Could not get browser endpoint for session ${session.sessionId}`);
      }

      // Establish CDP WebSocket connection to container
      // This part is now handled by the webSocketManager and sessionStateManager
      // The createBrowserProxy will now return a proxy that routes through them

      // Create proxy browser that intercepts CDP calls
      const browser = this.createBrowserProxy(session);

      console.log(`[AwsProvider] Successfully connected to browser for session ${session.sessionId}`);

      return {
        browser,
        session,
      };
    } catch (error) {
      console.error('[AwsProvider] Failed to connect to browser:', error);
      throw new Error(`Failed to connect to browser: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Create browser proxy that intercepts CDP calls
   */
  private createBrowserProxy(session: ProviderSession): Browser {
    return {
      contexts: () => [this.createContextProxy(session)],
      close: async () => {
        // No direct CDP WebSocket close here, handled by webSocketManager
      },
      // Add other browser methods as needed
    } as Browser;
  }

  /**
   * Create context proxy
   */
  private createContextProxy(session: ProviderSession): BrowserContext {
    return {
      newCDPSession: async (_page?: Page) => {
        return this.createCDPSessionProxy(session);
      },
      pages: () => [this.createPageProxy(session)],
      close: async () => { },
      // Add other context methods as needed
    } as BrowserContext;
  }

  /**
   * Create page proxy
   */
  private createPageProxy(_session: ProviderSession): Page {
    return {
      // Add page methods as needed - most will be handled by CDP
    } as Page;
  }

  /**
   * Create CDP session proxy that routes commands over WebSocket
   */
  private createCDPSessionProxy(session: ProviderSession): CDPSession {
    return {
      send: async (method: string, params?: unknown) => {
        return this.sendCDPCommand(session.sessionId, method, params);
      },
      // Add other CDP session methods as needed
    } as CDPSession;
  }

  /**
   * Send CDP command over WebSocket to container
   */
  private async sendCDPCommand(sessionId: string, method: string, params: unknown = {}): Promise<unknown> {
    const connectionIds = await this.sessionStateManager.getConnections(sessionId);
    if (connectionIds.length === 0) {
      throw new Error(`No active connections for session ${sessionId}`);
    }

    const id = ++this.cdpCommandId;
    const message = {
      type: 'CDP_COMMAND',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingCommands.set(id, { resolve, reject });

      this.webSocketManager.sendCustomMessage(connectionIds, 'cdp_command', message)
        .then(() => {
          // Timeout after 30s
          setTimeout(() => {
            if (this.pendingCommands.has(id)) {
              this.pendingCommands.delete(id);
              reject(new Error(`CDP command timeout: ${method}`));
            }
          }, 30000);
        })
        .catch(reject);
    });
  }

  // Add a method to handle incoming responses (call this in initialize or on message from manager)
  private handleCDPResponse(sessionId: string, response: CdpResponse): void {
    const pending = this.pendingCommands.get(response.id);
    if (pending) {
      if (response.error) {
        pending.reject(new Error(response.error?.message ?? 'Unknown CDP error'));
      } else {
        pending.resolve(response.result);
      }
      this.pendingCommands.delete(response.id);
    }
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

      // Close CDP WebSocket if it exists
      // This part is now handled by webSocketManager

      console.log(`[AwsProvider] Ended session ${sessionId}`);
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

  /**
   * Start browser screencast for a session
   */
  async startScreencast(sessionId: string, options: ScreencastOptions = {}): Promise<void> {
    this.ensureInitialized();

    // Get connection IDs for this session
    const connectionIds = await this.sessionStateManager.getConnections(sessionId);
    if (connectionIds.length === 0) {
      throw new Error(`No active connections for session ${sessionId}`);
    }

    // Send screencast command via WebSocket manager to proxy
    const message = {
      type: 'START_SCREENCAST',
      sessionId,
      params: options,
    };

    await this.webSocketManager.sendCustomMessage(connectionIds, 'screencast_command', message);
  }

  /**
   * Stop browser screencast for a session
   */
  async stopScreencast(sessionId: string): Promise<void> {
    this.ensureInitialized();

    const connectionIds = await this.sessionStateManager.getConnections(sessionId);
    if (connectionIds.length === 0) return;

    const message = {
      type: 'STOP_SCREENCAST',
      sessionId,
    };

    await this.webSocketManager.sendCustomMessage(connectionIds, 'screencast_command', message);
  }

  /**
   * Send user input to remote browser
   */
  async sendInput(sessionId: string, inputEvent: InputEvent): Promise<void> {
    this.ensureInitialized();

    const connectionIds = await this.sessionStateManager.getConnections(sessionId);
    if (connectionIds.length === 0) {
      throw new Error(`No active connections for session ${sessionId}`);
    }

    const message = {
      type: 'SEND_INPUT',
      sessionId,
      event: inputEvent,
    };

    await this.webSocketManager.sendCustomMessage(connectionIds, 'input_command', message);
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

  async cleanup(): Promise<void> {
    this.ensureInitialized();
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
}
