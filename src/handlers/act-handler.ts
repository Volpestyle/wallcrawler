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
  actions: z.array(z.object({
    action: z.enum(['click', 'fill', 'type', 'press', 'select', 'check', 'uncheck', 'hover']),
    selector: z.string().optional().describe('The selector for the target element (not needed for press)'),
    value: z.string().optional().describe('Value for fill/type/select/press actions'),
  })).describe('List of actions to perform in sequence'),
  confidence: z.number().min(0).max(1).describe('Overall confidence score for this action plan'),
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
            const screenshotResult = await this.page.screenshot({ encoding: 'base64' });
            screenshotBase64 = typeof screenshotResult === 'string' 
              ? screenshotResult 
              : screenshotResult.toString('base64');
          }

          // Generate action using LLM
          const prompt = this.buildPrompt(instruction, domState, candidates);
          
          const action = await this.llmClient.generateObject({
            prompt,
            schema: ActionSchema,
            images: screenshotBase64 ? [screenshotBase64] : undefined,
            temperature: 0.1, // Low temperature for more deterministic actions
          });

          logger.debug('Generated action plan', {
            instruction,
            url: this.page.url(),
            actionCount: action.actions.length,
            actions: action.actions.map(a => ({
              action: a.action,
              selector: a.selector?.substring(0, 50) + (a.selector && a.selector.length > 50 ? '...' : ''),
              value: a.value
            })),
            confidence: action.confidence,
            topCandidates: candidates.slice(0, 3).map(c => ({ 
              selector: c.selector.substring(0, 50), 
              text: c.text?.substring(0, 30), 
              tagName: c.tagName 
            }))
          });

          // Execute all actions in sequence
          for (let i = 0; i < action.actions.length; i++) {
            const singleAction = action.actions[i];
            logger.debug(`Executing action ${i + 1} of ${action.actions.length}`, {
              action: singleAction.action,
              selector: singleAction.selector,
              value: singleAction.value
            });
            await this.executeAction(singleAction);
          }

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

Analyze the instruction and determine what actions are needed to fulfill it.

Important guidelines:
- You can return multiple actions that will be executed in sequence
- For search operations, you might need both "fill" and "press" actions
- Example: "type 'hello' and press enter" → [{action: "fill", selector: "...", value: "hello"}, {action: "press", value: "Enter"}]
- For "press" actions without a specific element (like Enter, Escape), omit the selector
- Common key names: "Enter", "Tab", "Escape", "ArrowDown", "ArrowUp"
- Prefer "fill" over "type" for text input as it's more reliable

Return a sequence of actions that will accomplish the user's instruction.`;
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

  private async executeAction(action: { action: string; selector?: string; value?: string }): Promise<void> {
    const { action: actionType, selector, value } = action;
    
    logger.debug('Executing single action', { actionType, selector, value, url: this.page.url() });

    // For press actions, we don't need a selector
    let element;
    if (selector) {
      element = await this.page.locator(selector).first();
      await element.waitFor({ state: 'visible', timeout: 5000 });
    }

    switch (actionType) {
      case 'click':
        await element!.click();
        break;
      
      case 'fill':
        if (!value) throw new Error('Fill action requires a value');
        await element!.fill(value);
        break;
      
      case 'type':
        if (!value) throw new Error('Type action requires a value');
        await element!.type(value);
        break;
      
      case 'press':
        if (!value) throw new Error('Press action requires a value');
        // Press can be global (like Enter) or on a specific element
        if (element) {
          await element.press(value);
        } else {
          await this.page.keyboard.press(value);
        }
        break;
      
      case 'select':
        if (!value) throw new Error('Select action requires a value');
        await element!.selectOption(value);
        break;
      
      case 'check':
        await element!.check();
        break;
      
      case 'uncheck':
        await element!.uncheck();
        break;
      
      case 'hover':
        await element!.hover();
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