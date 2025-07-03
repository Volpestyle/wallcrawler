/**
 * Network Extractor - Extracted from career-agent
 * Handles IP extraction and URL construction for ECS tasks
 */

import { Task } from '@aws-sdk/client-ecs';
import { TaskInfo } from '@wallcrawler/infra-common';

/**
 * Configuration for network extractor
 */
export interface NetworkExtractorConfig {
  /** Load balancer DNS name for production */
  loadBalancerDns?: string;
  /** Default container port */
  defaultPort?: number;
  /** VNC port for debugging */
  vncPort?: number;
  /** Protocol for HTTP connections */
  httpProtocol?: string;
  /** Protocol for WebSocket connections */
  wsProtocol?: string;
}

/**
 * Network information extracted from ECS task
 */
export interface NetworkInfo {
  /** Private IPv4 address */
  privateIp?: string;
  /** Public IPv4 address */
  publicIp?: string;
  /** HTTP connection URL */
  connectUrl?: string;
  /** VNC WebSocket URL */
  vncUrl?: string;
  /** Network interface ID */
  networkInterfaceId?: string;
}

/**
 * Utility for extracting network information from ECS tasks
 */
export class NetworkExtractor {
  private readonly config: Required<NetworkExtractorConfig>;

  constructor(config: NetworkExtractorConfig = {}) {
    this.config = {
      loadBalancerDns: config.loadBalancerDns ?? '',
      defaultPort: config.defaultPort ?? 3000,
      vncPort: config.vncPort ?? 6080,
      httpProtocol: config.httpProtocol ?? 'http',
      wsProtocol: config.wsProtocol ?? 'ws',
    };
  }

  /**
   * Extract network information from ECS task
   */
  extractNetworkInfo(task: Task): NetworkInfo {
    const privateIp = this.extractPrivateIp(task);
    const publicIp = this.extractPublicIp(task);
    const networkInterfaceId = this.extractNetworkInterfaceId(task);

    let connectUrl: string | undefined;
    let vncUrl: string | undefined;

    // Only construct URLs if task is running
    if (task.lastStatus === 'RUNNING') {
      connectUrl = this.constructConnectUrl(privateIp, publicIp);
      vncUrl = this.constructVncUrl(privateIp, publicIp);
    }

    return {
      privateIp,
      publicIp,
      connectUrl,
      vncUrl,
      networkInterfaceId,
    };
  }

  /**
   * Update task info with network information
   */
  updateTaskInfoWithNetworking(taskInfo: TaskInfo, task: Task): TaskInfo {
    const networkInfo = this.extractNetworkInfo(task);

    return {
      ...taskInfo,
      privateIp: networkInfo.privateIp,
      publicIp: networkInfo.publicIp,
      connectUrl: networkInfo.connectUrl,
      vncUrl: networkInfo.vncUrl,
      metadata: {
        ...taskInfo.metadata,
        networkInterfaceId: networkInfo.networkInterfaceId,
      },
    };
  }

  /**
   * Construct HTTP connection URL
   */
  constructConnectUrl(privateIp?: string, publicIp?: string): string | undefined {
    // Try ALB endpoint first (production)
    if (this.config.loadBalancerDns) {
      return `${this.config.httpProtocol}://${this.config.loadBalancerDns}`;
    }

    // Fall back to direct IP (development)
    if (privateIp) {
      return `${this.config.httpProtocol}://${privateIp}:${this.config.defaultPort}`;
    }

    if (publicIp) {
      return `${this.config.httpProtocol}://${publicIp}:${this.config.defaultPort}`;
    }

    return undefined;
  }

  /**
   * Construct VNC WebSocket URL
   */
  constructVncUrl(privateIp?: string, publicIp?: string): string | undefined {
    // Try ALB endpoint first (production)
    if (this.config.loadBalancerDns) {
      return `${this.config.wsProtocol}://${this.config.loadBalancerDns}:8080/vnc`;
    }

    // Fall back to direct IP (development)
    if (privateIp) {
      return `${this.config.wsProtocol}://${privateIp}:${this.config.vncPort}/websockify`;
    }

    if (publicIp) {
      return `${this.config.wsProtocol}://${publicIp}:${this.config.vncPort}/websockify`;
    }

    return undefined;
  }

  /**
   * Extract private IP from ECS task networking details
   */
  extractPrivateIp(task: Task): string | undefined {
    if (task.attachments) {
      for (const attachment of task.attachments) {
        if (
          attachment.type === 'ElasticNetworkInterface' &&
          attachment.details
        ) {
          for (const detail of attachment.details) {
            if (detail.name === 'privateIPv4Address' && detail.value) {
              return detail.value;
            }
          }
        }
      }
    }
    return undefined;
  }

  /**
   * Extract public IP from ECS task networking details
   */
  extractPublicIp(task: Task): string | undefined {
    if (task.attachments) {
      for (const attachment of task.attachments) {
        if (
          attachment.type === 'ElasticNetworkInterface' &&
          attachment.details
        ) {
          for (const detail of attachment.details) {
            if (detail.name === 'publicIPv4Address' && detail.value) {
              return detail.value;
            }
          }
        }
      }
    }
    return undefined;
  }

  /**
   * Extract network interface ID from ECS task
   */
  extractNetworkInterfaceId(task: Task): string | undefined {
    if (task.attachments) {
      for (const attachment of task.attachments) {
        if (
          attachment.type === 'ElasticNetworkInterface' &&
          attachment.details
        ) {
          for (const detail of attachment.details) {
            if (detail.name === 'networkInterfaceId' && detail.value) {
              return detail.value;
            }
          }
        }
      }
    }
    return undefined;
  }

  /**
   * Check if load balancer is configured
   */
  hasLoadBalancer(): boolean {
    return !!this.config.loadBalancerDns;
  }

  /**
   * Get configuration
   */
  getConfig(): NetworkExtractorConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<NetworkExtractorConfig>): void {
    Object.assign(this.config, updates);
  }
}