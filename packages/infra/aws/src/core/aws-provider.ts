import { WallCrawlerPage } from 'wallcrawler';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { InterventionEvent } from '../types/intervention';
import { sendBrowserState } from '../intervention/websocket-handler';
import { createLogger } from '../utils/logger';

const logger = createLogger('wallcrawler-extension');

export interface AWSProviderConfig {
  region?: string;
  interventionLambdaArn?: string;
  artifactsBucket?: string;
}

export class WallCrawlerAWSProvider {
  private lambdaClient: LambdaClient;
  private s3Client: S3Client;
  private config: Required<AWSProviderConfig>;
  private sessionId: string;
  private userId: string;

  constructor(
    sessionId: string,
    userId: string,
    config: AWSProviderConfig = {}
  ) {
    this.sessionId = sessionId;
    this.userId = userId;

    this.config = {
      region: config.region || process.env.AWS_REGION || 'us-east-1',
      interventionLambdaArn:
        config.interventionLambdaArn ||
        process.env.INTERVENTION_LAMBDA_ARN ||
        '',
      artifactsBucket:
        config.artifactsBucket || process.env.ARTIFACTS_BUCKET || '',
    };

    this.lambdaClient = new LambdaClient({ region: this.config.region });
    this.s3Client = new S3Client({ region: this.config.region });
  }

  /**
   * Handle an intervention event detected by WallCrawler
   * This method should be called when WallCrawler's observe method detects an intervention
   */
  async handleIntervention(
    interventionEvent: InterventionEvent,
    page: WallCrawlerPage
  ): Promise<{
    interventionId: string;
    portalUrl: string;
    expiresAt: number;
  }> {
    try {
      logger.info('Handling intervention', {
        sessionId: this.sessionId,
        type: interventionEvent.type,
      });

      // Call Lambda to create intervention session and send notifications
      const response = await this.lambdaClient.send(
        new InvokeCommand({
          FunctionName: this.config.interventionLambdaArn,
          Payload: JSON.stringify({
            sessionId: this.sessionId,
            userId: this.userId,
            interventionEvent,
          }),
        })
      );

      const result = JSON.parse(new TextDecoder().decode(response.Payload));

      if (result.interventionId) {
        logger.info('Intervention session created', {
          sessionId: this.sessionId,
          interventionId: result.interventionId,
        });

        // Send initial browser state to portal
        await this.sendBrowserStateToPortal(page, result.interventionId);

        // Wait for intervention to complete
        await this.waitForInterventionComplete(
          result.interventionId,
          result.expiresAt
        );

        return result;
      }

      throw new Error('Failed to create intervention session');
    } catch (error) {
      logger.error('Failed to handle intervention', error);
      throw error;
    }
  }

  /**
   * Send current browser state to the intervention portal
   */
  private async sendBrowserStateToPortal(
    page: WallCrawlerPage,
    interventionId: string
  ): Promise<void> {
    try {
      const screenshot = (await page.screenshot()) as Buffer;
      const url = page.url();
      const title = await page.title();
      const viewport = page.viewportSize() || { width: 1280, height: 720 };

      // Get interactive elements
      const elements = await page.evaluate(() => {
        const interactiveSelectors = [
          'input',
          'button',
          'select',
          'textarea',
          'a',
          '[onclick]',
          '[role="button"]',
        ];

        return interactiveSelectors.flatMap((selector) => {
          return Array.from(document.querySelectorAll(selector)).map((el) => {
            const rect = el.getBoundingClientRect();
            return {
              selector:
                el.tagName.toLowerCase() +
                (el.id ? `#${el.id}` : '') +
                (el.className ? `.${el.className.split(' ').join('.')}` : ''),
              type: el.tagName.toLowerCase(),
              visible: rect.width > 0 && rect.height > 0,
              interactable:
                !(el as HTMLElement).hidden &&
                !(el as HTMLInputElement).disabled,
              bounds: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
              },
            };
          });
        });
      });

      await sendBrowserState(this.sessionId, {
        sessionId: this.sessionId,
        url,
        title,
        screenshot:
          typeof screenshot === 'string'
            ? screenshot
            : screenshot.toString('base64'),
        viewport,
        elements,
      });
    } catch (error) {
      logger.error('Failed to send browser state', error);
    }
  }

  /**
   * Wait for intervention to complete
   */
  private async waitForInterventionComplete(
    interventionId: string,
    expiresAt: number
  ): Promise<void> {
    const checkInterval = 5000; // 5 seconds
    const maxWaitTime = expiresAt - Date.now();

    logger.info('Waiting for intervention to complete', {
      interventionId,
      maxWaitTime: maxWaitTime / 1000 + ' seconds',
    });

    return new Promise((resolve, reject) => {
      const intervalId = setInterval(async () => {
        try {
          // Check intervention status
          // In production, this would query DynamoDB or call a status API
          const isComplete = await this.checkInterventionStatus(interventionId);

          if (isComplete) {
            clearInterval(intervalId);
            logger.info('Intervention completed', { interventionId });
            resolve();
          } else if (Date.now() > expiresAt) {
            clearInterval(intervalId);
            reject(new Error('Intervention expired'));
          }
        } catch (error) {
          clearInterval(intervalId);
          reject(error);
        }
      }, checkInterval);
    });
  }

  /**
   * Check if intervention is complete
   */
  private async checkInterventionStatus(
    interventionId: string
  ): Promise<boolean> {
    // In production, this would query DynamoDB for the intervention status
    // For now, we'll simulate with a simple check
    logger.debug('Checking intervention status', { interventionId });
    return false;
  }

  /**
   * Save artifacts to S3
   */
  async saveArtifact(
    key: string,
    data: Buffer | string,
    contentType: string = 'application/octet-stream'
  ): Promise<string> {
    const fullKey = `${this.sessionId}/${key}`;

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.config.artifactsBucket,
        Key: fullKey,
        Body: typeof data === 'string' ? Buffer.from(data) : data,
        ContentType: contentType,
        Metadata: {
          sessionId: this.sessionId,
          userId: this.userId,
          timestamp: Date.now().toString(),
        },
      })
    );

    const url = `https://${this.config.artifactsBucket}.s3.${this.config.region}.amazonaws.com/${fullKey}`;
    logger.info('Artifact saved', { key: fullKey, url });

    return url;
  }
}
