/**
 * AWS-specific types for browser automation
 */

import { BrowserAutomationConfig, SessionStateManagerConfig, AutomationTaskConfig } from '@wallcrawler/infra-common';

/**
 * AWS Provider Configuration
 */
export interface AwsProviderConfig extends BrowserAutomationConfig {
  /** AWS region */
  region: string;

  /** WallCrawler API key for authentication */
  apiKey?: string;

  /** ECS cluster name (required unless loadFromSsm is true) */
  ecsClusterName?: string;

  /** ECS task definition name (required unless loadFromSsm is true) */
  ecsTaskDefinition?: string;

  /** ECS service name */
  ecsServiceName?: string;

  /** VPC subnet IDs for task deployment (required unless loadFromSsm is true) */
  subnetIds?: string[];

  /** Security group IDs for tasks (required unless loadFromSsm is true) */
  securityGroupIds?: string[];

  /** Redis configuration (required unless loadFromSsm is true) */
  redis?: {
    /** Redis cluster endpoint */
    endpoint: string;
    /** Redis port */
    port?: number;
    /** Redis password (optional) */
    password?: string;
    /** Redis database number */
    db?: number;
  };

  /** S3 configuration for artifacts */
  s3?: {
    /** S3 bucket name for artifacts */
    bucketName: string;
    /** S3 bucket region (defaults to provider region) */
    region?: string;
    /** Key prefix for artifacts */
    keyPrefix?: string;
  };

  /** WebSocket API configuration */
  websocket?: {
    /** API Gateway WebSocket API ID */
    apiId: string;
    /** WebSocket API stage */
    stage: string;
    /** API endpoint URL */
    endpoint?: string;
  };

  /** Container configuration */
  container?: {
    /** Browser container port */
    browserPort?: number;
    /** Health check port */
    healthPort?: number;
    /** CDP (Chrome DevTools Protocol) port */
    cdpPort?: number;
    /** VNC port for remote access */
    vncPort?: number;
    /** Container resource requirements */
    resources?: {
      cpu?: number;
      memory?: number;
    };
  };

  /** Auto-scaling configuration */
  autoScaling?: {
    /** Minimum task count */
    minCapacity?: number;
    /** Maximum task count */
    maxCapacity?: number;
    /** Target CPU utilization for scaling */
    targetCpuUtilization?: number;
    /** Target memory utilization for scaling */
    targetMemoryUtilization?: number;
  };

  /** Cost optimization settings */
  costOptimization?: {
    /** Use Fargate Spot instances */
    useFargateSpot?: boolean;
    /** Enable task hibernation for idle sessions */
    enableHibernation?: boolean;
    /** Idle timeout before stopping tasks (seconds) */
    idleTimeout?: number;
  };

  /** Session state management configuration */
  sessionState?: {
    /** Session TTL in seconds */
    sessionTtl?: number;
    /** Task TTL in seconds */
    taskTtl?: number;
    /** Cleanup interval in seconds */
    cleanupInterval?: number;
    /** Enable automatic cleanup */
    autoCleanup?: boolean;
  };

  /** SSM-based configuration loading */
  loadFromSsm?: boolean;
  /** Project name for SSM parameter path (defaults to 'wallcrawler') */
  projectName?: string;
  /** Environment for SSM parameter path (defaults to 'dev') */
  environment?: string;
}

/**
 * AWS Session State Manager Configuration
 */
export interface AwsSessionStateConfig extends SessionStateManagerConfig {
  backend: 'redis';
  connectionConfig: {
    endpoint: string;
    port?: number;
    password?: string;
    db?: number;
  };
}

/**
 * AWS Task Configuration
 */
export interface AwsTaskConfig extends AutomationTaskConfig {
  /** ECS cluster name */
  clusterName: string;
  /** Task definition ARN or name */
  taskDefinition: string;
  /** Subnet IDs for deployment */
  subnetIds: string[];
  /** Security group IDs */
  securityGroupIds: string[];
  /** Use Fargate Spot */
  useFargateSpot?: boolean;
  /** Container overrides */
  containerOverrides?: {
    /** Environment variable overrides */
    environment?: Record<string, string>;
    /** CPU override */
    cpu?: number;
    /** Memory override */
    memory?: number;
  };
}

/**
 * ECS Task Information
 */
export interface EcsTaskInfo {
  /** ECS Task ARN */
  taskArn: string;
  /** ECS Cluster ARN */
  clusterArn: string;
  /** Task definition ARN */
  taskDefinitionArn: string;
  /** Task status */
  lastStatus: string;
  /** Desired status */
  desiredStatus: string;
  /** Health status */
  healthStatus?: string;
  /** Task creation time */
  createdAt?: Date;
  /** Task start time */
  startedAt?: Date;
  /** Task stop time */
  stoppedAt?: Date;
  /** Container instances */
  containers: EcsContainerInfo[];
  /** Network attachments */
  attachments: EcsAttachment[];
  /** Task metadata */
  metadata?: Record<string, unknown>;
}

/**
 * ECS Container Information
 */
export interface EcsContainerInfo {
  /** Container name */
  name: string;
  /** Container ARN */
  containerArn?: string;
  /** Last known status */
  lastStatus?: string;
  /** Health status */
  healthStatus?: string;
  /** Exit code */
  exitCode?: number;
  /** Exit reason */
  reason?: string;
  /** Network bindings */
  networkBindings: EcsNetworkBinding[];
  /** Container metadata */
  metadata?: Record<string, unknown>;
}

/**
 * ECS Network Binding
 */
export interface EcsNetworkBinding {
  /** Bind IP */
  bindIP?: string;
  /** Container port */
  containerPort?: number;
  /** Host port */
  hostPort?: number;
  /** Protocol */
  protocol?: string;
}

/**
 * ECS Attachment (for network interfaces)
 */
export interface EcsAttachment {
  /** Attachment ID */
  id?: string;
  /** Attachment type */
  type?: string;
  /** Attachment status */
  status?: string;
  /** Attachment details */
  details: EcsAttachmentDetail[];
}

/**
 * ECS Attachment Detail
 */
export interface EcsAttachmentDetail {
  /** Detail name */
  name?: string;
  /** Detail value */
  value?: string;
}

/**
 * WebSocket Connection Data
 */
export interface WebSocketConnectionData {
  /** Connection ID */
  connectionId: string;
  /** Session ID this connection belongs to */
  sessionId: string;
  /** Connection timestamp */
  connectedAt: Date;
  /** Last activity timestamp */
  lastActivity: Date;
  /** Connection metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Frame streaming message types
 */
export interface FrameStreamMessage {
  /** Message type */
  type: 'frame' | 'event' | 'status';
  /** Session ID */
  sessionId: string;
  /** Message timestamp */
  timestamp: string;
  /** Message data */
  data?: unknown;
}

/**
 * S3 Artifact metadata
 */
export interface S3ArtifactMetadata {
  /** Artifact ID */
  id: string;
  /** Session ID */
  sessionId: string;
  /** Original filename */
  fileName: string;
  /** File size in bytes */
  size: number;
  /** MIME type */
  mimeType?: string;
  /** Upload timestamp */
  uploadedAt: Date;
  /** S3 object key */
  s3Key: string;
  /** S3 bucket name */
  s3Bucket: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}
