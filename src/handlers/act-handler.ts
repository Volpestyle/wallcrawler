import { Page, CDPSession } from 'playwright';
import { z } from 'zod';
import { ActHandler as IActHandler, ActOptions } from '../types/handlers';
import { NetworkMonitor } from '../types/cdp';
import { LLMClient } from '../types/llm';
import { WallCrawlerConfig } from '../types/config';
import { ElementNotFoundError, TimeoutError } from '../types/errors';
import { createLogger } from '../utils/logger';
import { DOMProcessor } from '../dom/processor';
import { ElementSelector } from '../dom/selector';
import { retry } from '../utils/retry';

const logger = createLogger('act');

const ActionSchema = z.object({
  action: z.enum(['click', 'fill', 'type', 'press', 'select', 'check', 'uncheck', 'hover']),
  selector: z.string().describe('The best selector for the target element'),
  value: z.string().optional().describe('Value for fill/type/select actions'),
  confidence: z.number().min(0).max(1).describe('Confidence score for this action'),
});

export class ActHandler implements IActHandler {
  private domProcessor: DOMProcessor;
  private elementSelector: ElementSelector;

  constructor(
    private page: Page,
    private cdpSession: CDPSession,
    private networkMonitor: NetworkMonitor,
    private llmClient: LLMClient,
    private config: WallCrawlerConfig
  ) {
    this.domProcessor = new DOMProcessor(page, cdpSession);
    this.elementSelector = new ElementSelector(page);
  }

  async execute(instruction: string, options: ActOptions = {}): Promise<void> {
    const {
      maxAttempts = 3,
      settlementStrategy = 'patient',
      screenshot = false,
      validateSuccess,
    } = options;

    logger.info('Executing action', { instruction, options });

    try {
      await retry(
        async () => {
          // Get current DOM state
          const domState = await this.domProcessor.getProcessedDOM({
            includeAccessibility: true,
            maxElements: 1000,
          });

          // Get element candidates
          const candidates = await this.elementSelector.findCandidates(domState.elements);

          // Take screenshot if requested
          let screenshotBase64: string | undefined;
          if (screenshot || this.config.llm.provider === 'anthropic') {
            screenshotBase64 = await this.page.screenshot({ encoding: 'base64' });
          }

          // Generate action using LLM
          const prompt = this.buildPrompt(instruction, domState, candidates);
          
          const action = await this.llmClient.generateObject({
            prompt,
            schema: ActionSchema,
            images: screenshotBase64 ? [screenshotBase64] : undefined,
            temperature: 0.1, // Low temperature for more deterministic actions
          });

          logger.debug('Generated action', action);

          // Execute the action
          await this.executeAction(action);

          // Wait for settlement based on strategy
          if (settlementStrategy !== 'none') {
            await this.waitForSettlement(settlementStrategy);
          }

          // Validate success if provided
          if (validateSuccess) {
            const success = await validateSuccess(this.page);
            if (!success) {
              throw new Error('Action validation failed');
            }
          }
        },
        {
          maxAttempts,
          delay: 1000,
          backoff: 2,
          shouldRetry: (error) => {
            // Retry on element not found or timeout errors
            return error instanceof ElementNotFoundError || 
                   error instanceof TimeoutError ||
                   error.message.includes('not found') ||
                   error.message.includes('timeout');
          },
        }
      );

      logger.info('Action executed successfully', { instruction });
    } catch (error) {
      logger.error('Failed to execute action', error, { instruction });
      throw error;
    }
  }

  private buildPrompt(
    instruction: string,
    domState: any,
    candidates: any[]
  ): string {
    return `You are a browser automation assistant. Your task is to perform the following action:

${instruction}

Current page URL: ${this.page.url()}
Page title: ${domState.title}

Available elements (top ${candidates.length} candidates):
${candidates.map((el, i) => `${i + 1}. ${this.formatElement(el)}`).join('\n')}

Analyze the elements and determine:
1. Which element best matches the instruction
2. What action to perform (click, fill, type, etc.)
3. Any value needed for the action

Return the most appropriate action to fulfill the instruction.`;
  }

  private formatElement(element: any): string {
    const parts = [
      `Tag: ${element.tagName}`,
      element.text && `Text: "${element.text.substring(0, 50)}${element.text.length > 50 ? '...' : ''}"`,
      element.role && `Role: ${element.role}`,
      element.name && `Name: ${element.name}`,
      element.placeholder && `Placeholder: ${element.placeholder}`,
      element.value && `Value: ${element.value}`,
      `Selector: ${element.selector}`,
    ].filter(Boolean);

    return parts.join(', ');
  }

  private async executeAction(action: z.infer<typeof ActionSchema>): Promise<void> {
    const { action: actionType, selector, value } = action;
    
    logger.debug('Executing action', { actionType, selector, value });

    // Wait for selector with timeout
    const element = await this.page.locator(selector).first();
    await element.waitFor({ state: 'visible', timeout: 5000 });

    switch (actionType) {
      case 'click':
        await element.click();
        break;
      
      case 'fill':
        if (!value) throw new Error('Fill action requires a value');
        await element.fill(value);
        break;
      
      case 'type':
        if (!value) throw new Error('Type action requires a value');
        await element.type(value);
        break;
      
      case 'press':
        if (!value) throw new Error('Press action requires a value');
        await element.press(value);
        break;
      
      case 'select':
        if (!value) throw new Error('Select action requires a value');
        await element.selectOption(value);
        break;
      
      case 'check':
        await element.check();
        break;
      
      case 'uncheck':
        await element.uncheck();
        break;
      
      case 'hover':
        await element.hover();
        break;
      
      default:
        throw new Error(`Unknown action type: ${actionType}`);
    }
  }

  private async waitForSettlement(strategy: 'aggressive' | 'patient'): Promise<void> {
    const options = strategy === 'aggressive'
      ? { quietWindowMs: 200, maxWaitMs: 5000 }
      : { quietWindowMs: 500, maxWaitMs: 10000 };

    await this.networkMonitor.waitForSettlement(options);
  }
}