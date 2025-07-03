import { chromium } from 'playwright';
import { ECSClient, RunTaskCommand, StopTaskCommand, DescribeTasksCommand } from '@aws-sdk/client-ecs';
import { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import {
  IBrowserProvider,
  ProviderType,
  ProviderSession,
  SessionCreateParams,
  BrowserConnectionResult,
  Artifact,
  ArtifactList,
  LogLine,
} from '@wallcrawler/stagehand';

export interface AwsProviderConfig {
  /** AWS region */
  region?: string;
  /** AWS access key ID */
  accessKeyId?: string;
  /** AWS secret access key */
  secretAccessKey?: string;
  /** S3 bucket for artifacts */
  artifactsBucket?: string;
  /** ECS cluster name for browser instances */
  ecsCluster?: string;
  /** ECR repository for browser image */
  browserImageUri?: string;
  /** VPC configuration */
  vpcConfig?: {
    subnets: string[];
    securityGroups: string[];
  };
  /** Logging function */
  logger?: (logLine: LogLine) => void;
}

/**
 * AWS browser provider for running browsers in ECS/Fargate
 * Handles ECS task management and S3 artifact storage
 */
export class AwsProvider implements IBrowserProvider {
  public readonly type: ProviderType = 'aws';
  public readonly name: string = 'AWS Browser Provider';

  private readonly config: AwsProviderConfig;
  private readonly ecsClient: ECSClient;
  private readonly s3Client: S3Client;
  private readonly sessions: Map<string, ProviderSession> = new Map();

  constructor(config: AwsProviderConfig) {
    this.config = config;

    const awsConfig = {
      region: config.region || process.env.AWS_REGION || 'us-east-1',
      ...(config.accessKeyId &&
        config.secretAccessKey && {
          credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          },
        }),
    };

    this.ecsClient = new ECSClient(awsConfig);
    this.s3Client = new S3Client(awsConfig);

    if (!config.artifactsBucket) {
      throw new Error('artifactsBucket is required for AWS provider');
    }
    if (!config.ecsCluster) {
      throw new Error('ecsCluster is required for AWS provider');
    }
    if (!config.browserImageUri) {
      throw new Error('browserImageUri is required for AWS provider');
    }
  }

  private log(logLine: Omit<LogLine, 'category'>): void {
    if (this.config.logger) {
      this.config.logger({
        category: 'aws-provider',
        ...logLine,
      });
    }
  }

  /**
   * Create a new browser session by launching an ECS task
   */
  async createSession(params?: SessionCreateParams): Promise<ProviderSession> {
    const sessionId = this.generateSessionId();

    this.log({
      message: 'creating new AWS browser session',
      level: 1,
      auxiliary: {
        sessionId: { value: sessionId, type: 'string' },
        cluster: { value: this.config.ecsCluster!, type: 'string' },
      },
    });

    // Launch ECS task with browser container
    const runTaskCommand = new RunTaskCommand({
      cluster: this.config.ecsCluster,
      taskDefinition: await this.getOrCreateTaskDefinition(),
      launchType: 'FARGATE',
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: this.config.vpcConfig?.subnets || [],
          securityGroups: this.config.vpcConfig?.securityGroups || [],
          assignPublicIp: 'ENABLED',
        },
      },
      overrides: {
        containerOverrides: [
          {
            name: 'browser',
            environment: [{ name: 'SESSION_ID', value: sessionId }],
          },
        ],
      },
    });

    const taskResult = await this.ecsClient.send(runTaskCommand);
    const taskArn = taskResult.tasks?.[0]?.taskArn;

    if (!taskArn) {
      throw new Error('Failed to launch ECS task');
    }

    // Wait for task to be running and get public IP
    const publicIp = await this.waitForTaskRunning(taskArn);
    const connectUrl = `ws://${publicIp}:9222`;

    const session: ProviderSession = {
      sessionId,
      provider: this.type,
      connectUrl,
      metadata: {
        ...params?.userMetadata,
        createdAt: new Date().toISOString(),
        taskArn,
        cluster: this.config.ecsCluster,
        publicIp,
      },
    };

    this.sessions.set(sessionId, session);

    this.log({
      message: 'AWS browser session created',
      level: 1,
      auxiliary: {
        sessionId: { value: sessionId, type: 'string' },
        taskArn: { value: taskArn, type: 'string' },
        connectUrl: { value: connectUrl, type: 'string' },
      },
    });

    return session;
  }

  /**
   * Resume an existing session
   */
  async resumeSession(sessionId: string): Promise<ProviderSession> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Verify ECS task is still running
    const taskArn = session.metadata?.taskArn as string;
    if (taskArn) {
      const describeTasksCommand = new DescribeTasksCommand({
        cluster: this.config.ecsCluster,
        tasks: [taskArn],
      });

      const result = await this.ecsClient.send(describeTasksCommand);
      const task = result.tasks?.[0];

      if (!task || task.lastStatus !== 'RUNNING') {
        throw new Error(`Session ${sessionId} task is not running`);
      }
    }

    this.log({
      message: 'resuming AWS browser session',
      level: 1,
      auxiliary: {
        sessionId: { value: sessionId, type: 'string' },
      },
    });

    return session;
  }

  /**
   * Connect to the browser instance running in ECS
   */
  async connectToBrowser(session: ProviderSession): Promise<BrowserConnectionResult> {
    if (!session.connectUrl) {
      throw new Error('No connect URL available for session');
    }

    this.log({
      message: 'connecting to AWS browser instance',
      level: 1,
      auxiliary: {
        sessionId: { value: session.sessionId, type: 'string' },
        connectUrl: { value: session.connectUrl, type: 'string' },
      },
    });

    // Connect to remote browser via CDP
    const browser = await chromium.connectOverCDP(session.connectUrl);

    this.log({
      message: 'connected to AWS browser instance',
      level: 1,
      auxiliary: {
        sessionId: { value: session.sessionId, type: 'string' },
      },
    });

    return {
      browser,
      session,
    };
  }

  /**
   * End a browser session by stopping the ECS task
   */
  async endSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    this.log({
      message: 'ending AWS browser session',
      level: 1,
      auxiliary: {
        sessionId: { value: sessionId, type: 'string' },
      },
    });

    // Stop ECS task
    const taskArn = session.metadata?.taskArn as string;
    if (taskArn) {
      const stopTaskCommand = new StopTaskCommand({
        cluster: this.config.ecsCluster,
        task: taskArn,
      });

      await this.ecsClient.send(stopTaskCommand);
    }

    this.sessions.delete(sessionId);

    this.log({
      message: 'AWS browser session ended',
      level: 1,
      auxiliary: {
        sessionId: { value: sessionId, type: 'string' },
      },
    });
  }

  /**
   * Save an artifact to S3
   */
  async saveArtifact(sessionId: string, filePath: string, data: Buffer): Promise<Artifact> {
    const artifactId = this.generateArtifactId();
    const key = `${sessionId}/${artifactId}/${filePath}`;

    this.log({
      message: 'saving artifact to S3',
      level: 1,
      auxiliary: {
        sessionId: { value: sessionId, type: 'string' },
        artifactId: { value: artifactId, type: 'string' },
        bucket: { value: this.config.artifactsBucket!, type: 'string' },
        key: { value: key, type: 'string' },
      },
    });

    const putObjectCommand = new PutObjectCommand({
      Bucket: this.config.artifactsBucket,
      Key: key,
      Body: data,
      Metadata: {
        sessionId,
        artifactId,
        originalPath: filePath,
        uploadedAt: new Date().toISOString(),
      },
    });

    await this.s3Client.send(putObjectCommand);

    const artifact: Artifact = {
      id: artifactId,
      name: filePath,
      size: data.length,
      createdAt: new Date(),
      path: key,
      metadata: {
        sessionId,
        bucket: this.config.artifactsBucket,
        originalPath: filePath,
      },
    };

    this.log({
      message: 'artifact saved to S3',
      level: 1,
      auxiliary: {
        sessionId: { value: sessionId, type: 'string' },
        artifactId: { value: artifactId, type: 'string' },
      },
    });

    return artifact;
  }

  /**
   * List artifacts for a session from S3
   */
  async getArtifacts(sessionId: string, cursor?: string): Promise<ArtifactList> {
    this.log({
      message: 'listing artifacts from S3',
      level: 1,
      auxiliary: {
        sessionId: { value: sessionId, type: 'string' },
        bucket: { value: this.config.artifactsBucket!, type: 'string' },
      },
    });

    const listCommand = new ListObjectsV2Command({
      Bucket: this.config.artifactsBucket,
      Prefix: `${sessionId}/`,
      ContinuationToken: cursor,
    });

    const result = await this.s3Client.send(listCommand);
    const artifacts: Artifact[] = [];

    if (result.Contents) {
      for (const object of result.Contents) {
        if (object.Key && object.Size && object.LastModified) {
          const keyParts = object.Key.split('/');
          const artifactId = keyParts[1];
          const fileName = keyParts.slice(2).join('/');

          artifacts.push({
            id: artifactId,
            name: fileName,
            size: object.Size,
            createdAt: object.LastModified,
            path: object.Key,
            metadata: {
              sessionId,
              bucket: this.config.artifactsBucket,
            },
          });
        }
      }
    }

    return {
      artifacts,
      totalCount: artifacts.length,
      hasMore: !!result.IsTruncated,
      nextCursor: result.NextContinuationToken,
    };
  }

  /**
   * Download a specific artifact from S3
   */
  async downloadArtifact(sessionId: string, artifactId: string): Promise<Buffer> {
    this.log({
      message: 'downloading artifact from S3',
      level: 1,
      auxiliary: {
        sessionId: { value: sessionId, type: 'string' },
        artifactId: { value: artifactId, type: 'string' },
      },
    });

    // List objects to find the artifact
    const artifacts = await this.getArtifacts(sessionId);
    const artifact = artifacts.artifacts.find((a) => a.id === artifactId);

    if (!artifact) {
      throw new Error(`Artifact ${artifactId} not found for session ${sessionId}`);
    }

    const getObjectCommand = new GetObjectCommand({
      Bucket: this.config.artifactsBucket,
      Key: artifact.path,
    });

    const result = await this.s3Client.send(getObjectCommand);

    if (!result.Body) {
      throw new Error(`No content found for artifact ${artifactId}`);
    }

    // Convert stream to buffer using streamCollector
    // This handles both web streams and Node.js streams properly
    const chunks: Uint8Array[] = [];
    
    if (result.Body instanceof ReadableStream) {
      const reader = result.Body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
    } else {
      // Assume it's a Node.js Readable stream and convert to async iterator
      const stream = result.Body as NodeJS.ReadableStream;
      return new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks)));
      });
    }
  }

  /**
   * Clean up AWS provider resources
   */
  async cleanup(): Promise<void> {
    this.log({
      message: 'cleaning up AWS provider resources',
      level: 1,
    });

    // Stop all running tasks
    const stopPromises = Array.from(this.sessions.values()).map(async (session) => {
      const taskArn = session.metadata?.taskArn as string;
      if (taskArn) {
        try {
          const stopTaskCommand = new StopTaskCommand({
            cluster: this.config.ecsCluster,
            task: taskArn,
          });
          await this.ecsClient.send(stopTaskCommand);
        } catch (error) {
          this.log({
            message: `Error stopping task ${taskArn}`,
            level: 0,
            auxiliary: {
              error: { value: (error as Error).message, type: 'string' },
            },
          });
        }
      }
    });

    await Promise.all(stopPromises);
    this.sessions.clear();
  }

  /**
   * Wait for ECS task to be running and return public IP
   */
  private async waitForTaskRunning(taskArn: string, maxWaitTime = 300000): Promise<string> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const describeTasksCommand = new DescribeTasksCommand({
        cluster: this.config.ecsCluster,
        tasks: [taskArn],
      });

      const result = await this.ecsClient.send(describeTasksCommand);
      const task = result.tasks?.[0];

      if (task?.lastStatus === 'RUNNING') {
        // Extract public IP from task
        const attachment = task.attachments?.find((a) => a.type === 'NetworkInterface');
        const detail = attachment?.details?.find((d) => d.name === 'networkInterfaceId');

        if (detail?.value) {
          // In a real implementation, you'd use EC2 to get the public IP
          // For now, we'll simulate it
          return 'placeholder-public-ip';
        }
      }

      if (task?.lastStatus === 'STOPPED') {
        throw new Error(`Task ${taskArn} stopped unexpectedly`);
      }

      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    throw new Error(`Task ${taskArn} did not start within ${maxWaitTime}ms`);
  }

  /**
   * Get or create ECS task definition for browser
   */
  private async getOrCreateTaskDefinition(): Promise<string> {
    // In a real implementation, this would check if the task definition exists
    // and create it if it doesn't
    return 'browser-task-definition';
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    return `aws_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Generate a unique artifact ID
   */
  private generateArtifactId(): string {
    return `${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }
}
