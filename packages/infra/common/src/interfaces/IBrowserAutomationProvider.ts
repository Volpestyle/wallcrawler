/**
 * Enhanced browser provider interface for automation tasks
 * Extends the base IBrowserProvider with automation-specific capabilities
 */

import { AutomationTaskConfig, TaskInfo, ContainerResponse, HealthStatus, ContainerMethod } from '../types/automation';
import { ISessionStateManager } from './ISessionStateManager';

/**
 * Base browser provider interface (to avoid circular dependency with stagehand)
 */
export interface IBrowserProvider {
  /** Provider type identifier */
  readonly type: string;
  /** Provider display name */
  readonly name: string;
  createSession(params?: any): Promise<any>;
  resumeSession(sessionId: string): Promise<any>;
  connectToBrowser(session: any): Promise<any>;
  endSession(sessionId: string): Promise<void>;
  saveArtifact(sessionId: string, path: string, data: Buffer): Promise<any>;
  getArtifacts(sessionId: string, cursor?: string): Promise<any>;
  downloadArtifact(sessionId: string, artifactId: string): Promise<Buffer>;
  cleanup?(): Promise<void>;
}

/**
 * Enhanced browser provider interface with automation capabilities
 */
export interface IBrowserAutomationProvider extends IBrowserProvider {
  // Task Management
  /**
   * Start a new automation task (ECS task, Docker container, process, etc.)
   */
  startAutomationTask(config: AutomationTaskConfig): Promise<TaskInfo>;

  /**
   * Stop a running automation task
   */
  stopAutomationTask(taskId: string, reason?: string): Promise<void>;

  /**
   * Get information about a specific task
   */
  getTaskInfo(taskId: string): Promise<TaskInfo | null>;

  /**
   * Find a task by session ID
   */
  findTaskBySessionId(sessionId: string): Promise<TaskInfo | null>;

  /**
   * List all active tasks
   */
  listActiveTasks(): Promise<TaskInfo[]>;

  // Container Communication
  /**
   * Get the HTTP endpoint for a running task
   */
  getTaskEndpoint(taskId: string, timeoutMs?: number): Promise<string | null>;

  /**
   * Call an HTTP endpoint on a running container
   */
  callContainerEndpoint<T = unknown>(
    endpoint: string,
    path: string,
    method?: ContainerMethod,
    body?: Record<string, unknown>,
    retries?: number
  ): Promise<ContainerResponse<T>>;

  // Health & Monitoring
  /**
   * Get container health status
   */
  getContainerHealth(taskId: string): Promise<ContainerResponse<HealthStatus>>;

  // Session State Management
  /**
   * Get the session state manager for this provider
   */
  getSessionStateManager(): ISessionStateManager;
}

/**
 * Configuration for browser automation providers
 */
export interface BrowserAutomationConfig {
  /** Base provider configuration */
  provider: IBrowserProvider;

  /** Session state management configuration */
  sessionState?: {
    /** TTL for sessions in seconds */
    sessionTtl?: number;
    /** TTL for tasks in seconds */
    taskTtl?: number;
    /** Cleanup interval in seconds */
    cleanupInterval?: number;
  };

  /** Container networking configuration */
  networking?: {
    /** Default container port */
    containerPort?: number;
    /** Health check endpoint */
    healthCheckPath?: string;
    /** Request timeout in milliseconds */
    timeout?: number;
  };
}
