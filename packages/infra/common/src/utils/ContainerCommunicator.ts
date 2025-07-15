/**
 * Container communication utility for HTTP requests to running containers
 * Extracted and generalized from career-agent implementation
 */

import { ContainerResponse, ContainerMethod, ContainerEndpointConfig } from '../types/automation';

/**
 * Configuration for container communicator
 */
export interface ContainerCommunicatorConfig {
  /** Default container port */
  defaultPort?: number;
  /** Health check endpoint path */
  healthCheckPath?: string;
  /** VNC port for debugging */
  vncPort?: number;
  /** Default timeout for requests in milliseconds */
  defaultTimeout?: number;
  /** Default number of retries */
  defaultRetries?: number;
  /** Enable request logging */
  enableLogging?: boolean;
}

/**
 * Utility class for communicating with running containers via HTTP
 */
export class ContainerCommunicator {
  private readonly config: Required<ContainerCommunicatorConfig>;

  constructor(config: ContainerCommunicatorConfig = {}) {
    this.config = {
      defaultPort: config.defaultPort ?? 3000,
      healthCheckPath: config.healthCheckPath ?? '/health',
      vncPort: config.vncPort ?? 6080,
      defaultTimeout: config.defaultTimeout ?? 30000,
      defaultRetries: config.defaultRetries ?? 3,
      enableLogging: config.enableLogging ?? true,
    };
  }

  /**
   * Call an HTTP endpoint on a running container
   */
  async callEndpoint<T = unknown>(
    endpoint: string,
    path: string,
    method: ContainerMethod = 'GET',
    body?: Record<string, unknown>,
    retries: number = this.config.defaultRetries
  ): Promise<ContainerResponse<T>> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.defaultTimeout);

      try {
        const url = `${endpoint}${path}`;
        const options: RequestInit = {
          method,
          headers: {
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
        };

        if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
          options.body = JSON.stringify(body);
        }

        if (this.config.enableLogging) {
          console.log(`[ContainerCommunicator] Calling endpoint: ${method} ${url} (attempt ${attempt})`);
        }

        const response = await fetch(url, options);
        clearTimeout(timeoutId); // Clear timeout on success

        const responseText = await response.text();

        let data: T | string;
        try {
          data = JSON.parse(responseText) as T;
        } catch {
          data = responseText;
        }

        return {
          success: response.ok,
          data,
          statusCode: response.status,
          error: response.ok ? undefined : `HTTP ${response.status}: ${response.statusText}`,
        };
      } catch (error) {
        clearTimeout(timeoutId); // Clear timeout on error

        if (this.config.enableLogging) {
          console.error(`[ContainerCommunicator] Attempt ${attempt} failed:`, error);
        }

        if (attempt === retries) {
          return {
            success: false,
            error: `Failed after ${retries} attempts: ${error}`,
            statusCode: 0,
          };
        }

        // Exponential backoff
        await this.sleep(Math.pow(2, attempt) * 1000);
      }
    }

    return {
      success: false,
      error: 'Unexpected error in container call',
      statusCode: 0,
    };
  }

  /**
   * Check container health
   */
  async checkHealth(endpoint: string): Promise<ContainerResponse<{ status: string; uptime?: number }>> {
    return this.callEndpoint(endpoint, this.config.healthCheckPath, 'GET');
  }

  /**
   * Get VNC information from container
   */
  async getVncInfo(endpoint: string): Promise<ContainerResponse<{ vncUrl?: string; status: string }>> {
    return this.callEndpoint(endpoint, '/vnc', 'GET');
  }

  /**
   * Start automation on container
   */
  async startAutomation(
    endpoint: string,
    sessionId: string,
    params: Record<string, unknown>
  ): Promise<ContainerResponse<{ message: string; sessionId?: string }>> {
    return this.callEndpoint(endpoint, '/start', 'POST', {
      sessionId,
      ...params,
    });
  }

  /**
   * Stop automation on container
   */
  async stopAutomation(endpoint: string): Promise<ContainerResponse<{ message: string }>> {
    return this.callEndpoint(endpoint, '/stop', 'POST');
  }

  /**
   * Construct endpoint URL from IP and port
   */
  constructEndpoint(ip: string, port: number = this.config.defaultPort, protocol: string = 'http'): string {
    return `${protocol}://${ip}:${port}`;
  }

  /**
   * Construct VNC URL from IP
   */
  constructVncUrl(ip: string, protocol: string = 'ws'): string {
    return `${protocol}://${ip}:${this.config.vncPort}/websockify`;
  }

  /**
   * Sleep utility for retries
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get configuration
   */
  getConfig(): ContainerEndpointConfig {
    return {
      defaultPort: this.config.defaultPort,
      healthCheckPath: this.config.healthCheckPath,
      vncPort: this.config.vncPort,
      defaultTimeout: this.config.defaultTimeout,
    };
  }
}
