import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
} from '@aws-sdk/client-dynamodb';
import { chromium } from 'playwright';
import {
  InfrastructureProvider,
  BrowserConfig,
  BrowserState,
  StateReference,
  Checkpoint,
  CheckpointReference,
  Artifact,
  ArtifactReference,
  InterventionEvent,
  InterventionSession,
  InterventionResult,
  Metric,
  MetricQuery,
} from '@wallcrawler/core/types/infrastructure';
import { WallCrawlerPage } from '@wallcrawler/core/types/page';
import { WallCrawlerAWSProvider } from '../wallcrawler-aws-extension';
import { createLogger } from '../utils/logger';

const logger = createLogger('aws-infrastructure-provider');

export interface AWSProviderConfig {
  region: string;
  artifactsBucket: string;
  interventionFunctionName?: string;
  sessionsTable?: string;
  checkpointsTable?: string;
  cacheTable?: string;
  metricsTable?: string;
}

export class AWSInfrastructureProvider implements InfrastructureProvider {
  private lambdaClient: LambdaClient;
  private s3Client: S3Client;
  private dynamoClient: DynamoDBClient;
  private config: AWSProviderConfig;
  private extension?: WallCrawlerAWSProvider;

  constructor(config: AWSProviderConfig) {
    this.config = {
      sessionsTable: 'wallcrawler-sessions',
      checkpointsTable: 'wallcrawler-checkpoints',
      cacheTable: 'wallcrawler-cache',
      metricsTable: 'wallcrawler-metrics',
      ...config,
    };

    this.lambdaClient = new LambdaClient({ region: config.region });
    this.s3Client = new S3Client({ region: config.region });
    this.dynamoClient = new DynamoDBClient({ region: config.region });

    // Initialize extension if intervention support is configured
    if (config.interventionFunctionName) {
      this.extension = new WallCrawlerAWSProvider({
        region: config.region,
        artifactsBucket: config.artifactsBucket,
      });
    }

    logger.info('AWS Infrastructure Provider initialized', {
      region: config.region,
      artifactsBucket: config.artifactsBucket,
    });
  }

  async createBrowser(config: BrowserConfig): Promise<WallCrawlerPage> {
    // In Lambda environment, create browser instance
    logger.info('Creating browser instance', { sessionId: config.sessionId });

    try {
      const browser = await chromium.launch({
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
        ],
        executablePath: await chromium.executablePath(),
        headless: config.headless ?? true,
      });

      const context = await browser.newContext({
        viewport: config.viewport,
        userAgent: config.userAgent,
        locale: config.locale,
        timezoneId: config.timezone,
      });

      const page = await context.newPage();

      // Note: In real implementation, would need to properly create WallCrawlerPage
      // with all handlers and proper initialization
      // This is a simplified version for the infrastructure provider
      const wallcrawlerPage = page as unknown as WallCrawlerPage;
      (wallcrawlerPage as any).sessionId =
        config.sessionId || this.generateSessionId();

      logger.info('Browser created successfully', {
        sessionId: (wallcrawlerPage as any).sessionId,
      });

      return wallcrawlerPage;
    } catch (error) {
      logger.error('Failed to create browser', error);
      throw error;
    }
  }

  async destroyBrowser(sessionId: string): Promise<void> {
    logger.info('Destroying browser session', { sessionId });
    // In Lambda, browser cleanup happens automatically when function ends
    // Could implement explicit cleanup if needed
  }

  async saveState(state: BrowserState): Promise<StateReference> {
    const key = `states/${state.sessionId}/${Date.now()}.json`;

    logger.debug('Saving browser state', { sessionId: state.sessionId, key });

    // Save screenshot separately if present
    let screenshotKey: string | undefined;
    if (state.screenshot) {
      screenshotKey = `screenshots/${state.sessionId}/${Date.now()}.png`;
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.config.artifactsBucket,
          Key: screenshotKey,
          Body: state.screenshot,
          ContentType: 'image/png',
        })
      );
    }

    // Save state without screenshot
    const stateToSave = { ...state, screenshot: undefined, screenshotKey };

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.config.artifactsBucket,
        Key: key,
        Body: JSON.stringify(stateToSave),
        ContentType: 'application/json',
      })
    );

    logger.info('State saved successfully', {
      sessionId: state.sessionId,
      key,
    });

    return {
      sessionId: state.sessionId,
      bucket: this.config.artifactsBucket,
      key,
    };
  }

  async loadState(reference: StateReference): Promise<BrowserState> {
    logger.debug('Loading browser state', reference);

    const response = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: reference.bucket,
        Key: reference.key,
      })
    );

    const data = await response.Body!.transformToString();
    const state = JSON.parse(data);

    // Load screenshot if reference exists
    if (state.screenshotKey) {
      const screenshotResponse = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: reference.bucket,
          Key: state.screenshotKey,
        })
      );
      state.screenshot = Buffer.from(
        await screenshotResponse.Body!.transformToByteArray()
      );
    }

    logger.info('State loaded successfully', { sessionId: state.sessionId });

    return state;
  }

  async saveCheckpoint(checkpoint: Checkpoint): Promise<CheckpointReference> {
    const timestamp = checkpoint.timestamp;

    logger.debug('Saving checkpoint', {
      sessionId: checkpoint.sessionId,
      timestamp,
    });

    // Save to DynamoDB for quick access
    await this.dynamoClient.send(
      new PutItemCommand({
        TableName: this.config.checkpointsTable!,
        Item: {
          sessionId: { S: checkpoint.sessionId },
          timestamp: { N: timestamp.toString() },
          data: { S: JSON.stringify(checkpoint) },
          ttl: { N: (Math.floor(Date.now() / 1000) + 86400).toString() }, // 24h TTL
        },
      })
    );

    // Also save to S3 for durability
    const key = `checkpoints/${checkpoint.sessionId}/${timestamp}.json`;
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.config.artifactsBucket,
        Key: key,
        Body: JSON.stringify(checkpoint),
        ContentType: 'application/json',
      })
    );

    logger.info('Checkpoint saved successfully', {
      sessionId: checkpoint.sessionId,
      timestamp,
    });

    return {
      sessionId: checkpoint.sessionId,
      bucket: this.config.artifactsBucket,
      key,
      timestamp,
    };
  }

  async loadCheckpoint(reference: CheckpointReference): Promise<Checkpoint> {
    logger.debug('Loading checkpoint', reference);

    // Try DynamoDB first for speed
    try {
      const response = await this.dynamoClient.send(
        new GetItemCommand({
          TableName: this.config.checkpointsTable!,
          Key: {
            sessionId: { S: reference.sessionId },
            timestamp: { N: reference.timestamp.toString() },
          },
        })
      );

      if (response.Item) {
        const checkpoint = JSON.parse(response.Item.data.S!);
        logger.info('Checkpoint loaded from DynamoDB', {
          sessionId: reference.sessionId,
        });
        return checkpoint;
      }
    } catch (error) {
      logger.warn('Failed to load checkpoint from DynamoDB, trying S3', error);
    }

    // Fallback to S3
    const response = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: reference.bucket,
        Key: reference.key,
      })
    );

    const data = await response.Body!.transformToString();
    const checkpoint = JSON.parse(data);

    logger.info('Checkpoint loaded from S3', {
      sessionId: reference.sessionId,
    });

    return checkpoint;
  }

  async saveArtifact(artifact: Artifact): Promise<ArtifactReference> {
    const timestamp = Date.now();
    const extension = this.getFileExtension(artifact.type);
    const key = `artifacts/${artifact.metadata.sessionId}/${artifact.type}/${timestamp}.${extension}`;

    logger.debug('Saving artifact', {
      type: artifact.type,
      sessionId: artifact.metadata.sessionId,
      key,
    });

    const contentType = this.getContentType(artifact.type);
    const body =
      typeof artifact.data === 'string'
        ? Buffer.from(artifact.data)
        : artifact.data;

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.config.artifactsBucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        Metadata: artifact.metadata,
      })
    );

    logger.info('Artifact saved successfully', {
      type: artifact.type,
      key,
    });

    return {
      sessionId: artifact.metadata.sessionId,
      bucket: this.config.artifactsBucket,
      key,
      type: artifact.type,
      contentType,
    };
  }

  async loadArtifact(reference: ArtifactReference): Promise<Artifact> {
    logger.debug('Loading artifact', reference);

    const response = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: reference.bucket,
        Key: reference.key,
      })
    );

    const data =
      reference.type === 'dom' || reference.type === 'trace'
        ? await response.Body!.transformToString()
        : Buffer.from(await response.Body!.transformToByteArray());

    logger.info('Artifact loaded successfully', {
      type: reference.type,
      key: reference.key,
    });

    return {
      type: reference.type,
      data,
      metadata: response.Metadata || {},
    };
  }

  async handleIntervention(
    event: InterventionEvent
  ): Promise<InterventionSession> {
    if (!this.extension) {
      throw new Error('Intervention support not configured');
    }

    logger.info('Handling intervention', {
      type: event.type,
      sessionId: event.sessionId,
    });

    return this.extension.handleIntervention(event);
  }

  async waitForIntervention(sessionId: string): Promise<InterventionResult> {
    if (!this.extension) {
      throw new Error('Intervention support not configured');
    }

    logger.info('Waiting for intervention completion', { sessionId });

    return this.extension.waitForInterventionComplete(sessionId);
  }

  async recordMetric(metric: Metric): Promise<void> {
    logger.debug('Recording metric', { name: metric.name });

    await this.dynamoClient.send(
      new PutItemCommand({
        TableName: this.config.metricsTable!,
        Item: {
          metricName: { S: metric.name },
          timestamp: { N: metric.timestamp.toString() },
          value: { N: metric.value.toString() },
          unit: { S: metric.unit },
          dimensions: { S: JSON.stringify(metric.dimensions) },
          ttl: { N: (Math.floor(Date.now() / 1000) + 2592000).toString() }, // 30 days TTL
        },
      })
    );
  }

  async getMetrics(query: MetricQuery): Promise<Metric[]> {
    logger.debug('Querying metrics', query);

    // Simplified implementation - would need proper DynamoDB query
    // with filtering by name, time range, and dimensions
    return [];
  }

  // Cache implementation
  async cacheGet(key: string): Promise<any | null> {
    try {
      const response = await this.dynamoClient.send(
        new GetItemCommand({
          TableName: this.config.cacheTable!,
          Key: { cacheKey: { S: key } },
        })
      );

      if (response.Item) {
        const ttl = parseInt(response.Item.ttl.N!);
        if (ttl > Date.now() / 1000) {
          logger.debug('Cache hit', { key });
          return JSON.parse(response.Item.value.S!);
        }
      }

      logger.debug('Cache miss', { key });
    } catch (error) {
      logger.error('Cache get error', error);
    }
    return null;
  }

  async cacheSet(key: string, value: any, ttl: number): Promise<void> {
    logger.debug('Setting cache', { key, ttl });

    await this.dynamoClient.send(
      new PutItemCommand({
        TableName: this.config.cacheTable!,
        Item: {
          cacheKey: { S: key },
          value: { S: JSON.stringify(value) },
          ttl: { N: (Math.floor(Date.now() / 1000) + ttl).toString() },
          timestamp: { N: Date.now().toString() },
        },
      })
    );
  }

  // Helper methods
  private generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }

  private getFileExtension(type: Artifact['type']): string {
    switch (type) {
      case 'screenshot':
        return 'png';
      case 'dom':
        return 'json';
      case 'video':
        return 'webm';
      case 'trace':
        return 'json';
      default:
        return 'bin';
    }
  }

  private getContentType(type: Artifact['type']): string {
    switch (type) {
      case 'screenshot':
        return 'image/png';
      case 'dom':
        return 'application/json';
      case 'video':
        return 'video/webm';
      case 'trace':
        return 'application/json';
      default:
        return 'application/octet-stream';
    }
  }
}
