/**
 * Task monitoring utility for health checks and status monitoring
 * Provides common functionality for monitoring automation tasks
 */

import { HealthStatus } from '../types/automation';

/**
 * Configuration for task monitor
 */
export interface TaskMonitorConfig {
  /** Check interval in milliseconds */
  checkInterval?: number;
  /** Maximum check timeout in milliseconds */
  maxTimeout?: number;
  /** Maximum number of health check retries */
  maxRetries?: number;
  /** Enable monitoring logging */
  enableLogging?: boolean;
}

/**
 * Task health check result
 */
export interface TaskHealthCheck {
  /** Task identifier */
  taskId: string;
  /** Whether the task is healthy */
  healthy: boolean;
  /** Health status details */
  status?: HealthStatus;
  /** Last check timestamp */
  lastChecked: Date;
  /** Error message if unhealthy */
  error?: string;
}

/**
 * Task monitoring statistics
 */
export interface TaskMonitorStats {
  /** Total tasks being monitored */
  totalTasks: number;
  /** Number of healthy tasks */
  healthyTasks: number;
  /** Number of unhealthy tasks */
  unhealthyTasks: number;
  /** Number of failed health checks */
  failedChecks: number;
  /** Last check timestamp */
  lastCheck: Date;
}

/**
 * Utility class for monitoring task health and status
 */
export class TaskMonitor {
  private readonly config: Required<TaskMonitorConfig>;
  private readonly healthChecks = new Map<string, TaskHealthCheck>();
  private monitoringInterval?: NodeJS.Timeout;
  private stats: TaskMonitorStats;

  constructor(config: TaskMonitorConfig = {}) {
    this.config = {
      checkInterval: config.checkInterval ?? 30000, // 30 seconds
      maxTimeout: config.maxTimeout ?? 10000, // 10 seconds
      maxRetries: config.maxRetries ?? 3,
      enableLogging: config.enableLogging ?? true,
    };

    this.stats = {
      totalTasks: 0,
      healthyTasks: 0,
      unhealthyTasks: 0,
      failedChecks: 0,
      lastCheck: new Date(),
    };
  }

  /**
   * Add a task to monitoring
   */
  addTask(taskId: string): void {
    if (!this.healthChecks.has(taskId)) {
      this.healthChecks.set(taskId, {
        taskId,
        healthy: true,
        lastChecked: new Date(),
      });
      this.updateStats();

      if (this.config.enableLogging) {
        console.log(`[TaskMonitor] Added task ${taskId} to monitoring`);
      }
    }
  }

  /**
   * Remove a task from monitoring
   */
  removeTask(taskId: string): void {
    if (this.healthChecks.delete(taskId)) {
      this.updateStats();

      if (this.config.enableLogging) {
        console.log(`[TaskMonitor] Removed task ${taskId} from monitoring`);
      }
    }
  }

  /**
   * Check if a task is being monitored
   */
  isMonitoring(taskId: string): boolean {
    return this.healthChecks.has(taskId);
  }

  /**
   * Get health check result for a task
   */
  getHealthCheck(taskId: string): TaskHealthCheck | undefined {
    return this.healthChecks.get(taskId);
  }

  /**
   * Get all health checks
   */
  getAllHealthChecks(): TaskHealthCheck[] {
    return Array.from(this.healthChecks.values());
  }

  /**
   * Get monitoring statistics
   */
  getStats(): TaskMonitorStats {
    return { ...this.stats };
  }

  /**
   * Update health check for a task
   */
  updateHealthCheck(taskId: string, result: Partial<TaskHealthCheck>): void {
    const existing = this.healthChecks.get(taskId);
    if (existing) {
      this.healthChecks.set(taskId, {
        ...existing,
        ...result,
        lastChecked: new Date(),
      });
      this.updateStats();
    }
  }

  /**
   * Mark a task as healthy
   */
  markHealthy(taskId: string, status?: HealthStatus): void {
    this.updateHealthCheck(taskId, {
      healthy: true,
      status,
      error: undefined,
    });
  }

  /**
   * Mark a task as unhealthy
   */
  markUnhealthy(taskId: string, error: string, status?: HealthStatus): void {
    this.updateHealthCheck(taskId, {
      healthy: false,
      status,
      error,
    });

    if (this.config.enableLogging) {
      console.warn(`[TaskMonitor] Task ${taskId} marked unhealthy: ${error}`);
    }
  }

  /**
   * Check if a task is healthy
   */
  isTaskHealthy(taskId: string): boolean {
    const healthCheck = this.healthChecks.get(taskId);
    return healthCheck?.healthy ?? false;
  }

  /**
   * Get unhealthy tasks
   */
  getUnhealthyTasks(): TaskHealthCheck[] {
    return Array.from(this.healthChecks.values()).filter((check) => !check.healthy);
  }

  /**
   * Get healthy tasks
   */
  getHealthyTasks(): TaskHealthCheck[] {
    return Array.from(this.healthChecks.values()).filter((check) => check.healthy);
  }

  /**
   * Start automatic monitoring
   */
  startMonitoring(healthCheckCallback?: (taskId: string) => Promise<HealthStatus | undefined>): void {
    if (this.monitoringInterval) {
      return; // Already monitoring
    }

    if (this.config.enableLogging) {
      console.log(`[TaskMonitor] Starting automatic monitoring (interval: ${this.config.checkInterval}ms)`);
    }

    this.monitoringInterval = setInterval(async () => {
      if (healthCheckCallback) {
        await this.performHealthChecks(healthCheckCallback);
      }
      this.updateStats();
    }, this.config.checkInterval);
  }

  /**
   * Stop automatic monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;

      if (this.config.enableLogging) {
        console.log('[TaskMonitor] Stopped automatic monitoring');
      }
    }
  }

  /**
   * Perform health checks on all monitored tasks
   */
  private async performHealthChecks(
    healthCheckCallback: (taskId: string) => Promise<HealthStatus | undefined>
  ): Promise<void> {
    const tasks = Array.from(this.healthChecks.keys());

    for (const taskId of tasks) {
      try {
        const status = await this.performSingleHealthCheck(taskId, healthCheckCallback);
        if (status) {
          this.markHealthy(taskId, status);
        } else {
          this.markUnhealthy(taskId, 'Health check returned no status');
        }
      } catch (error) {
        this.markUnhealthy(taskId, `Health check failed: ${error}`);
        this.stats.failedChecks++;
      }
    }
  }

  /**
   * Perform health check on a single task with retries
   */
  private async performSingleHealthCheck(
    taskId: string,
    healthCheckCallback: (taskId: string) => Promise<HealthStatus | undefined>
  ): Promise<HealthStatus | undefined> {
    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        const result = await Promise.race([healthCheckCallback(taskId), this.createTimeout(this.config.maxTimeout)]);

        return result;
      } catch (error) {
        if (attempt === this.config.maxRetries) {
          throw error;
        }

        // Wait before retry
        await this.sleep(1000 * attempt);
      }
    }

    return undefined;
  }

  /**
   * Create a timeout promise
   */
  private createTimeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Health check timeout after ${ms}ms`)), ms);
    });
  }

  /**
   * Sleep utility
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Update monitoring statistics
   */
  private updateStats(): void {
    const checks = Array.from(this.healthChecks.values());
    this.stats = {
      totalTasks: checks.length,
      healthyTasks: checks.filter((check) => check.healthy).length,
      unhealthyTasks: checks.filter((check) => !check.healthy).length,
      failedChecks: this.stats.failedChecks, // Preserve failed checks count
      lastCheck: new Date(),
    };
  }

  /**
   * Clear all monitoring data
   */
  clear(): void {
    this.stopMonitoring();
    this.healthChecks.clear();
    this.stats = {
      totalTasks: 0,
      healthyTasks: 0,
      unhealthyTasks: 0,
      failedChecks: 0,
      lastCheck: new Date(),
    };
  }
}
