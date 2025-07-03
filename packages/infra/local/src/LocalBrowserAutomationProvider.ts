/**
 * Local Browser Automation Provider
 * Extends the base LocalProvider with automation-specific capabilities for development
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
  ProviderConfig,
  ProviderSession,
  SessionCreateParams,
  BrowserConnectionResult,
} from '@wallcrawler/stagehand';

import { InMemorySessionStateManager, InMemorySessionStateConfig } from './InMemorySessionStateManager';
import { ProcessTaskManager, ProcessTaskManagerConfig } from './utils/ProcessTaskManager';

/**
 * Configuration for Local Browser Automation Provider
 */
export interface LocalBrowserAutomationConfig extends ProviderConfig {
  /** In-memory session state configuration */
  sessionState?: InMemorySessionStateConfig;

  /** Process management configuration */
  processes?: Partial<ProcessTaskManagerConfig>;

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
 * Local provider with browser automation capabilities for development
 */
export class LocalBrowserAutomationProvider implements IBrowserProvider, IBrowserAutomationProvider {
  private readonly sessionStateManager: InMemorySessionStateManager;
  private readonly processTaskManager: ProcessTaskManager;
  private readonly containerCommunicator: ContainerCommunicator;
  private readonly taskMonitor: TaskMonitor;
  private readonly automationConfig: LocalBrowserAutomationConfig;

  // IBrowserProvider properties
  readonly type = 'local' as const;
  readonly name = 'Local Browser Automation Provider';

  constructor(config: LocalBrowserAutomationConfig = { type: 'local' }) {
    this.automationConfig = {
      ...config,
      type: 'local', // Ensure type is always 'local'
    };

    // Initialize session state manager
    this.sessionStateManager = new InMemorySessionStateManager({
      backend: 'memory',
      connectionConfig: {},
      sessionTtl: config.sessionState?.sessionTtl || 4 * 60 * 60, // 4 hours
      taskTtl: config.sessionState?.taskTtl || 8 * 60 * 60, // 8 hours
      cleanupInterval: config.sessionState?.cleanupInterval || 60 * 60, // 1 hour
      autoCleanup: config.sessionState?.autoCleanup ?? true,
      ...config.sessionState,
    });

    // Initialize process task manager
    this.processTaskManager = new ProcessTaskManager({
      workingDirectory: config.processes?.workingDirectory || process.cwd(),
      defaultCommand: config.processes?.defaultCommand || 'npm',
      defaultArgs: config.processes?.defaultArgs || ['run', 'dev'],
      defaultPort: config.processes?.defaultPort || config.container?.defaultPort || 3000,
      environment: config.processes?.environment || 'development',
      maxProcesses: config.processes?.maxProcesses || 10,
      processTimeout: config.processes?.processTimeout || 5 * 60 * 1000, // 5 minutes
      ...config.processes,
    });

    // Initialize container communicator
    this.containerCommunicator = new ContainerCommunicator({
      defaultPort: config.container?.defaultPort || 3000,
      healthCheckPath: config.container?.healthCheckPath || '/health',
      defaultTimeout: config.container?.timeout || 10000,
      defaultRetries: config.container?.retries || 3,
      enableLogging: true,
    });

    // Initialize task monitor
    this.taskMonitor = new TaskMonitor({
      checkInterval: config.monitoring?.interval || 10000, // 10 seconds for local
      maxTimeout: config.monitoring?.timeout || 5000, // 5 seconds for local
      enableLogging: true,
    });

    // Start monitoring if enabled
    if (config.monitoring?.enabled !== false) {
      this.startTaskMonitoring();
    }
  }

  // Task Management
  async startAutomationTask(config: AutomationTaskConfig): Promise<TaskInfo> {
    console.log(`[LocalBrowserAutomationProvider] Starting automation task for session: ${config.sessionId}`);

    try {
      // Start local process
      const taskInfo = await this.processTaskManager.startProcess(config);

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

      console.log(`[LocalBrowserAutomationProvider] Started task ${taskInfo.taskId}`);

      return taskInfo;
    } catch (error) {
      console.error('[LocalBrowserAutomationProvider] Failed to start automation task:', error);
      throw error;
    }
  }

  async stopAutomationTask(taskId: string, reason?: string): Promise<void> {
    console.log(`[LocalBrowserAutomationProvider] Stopping automation task: ${taskId}`);

    try {
      // Get session by task ID
      const session = await this.sessionStateManager.getSessionByTaskId(taskId);
      if (session && session.taskArn) {
        // Stop local process
        await this.processTaskManager.stopProcess(session.taskArn, reason);

        // Update session status
        await this.sessionStateManager.updateSessionStatus(session.id, 'stopping');
      }

      // Remove from monitoring
      this.taskMonitor.removeTask(taskId);

      console.log(`[LocalBrowserAutomationProvider] Stopped task ${taskId}`);
    } catch (error) {
      console.error('[LocalBrowserAutomationProvider] Failed to stop automation task:', error);
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

      // Get fresh process info
      const processInfo = await this.processTaskManager.getProcessInfo(session.taskArn);
      if (!processInfo) {
        return null;
      }

      // Merge with session state data
      return {
        ...processInfo,
        metadata: {
          ...processInfo.metadata,
          ...session.metadata,
          lastHeartbeat: session.lastHeartbeat,
        },
      };
    } catch (error) {
      console.error('[LocalBrowserAutomationProvider] Failed to get task info:', error);
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

      // Fall back to process search
      return this.processTaskManager.findProcessBySessionId(sessionId);
    } catch (error) {
      console.error('[LocalBrowserAutomationProvider] Failed to find task by session ID:', error);
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
      console.error('[LocalBrowserAutomationProvider] Failed to list active tasks:', error);
      return [];
    }
  }

  // Container Communication
  async getTaskEndpoint(taskId: string, timeoutMs: number = 30000): Promise<string | null> {
    try {
      const taskInfo = await this.getTaskInfo(taskId);
      if (!taskInfo) {
        return null;
      }

      const startTime = Date.now();

      while (Date.now() - startTime < timeoutMs) {
        // Get fresh task info
        const currentTaskInfo = await this.processTaskManager.getProcessInfo(taskInfo.taskArn);

        if (!currentTaskInfo || currentTaskInfo.lastStatus !== 'RUNNING') {
          await this.sleep(1000);
          continue;
        }

        // For local development, use localhost with the assigned port
        const port = currentTaskInfo.metadata?.port || this.automationConfig.container?.defaultPort || 3000;
        const connectUrl = `http://localhost:${port}`;

        if (connectUrl) {
          return connectUrl;
        }

        await this.sleep(1000);
      }

      throw new Error(`Timeout waiting for task endpoint: ${taskId}`);
    } catch (error) {
      console.error('[LocalBrowserAutomationProvider] Failed to get task endpoint:', error);
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
      const endpoint = await this.getTaskEndpoint(taskId, 5000);
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
      const endpoint = await this.getTaskEndpoint(taskId, 5000);
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
    // For local development, VNC streaming is typically not needed
    // But we can provide a placeholder or browser DevTools URL
    const taskInfo = await this.getTaskInfo(taskId);
    if (!taskInfo) {
      throw new Error(`Task ${taskId} not found`);
    }

    const port = taskInfo.metadata?.port || this.automationConfig.container?.defaultPort || 3000;
    const devToolsUrl = `http://localhost:${port}/devtools`;

    // Update session with dev tools URL
    const session = await this.sessionStateManager.getSessionByTaskId(taskId);
    if (session) {
      await this.sessionStateManager.updateSession(session.id, {
        vncUrl: devToolsUrl,
        status: 'running',
      });
    }

    return devToolsUrl;
  }

  async getContainerVncInfo(taskId: string): Promise<ContainerResponse<{ vncUrl?: string; status: string }>> {
    try {
      const endpoint = await this.getTaskEndpoint(taskId, 5000);
      if (!endpoint) {
        return {
          success: false,
          error: 'Could not get container endpoint',
        };
      }

      // For local development, return dev tools info instead of VNC
      return {
        success: true,
        data: {
          vncUrl: `${endpoint}/devtools`,
          status: 'available',
        },
      };
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
    this.taskMonitor.startMonitoring(async (taskId: string): Promise<HealthStatus | undefined> => {
      try {
        const healthResponse = await this.getContainerHealth(taskId);
        if (healthResponse.success && healthResponse.data && typeof healthResponse.data === 'object') {
          return healthResponse.data as HealthStatus;
        }
        return undefined;
      } catch (error) {
        console.error(`[LocalBrowserAutomationProvider] Health check failed for task ${taskId}:`, error);
        return undefined;
      }
    });
  }

  private stopTaskMonitoring(): void {
    this.taskMonitor.stopMonitoring();
  }

  // Enhanced cleanup
  async cleanup(): Promise<void> {
    console.log('[LocalBrowserAutomationProvider] Cleaning up resources...');

    try {
      // Stop task monitoring
      this.stopTaskMonitoring();

      // Stop all running processes
      const activeSessions = await this.sessionStateManager.getActiveSessions();
      const stopPromises = activeSessions.map(async (session) => {
        try {
          if (session.taskArn) {
            await this.processTaskManager.stopProcess(session.taskArn, 'Provider cleanup');
          }
        } catch (error) {
          console.error(`[LocalBrowserAutomationProvider] Error stopping task ${session.taskId}:`, error);
        }
      });

      await Promise.allSettled(stopPromises);

      // Cleanup session state manager
      await this.sessionStateManager.destroy();

      // Cleanup process manager
      await this.processTaskManager.cleanup();

      // Additional cleanup if needed

      console.log('[LocalBrowserAutomationProvider] Cleanup completed');
    } catch (error) {
      console.error('[LocalBrowserAutomationProvider] Error during cleanup:', error);
    }
  }

  // Utility methods
  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Get configuration
  getAutomationConfig(): LocalBrowserAutomationConfig {
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

  // IBrowserProvider methods - minimal implementation for automation focus
  async createSession(params: SessionCreateParams = {}): Promise<ProviderSession> {
    // For automation-focused usage, we create a simple session
    const sessionId = `local-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    return {
      sessionId,
      connectUrl: `http://localhost:${this.automationConfig.container?.defaultPort || 3000}`,
      provider: 'local',
      metadata: {
        type: 'automation',
        ...params.userMetadata,
      },
    };
  }

  async resumeSession(sessionId: string): Promise<ProviderSession> {
    // Try to get session from automation provider
    const session = await this.sessionStateManager.getSession(sessionId);
    if (session) {
      return {
        sessionId: session.id,
        connectUrl: session.browserUrl || `http://localhost:${this.automationConfig.container?.defaultPort || 3000}`,
        provider: 'local',
        metadata: session.metadata,
      };
    }
    throw new Error(`Session ${sessionId} not found`);
  }

  async connectToBrowser(_session: ProviderSession): Promise<BrowserConnectionResult> {
    // For automation provider, this method should not be used directly
    // Browser connections are managed through the automation task workflow
    throw new Error(
      'connectToBrowser is not supported for LocalBrowserAutomationProvider. ' +
        'Use startAutomationTask and getTaskEndpoint instead.'
    );
  }

  async endSession(sessionId: string): Promise<void> {
    await this.sessionStateManager.deleteSession(sessionId);
  }

  async saveArtifact(
    sessionId: string,
    path: string,
    data: Buffer
  ): Promise<{
    id: string;
    name: string;
    size: number;
    createdAt: Date;
    path: string;
    metadata: {
      sessionId: string;
      originalPath: string;
    };
  }> {
    // For local provider, save to filesystem
    const artifactId = `artifact-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const localPath = `/tmp/artifacts/${sessionId}/${artifactId}`;

    // In real implementation, you'd save the file to filesystem
    return {
      id: artifactId,
      name: path,
      size: data.length,
      createdAt: new Date(),
      path: localPath,
      metadata: {
        sessionId,
        originalPath: path,
      },
    };
  }

  async getArtifacts(
    _sessionId: string,
    _cursor?: string
  ): Promise<{ artifacts: []; totalCount: number; hasMore: boolean }> {
    // Return empty list for now - in real implementation, scan filesystem
    return {
      artifacts: [],
      totalCount: 0,
      hasMore: false,
    };
  }

  async downloadArtifact(sessionId: string, artifactId: string): Promise<Buffer> {
    // In real implementation, read file from filesystem
    throw new Error(`Artifact ${artifactId} not found for session ${sessionId}`);
  }
}
