import { WallCrawler } from '@wallcrawler/core';
import { AWSInfrastructureProvider } from '../providers/aws-infrastructure-provider';
import { createLogger } from '../utils/logger';

const logger = createLogger('browser-automation-handler');

let wallcrawler: WallCrawler;

export interface AutomationEvent {
  sessionId?: string;
  task: {
    type: 'act' | 'extract' | 'observe' | 'navigate';
    instruction?: string;
    url?: string;
    schema?: any;
    options?: any;
  };
  checkpoint?: {
    enabled: boolean;
    intervalMs?: number;
  };
}

export interface AutomationResult {
  success: boolean;
  sessionId: string;
  data?: any;
  error?: string;
  artifacts?: {
    screenshots?: string[];
    dom?: string[];
  };
  checkpoint?: {
    reference: any;
    timestamp: number;
  };
}

export async function handler(
  event: AutomationEvent,
  context: any
): Promise<AutomationResult> {
  const requestId = context.requestId;
  const sessionId = event.sessionId || requestId;

  logger.info('Automation request received', {
    requestId,
    sessionId,
    taskType: event.task.type,
  });

  // Initialize WallCrawler with AWS provider (singleton pattern)
  if (!wallcrawler) {
    const provider = new AWSInfrastructureProvider({
      region: process.env.AWS_REGION!,
      artifactsBucket: process.env.ARTIFACTS_BUCKET!,
      interventionFunctionName: process.env.INTERVENTION_FUNCTION,
      sessionsTable: process.env.SESSIONS_TABLE,
      checkpointsTable: process.env.CHECKPOINTS_TABLE,
      cacheTable: process.env.CACHE_TABLE,
    });

    wallcrawler = new WallCrawler({
      provider,
      llm: {
        provider: process.env.LLM_PROVIDER as any || 'bedrock',
        model: process.env.LLM_MODEL || 'anthropic.claude-3-sonnet-20240229-v1:0',
        apiKey: process.env.LLM_API_KEY,
      },
      browser: {
        headless: true,
        viewport: { width: 1280, height: 720 },
        timeout: 30000,
      },
      features: {
        selfHeal: true,
        captchaHandling: true,
        requestInterception: true,
        caching: {
          enabled: true,
          ttl: 300,
          maxSize: 1000,
        },
      },
    });

    logger.info('WallCrawler initialized');
  }

  let page;
  let checkpointReference;

  try {
    // Create page with session ID
    page = await wallcrawler.createPage({ sessionId });
    
    logger.info('Browser page created', { sessionId });

    // Execute the requested task
    let result: any;
    
    switch (event.task.type) {
      case 'navigate':
        if (!event.task.url) {
          throw new Error('URL required for navigate task');
        }
        await page.goto(event.task.url);
        result = { url: await page.url() };
        break;

      case 'act':
        if (!event.task.instruction) {
          throw new Error('Instruction required for act task');
        }
        await page.act(event.task.instruction, event.task.options);
        result = { success: true };
        break;

      case 'extract':
        if (!event.task.instruction || !event.task.schema) {
          throw new Error('Instruction and schema required for extract task');
        }
        result = await page.extract({
          instruction: event.task.instruction,
          schema: event.task.schema,
          ...event.task.options,
        });
        break;

      case 'observe':
        result = await page.observe(event.task.instruction);
        break;

      default:
        throw new Error(`Unknown task type: ${event.task.type}`);
    }

    // Create checkpoint if requested
    if (event.checkpoint?.enabled) {
      const sessionManager = wallcrawler.getSessionManager();
      checkpointReference = await sessionManager.saveCheckpoint(page);
      logger.info('Checkpoint created', { sessionId });
    }

    // Capture artifacts
    const artifacts: AutomationResult['artifacts'] = {};
    
    // Always capture a screenshot
    try {
      const screenshot = await page.screenshot();
      const provider = wallcrawler.getProvider()!;
      const screenshotRef = await provider.saveArtifact({
        type: 'screenshot',
        data: screenshot,
        metadata: { sessionId, taskType: event.task.type },
      });
      artifacts.screenshots = [screenshotRef.key];
    } catch (error) {
      logger.warn('Failed to capture screenshot', error);
    }

    // Save DOM for debugging if requested
    if (process.env.SAVE_DOM === 'true') {
      try {
        await page.debugDom('/tmp/dom.json');
        const domContent = require('fs').readFileSync('/tmp/dom.json', 'utf-8');
        const provider = wallcrawler.getProvider()!;
        const domRef = await provider.saveArtifact({
          type: 'dom',
          data: domContent,
          metadata: { sessionId, taskType: event.task.type },
        });
        artifacts.dom = [domRef.key];
      } catch (error) {
        logger.warn('Failed to save DOM', error);
      }
    }

    logger.info('Task completed successfully', {
      sessionId,
      taskType: event.task.type,
    });

    return {
      success: true,
      sessionId,
      data: result,
      artifacts,
      checkpoint: checkpointReference ? {
        reference: checkpointReference,
        timestamp: checkpointReference.timestamp,
      } : undefined,
    };

  } catch (error: any) {
    logger.error('Task execution failed', {
      sessionId,
      taskType: event.task.type,
      error: error.message,
      stack: error.stack,
    });

    // Check if this is an intervention required error
    if (error.message?.includes('intervention') && page) {
      try {
        // Handle intervention through provider
        await wallcrawler.handleInterventionDetected(page, {
          type: 'custom',
          sessionId,
          url: await page.url(),
          description: error.message,
          context: { taskType: event.task.type },
        });
        
        // Retry the task after intervention
        return handler(event, context);
      } catch (interventionError: any) {
        logger.error('Intervention handling failed', interventionError);
      }
    }

    return {
      success: false,
      sessionId,
      error: error.message || 'Unknown error occurred',
    };

  } finally {
    // Clean up
    if (page) {
      try {
        await page.close();
      } catch (error) {
        logger.warn('Failed to close page', error);
      }
    }
  }
}

// Export for testing
export { wallcrawler };