/**
 * Process Task Manager - Local development equivalent of EcsTaskManager
 * Handles local Node.js process lifecycle management for browser automation
 */

import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { promisify } from 'util';
import { exec } from 'child_process';
import net from 'net';

import { AutomationTaskConfig, TaskInfo } from '@wallcrawler/infra-common';

const _execAsync = promisify(exec);

/**
 * Configuration for Process Task Manager
 */
export interface ProcessTaskManagerConfig {
  /** Working directory for processes */
  workingDirectory: string;
  /** Default command to run */
  defaultCommand: string;
  /** Default arguments for the command */
  defaultArgs: string[];
  /** Default port for processes */
  defaultPort: number;
  /** Environment name */
  environment: string;
  /** Maximum number of concurrent processes */
  maxProcesses: number;
  /** Process timeout in milliseconds */
  processTimeout: number;
  /** Port range for process allocation */
  portRange?: {
    start: number;
    end: number;
  };
}

/**
 * Metadata for a running process
 */
interface ProcessMetadata {
  sessionId: string;
  userId: string;
  environment: string;
  command: string;
  args: string[];
  workingDirectory: string;
  port: number;
  [key: string]: unknown; // Allow additional metadata
}

/**
 * Information about a running process
 */
interface ProcessInfo {
  processId: string;
  sessionId: string;
  pid: number;
  port: number;
  process: ChildProcess;
  status: string;
  createdAt: Date;
  startedAt?: Date;
  metadata: ProcessMetadata;
}

/**
 * Process Task Manager for handling local Node.js processes
 */
export class ProcessTaskManager {
  private readonly config: Required<ProcessTaskManagerConfig>;
  private readonly activeProcesses = new Map<string, ProcessInfo>();
  private readonly sessionProcessMapping = new Map<string, string>(); // sessionId -> processId

  constructor(config: ProcessTaskManagerConfig) {
    this.config = {
      ...config,
      portRange: config.portRange ?? { start: 3001, end: 4000 },
    };
  }

  /**
   * Start a new local process for automation
   */
  async startProcess(taskConfig: AutomationTaskConfig): Promise<TaskInfo> {
    try {
      console.log(`[ProcessTaskManager] Starting automation process for session: ${taskConfig.sessionId}`);

      // Check process limit
      if (this.activeProcesses.size >= this.config.maxProcesses) {
        throw new Error(`Maximum number of processes (${this.config.maxProcesses}) reached`);
      }

      // Generate unique process ID
      const processId = randomUUID();

      // Find available port
      const port = await this.findAvailablePort();

      // Prepare environment variables
      const env = {
        ...process.env,
        SESSION_ID: taskConfig.sessionId,
        USER_ID: taskConfig.userId,
        CONTAINER_USER_ID: taskConfig.userId, // Required by container app
        ENVIRONMENT: taskConfig.environment,
        REGION: taskConfig.region,
        PORT: port.toString(),
        ...taskConfig.environmentVariables,
      };

      // Spawn the process
      const childProcess = spawn(this.config.defaultCommand, this.config.defaultArgs, {
        cwd: this.config.workingDirectory,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false,
      });

      const processInfo: ProcessInfo = {
        processId,
        sessionId: taskConfig.sessionId,
        pid: childProcess.pid!,
        port,
        process: childProcess,
        status: 'STARTING',
        createdAt: new Date(),
        metadata: {
          sessionId: taskConfig.sessionId,
          userId: taskConfig.userId,
          environment: taskConfig.environment,
          command: this.config.defaultCommand,
          args: this.config.defaultArgs,
          workingDirectory: this.config.workingDirectory,
          port,
        },
      };

      // Store process info
      this.activeProcesses.set(processId, processInfo);
      this.sessionProcessMapping.set(taskConfig.sessionId, processId);

      // Set up process event handlers
      this.setupProcessHandlers(processInfo);

      // Wait for process to be ready
      await this.waitForProcessReady(processInfo);

      const taskInfo: TaskInfo = {
        taskId: processId,
        taskArn: `local:process:${processId}`,
        userId: taskConfig.userId,
        status: 'STARTING',
        createdAt: processInfo.createdAt,
        startedAt: processInfo.startedAt,
        lastStatus: processInfo.status,
        metadata: processInfo.metadata,
      };

      console.log(
        `[ProcessTaskManager] Started process ${processId} for session ${taskConfig.sessionId} on port ${port}`
      );

      return taskInfo;
    } catch (error) {
      console.error('[ProcessTaskManager] Error starting automation process:', error);
      throw new Error(`Failed to start automation: ${error}`);
    }
  }

  /**
   * Stop a local process
   */
  async stopProcess(processArn: string, _reason?: string): Promise<void> {
    try {
      const processId = this.extractProcessId(processArn);
      const processInfo = this.activeProcesses.get(processId);

      if (!processInfo) {
        console.warn(`[ProcessTaskManager] Process ${processId} not found`);
        return;
      }

      console.log(`[ProcessTaskManager] Stopping automation process: ${processId}`);

      processInfo.status = 'STOPPING';

      // Try graceful shutdown first
      processInfo.process.kill('SIGTERM');

      // Give it time to shut down gracefully
      await this.sleep(2000);

      // Force kill if still running
      if (!processInfo.process.killed) {
        processInfo.process.kill('SIGKILL');
      }

      // Clean up
      this.activeProcesses.delete(processId);
      this.sessionProcessMapping.delete(processInfo.sessionId);

      console.log(`[ProcessTaskManager] Automation process stopped: ${processId}`);
    } catch (error) {
      console.error('[ProcessTaskManager] Error stopping automation process:', error);
      throw new Error(`Failed to stop automation: ${error}`);
    }
  }

  /**
   * Get information about a specific process
   */
  async getProcessInfo(processArn: string): Promise<TaskInfo | null> {
    try {
      const processId = this.extractProcessId(processArn);
      const processInfo = this.activeProcesses.get(processId);

      if (!processInfo) {
        return null;
      }

      return {
        taskId: processInfo.processId,
        taskArn: processArn,
        userId: processInfo.metadata.userId,
        status: processInfo.status,
        createdAt: processInfo.createdAt,
        startedAt: processInfo.startedAt,
        lastStatus: processInfo.status,
        metadata: {
          ...processInfo.metadata,
          pid: processInfo.pid,
        },
      };
    } catch (error) {
      console.error('[ProcessTaskManager] Error getting process info:', error);
      return null;
    }
  }

  /**
   * Find a process by session ID
   */
  async findProcessBySessionId(sessionId: string): Promise<TaskInfo | null> {
    try {
      const processId = this.sessionProcessMapping.get(sessionId);
      if (!processId) return null;

      return this.getProcessInfo(`local:process:${processId}`);
    } catch (error) {
      console.error('[ProcessTaskManager] Error finding process by session ID:', error);
      return null;
    }
  }

  /**
   * List all active processes
   */
  async listActiveProcesses(): Promise<TaskInfo[]> {
    try {
      const processInfos: TaskInfo[] = [];

      for (const processInfo of this.activeProcesses.values()) {
        if (processInfo.status === 'RUNNING' || processInfo.status === 'STARTING') {
          processInfos.push({
            taskId: processInfo.processId,
            taskArn: `local:process:${processInfo.processId}`,
            userId: processInfo.metadata.userId,
            status: processInfo.status,
            createdAt: processInfo.createdAt,
            startedAt: processInfo.startedAt,
            lastStatus: processInfo.status,
            metadata: {
              ...processInfo.metadata,
              pid: processInfo.pid,
            },
          });
        }
      }

      return processInfos;
    } catch (error) {
      console.error('[ProcessTaskManager] Error listing active processes:', error);
      return [];
    }
  }

  /**
   * Wait for process to reach a specific status
   */
  async waitForProcessStatus(
    processArn: string,
    targetStatus: string,
    maxWaitTime: number = 30000
  ): Promise<TaskInfo | null> {
    const startTime = Date.now();
    const processId = this.extractProcessId(processArn);

    while (Date.now() - startTime < maxWaitTime) {
      const processInfo = this.activeProcesses.get(processId);

      if (!processInfo) {
        throw new Error(`Process ${processId} not found`);
      }

      if (processInfo.status === targetStatus) {
        return this.getProcessInfo(processArn);
      }

      if (processInfo.status === 'STOPPED') {
        throw new Error(`Process ${processId} stopped unexpectedly`);
      }

      await this.sleep(1000); // Wait 1 second before retry
    }

    throw new Error(`Process ${processId} did not reach status ${targetStatus} within ${maxWaitTime}ms`);
  }

  /**
   * Check if a port is available
   */
  private async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();

      server.listen(port, () => {
        server.once('close', () => {
          resolve(true);
        });
        server.close();
      });

      server.on('error', () => {
        resolve(false);
      });
    });
  }

  /**
   * Find an available port in the configured range
   */
  private async findAvailablePort(): Promise<number> {
    const { start, end } = this.config.portRange;

    // Try ports in range
    for (let port = start; port <= end; port++) {
      if (await this.isPortAvailable(port)) {
        return port;
      }
    }

    // If no port in range is available, find any available port
    const server = net.createServer();
    return new Promise((resolve, reject) => {
      server.listen(0, () => {
        const port = (server.address() as net.AddressInfo).port;
        server.close(() => resolve(port));
      });
      server.on('error', reject);
    });
  }

  /**
   * Set up process event handlers
   */
  private setupProcessHandlers(processInfo: ProcessInfo): void {
    const { process, processId } = processInfo;

    process.on('spawn', () => {
      console.log(`[ProcessTaskManager] Process ${processId} spawned with PID ${process.pid}`);
      processInfo.startedAt = new Date();
      processInfo.status = 'RUNNING';
    });

    process.on('exit', (code, signal) => {
      console.log(`[ProcessTaskManager] Process ${processId} exited with code ${code}, signal ${signal}`);
      processInfo.status = 'STOPPED';
      this.activeProcesses.delete(processId);
      this.sessionProcessMapping.delete(processInfo.sessionId);
    });

    process.on('error', (error) => {
      console.error(`[ProcessTaskManager] Process ${processId} error:`, error);
      processInfo.status = 'FAILED';
    });

    // Log output
    process.stdout?.on('data', (data) => {
      console.log(`[Process ${processId}] ${data.toString().trim()}`);
    });

    process.stderr?.on('data', (data) => {
      console.error(`[Process ${processId}] ${data.toString().trim()}`);
    });
  }

  /**
   * Wait for process to be ready (port is listening)
   */
  private async waitForProcessReady(processInfo: ProcessInfo, maxWaitTime: number = 30000): Promise<void> {
    const startTime = Date.now();
    const { port, processId } = processInfo;

    while (Date.now() - startTime < maxWaitTime) {
      if (processInfo.status === 'STOPPED' || processInfo.status === 'FAILED') {
        throw new Error(`Process ${processId} failed to start`);
      }

      // Check if port is listening
      try {
        const isListening = await this.checkPortListening(port);
        if (isListening) {
          processInfo.status = 'RUNNING';
          return;
        }
      } catch (error) {
        // Port not ready yet, continue waiting
        console.log('Couldnt check port listening. ', error);
      }

      await this.sleep(1000);
    }

    throw new Error(`Process ${processId} did not become ready within ${maxWaitTime}ms`);
  }

  /**
   * Check if a port is listening
   */
  private async checkPortListening(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();

      socket.setTimeout(1000);

      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });

      socket.on('error', () => {
        resolve(false);
      });

      socket.connect(port, 'localhost');
    });
  }

  /**
   * Extract process ID from process ARN
   */
  private extractProcessId(processArn: string): string {
    // Extract process ID from ARN: local:process:process-id
    const parts = processArn.split(':');
    return parts[parts.length - 1];
  }

  /**
   * Sleep utility
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get process manager configuration
   */
  getConfig(): ProcessTaskManagerConfig {
    return { ...this.config };
  }

  /**
   * Get process manager stats
   */
  getStats(): {
    activeProcesses: number;
    maxProcesses: number;
    availablePorts: number;
  } {
    const usedPorts = Array.from(this.activeProcesses.values()).map((p) => p.port);
    const { start, end } = this.config.portRange;
    const totalPorts = end - start + 1;
    const availablePorts = totalPorts - usedPorts.length;

    return {
      activeProcesses: this.activeProcesses.size,
      maxProcesses: this.config.maxProcesses,
      availablePorts,
    };
  }

  /**
   * Cleanup all processes
   */
  async cleanup(): Promise<void> {
    console.log('[ProcessTaskManager] Cleaning up all processes...');

    const stopPromises: Promise<void>[] = [];

    for (const processInfo of this.activeProcesses.values()) {
      stopPromises.push(
        this.stopProcess(`local:process:${processInfo.processId}`, 'Manager cleanup').catch((error) => {
          console.error(`[ProcessTaskManager] Error stopping process ${processInfo.processId}:`, error);
        })
      );
    }

    await Promise.allSettled(stopPromises);

    console.log('[ProcessTaskManager] Cleanup completed');
  }
}
