/**
 * AWS-specific types for browser automation
 */

// Import shared types from utils
import type {
  BrowserSession,
  SessionOptions,
  Artifact,
  ArtifactUploadOptions,
  FrameStreamMessage,
  IBrowserProvider,
  ProviderConfig,
  TaskInfo
} from '@wallcrawler/utils/types';

// Re-export types from shared utilities for convenience
export type {
  BrowserSession,
  SessionOptions,
  Artifact,
  ArtifactUploadOptions,
  FrameStreamMessage,
  IBrowserProvider,
  ProviderConfig,
  TaskInfo
};

/**
 * AWS Provider Configuration
 * Extends base ProviderConfig with AWS-specific options
 */
export interface AwsProviderConfig extends ProviderConfig {
  /** AWS region */
  region: string;

  /** WallCrawler API key for authentication */
  apiKey: string;

  /** API Gateway endpoint URL (can be loaded from SSM) */
  apiEndpoint?: string;

  /** API Gateway API ID (alternative to apiEndpoint) */
  apiId?: string;

  /** WebSocket endpoint URL (can be loaded from SSM) */
  websocketEndpoint?: string;

  /** CDP endpoint URL for direct browser connections (can be loaded from SSM) */
  cdpEndpoint?: string;

  /** S3 configuration for artifacts */
  s3?: {
    /** S3 bucket name for artifacts */
    bucketName: string;
    /** S3 bucket region (defaults to provider region) */
    region?: string;
    /** Key prefix for artifacts */
    keyPrefix?: string;
  };

  /** SSM-based configuration loading */
  loadFromSsm?: boolean;
  /** Project name for SSM parameter path (defaults to 'wallcrawler') */
  projectName?: string;
  /** Environment for SSM parameter path (defaults to 'dev') */
  environment?: string;
}

/**
 * ECS Task Information - extends base TaskInfo
 */
export interface EcsTaskInfo extends TaskInfo {
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
  /** Container instances */
  containers: EcsContainerInfo[];
  /** Network attachments */
  attachments: EcsAttachment[];
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
 * S3 Artifact metadata - extends base Artifact
 */
export interface S3ArtifactMetadata extends Artifact {
  /** S3 object key */
  s3Key: string;
  /** S3 bucket name */
  s3Bucket: string;
  /** Upload timestamp */
  uploadedAt: Date;
}
