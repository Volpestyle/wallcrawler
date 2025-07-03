/**
 * Enhanced browser provider interface for automation tasks
 * Extends the base IBrowserProvider with automation-specific capabilities
 */

import { IBrowserProvider } from '@wallcrawler/stagehand';

import { AutomationTaskConfig, TaskInfo, ContainerResponse, HealthStatus, ContainerMethod } from '../types/automation';
import { AutomationEvent } from '../types/events';
import { ISessionStateManager } from './ISessionStateManager';

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

  /**
   * Start container automation with specific parameters
   */
  startContainerAutomation(
    taskId: string,
    sessionId: string,
    params: Record<string, unknown>
  ): Promise<ContainerResponse<{ message: string; sessionId?: string }>>;

  /**
   * Stop container automation
   */
  stopContainerAutomation(taskId: string): Promise<ContainerResponse<{ message: string }>>;

  // Health & Monitoring
  /**
   * Get container health status
   */
  getContainerHealth(taskId: string): Promise<ContainerResponse<HealthStatus>>;

  /**
   * Enable VNC streaming for visual debugging
   */
  enableVncStreaming(taskId: string): Promise<string>;

  /**
   * Get VNC connection information
   */
  getContainerVncInfo(taskId: string): Promise<ContainerResponse<{ vncUrl?: string; status: string }>>;

  // Session State Management
  /**
   * Get the session state manager for this provider
   */
  getSessionStateManager(): ISessionStateManager;

  // Real-time Communication
  /**
   * Subscribe to real-time events for a session
   */
  subscribeToEvents(sessionId: string, callback: (event: AutomationEvent) => void): Promise<string>;

  /**
   * Unsubscribe from real-time events
   */
  unsubscribeFromEvents(subscriptionId: string): Promise<void>;

  /**
   * Publish an event to all subscribers of a session
   */
  publishEvent(sessionId: string, eventType: string, data: Record<string, unknown>): Promise<void>;
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
    /** VNC port */
    vncPort?: number;
    /** Health check endpoint */
    healthCheckPath?: string;
    /** Request timeout in milliseconds */
    timeout?: number;
  };

  /** Real-time communication configuration */
  realtime?: {
    /** Enable real-time events */
    enabled?: boolean;
    /** Event retention time in seconds */
    eventRetention?: number;
  };
}
