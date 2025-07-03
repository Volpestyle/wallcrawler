/**
 * Common automation types for browser automation providers
 * Extracted and generalized from career-agent implementation
 */

export interface AutomationTaskConfig {
  /** Session ID that this task belongs to */
  sessionId: string;
  /** Environment name (dev, staging, production) */
  environment: string;
  /** AWS region or deployment region */
  region: string;
  /** Optional additional environment variables */
  environmentVariables?: Record<string, string>;
  /** Optional resource tags */
  tags?: Record<string, string>;
}

export interface TaskInfo {
  /** Unique task identifier (ECS task ID, process ID, etc.) */
  taskId: string;
  /** Task ARN or full identifier */
  taskArn: string;
  /** Current task status */
  status: string;
  /** Task creation timestamp */
  createdAt?: Date;
  /** Task start timestamp */
  startedAt?: Date;
  /** Task stop timestamp */
  stoppedAt?: Date;
  /** Last known status */
  lastStatus: string;
  /** Health status of the task */
  healthStatus?: string;
  /** Connection URL for HTTP communication */
  connectUrl?: string;
  /** VNC URL for visual debugging */
  vncUrl?: string;
  /** Private IP address */
  privateIp?: string;
  /** Public IP address */
  publicIp?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export interface ContainerResponse<T = unknown> {
  /** Whether the request was successful */
  success: boolean;
  /** Response data */
  data?: T | string;
  /** Error message if unsuccessful */
  error?: string;
  /** HTTP status code */
  statusCode?: number;
}

export interface HealthStatus {
  /** Health status string */
  status: string;
  /** Optional message */
  message?: string;
  /** Uptime in seconds */
  uptime?: number;
  /** Additional health metrics */
  metrics?: Record<string, unknown>;
}

/**
 * Task status enum for automation tasks
 */
export type TaskStatus = 
  | "starting" 
  | "running" 
  | "stopping" 
  | "stopped" 
  | "failed";

/**
 * Container endpoint methods
 */
export type ContainerMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

/**
 * Container endpoint configuration
 */
export interface ContainerEndpointConfig {
  /** Default container port */
  defaultPort: number;
  /** Health check endpoint path */
  healthCheckPath: string;
  /** VNC port for visual debugging */
  vncPort?: number;
  /** Default timeout for requests */
  defaultTimeout?: number;
}