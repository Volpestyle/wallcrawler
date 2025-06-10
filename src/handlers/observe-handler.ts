import { Page, CDPSession } from 'playwright';
import { z } from 'zod';
import { ObserveHandler as IObserveHandler, ObserveResult } from '../types/handlers';
import { LLMClient } from '../types/llm';
import { WallCrawlerConfig } from '../types/config';
import { createLogger } from '../utils/logger';
import { DOMProcessor, ProcessedElement } from '../dom/processor';
import { ElementSelector } from '../dom/selector';

const logger = createLogger('observe');

const ObserveResultSchema = z.array(z.object({
  selector: z.string(),
  description: z.string(),
  role: z.string().optional(),
  action: z.enum(['click', 'fill', 'select', 'navigate', 'read']).optional(),
  importance: z.enum(['high', 'medium', 'low']),
}));

export class ObserveHandler implements IObserveHandler {
  private domProcessor: DOMProcessor;
  private elementSelector: ElementSelector;

  constructor(
    private page: Page,
    private cdpSession: CDPSession,
    private llmClient: LLMClient,
    private config: WallCrawlerConfig
  ) {
    this.domProcessor = new DOMProcessor(page, cdpSession);
    this.elementSelector = new ElementSelector(page);
  }

  async observe(instruction?: string): Promise<ObserveResult[]> {
    logger.info('Observing page', { instruction });

    try {
      // Get DOM state with accessibility info
      const domState = await this.domProcessor.getProcessedDOM({
        includeAccessibility: true,
        maxElements: 1000,
      });

      // Get interactive element candidates
      const candidates = await this.elementSelector.findCandidates(
        domState.elements,
        instruction
      );

      // Take screenshot for visual analysis
      let screenshot: string | undefined;
      if (this.config.llm.provider === 'anthropic' || this.config.llm.provider === 'openai') {
        screenshot = await this.page.screenshot({ encoding: 'base64' });
      }

      // Build observation prompt
      const prompt = this.buildPrompt(instruction, domState, candidates);

      // Get observations from LLM
      const observations = await this.llmClient.generateObject({
        prompt,
        schema: ObserveResultSchema,
        images: screenshot ? [screenshot] : undefined,
        temperature: 0.3, // Some creativity for descriptions
      });

      // Map to ObserveResult format with additional data
      const results = await this.enrichObservations(observations, domState.elements);

      logger.info('Page observed', {
        instruction,
        resultCount: results.length,
      });

      return results;
    } catch (error) {
      logger.error('Failed to observe page', error, { instruction });
      throw error;
    }
  }

  private buildPrompt(
    instruction: string | undefined,
    domState: any,
    candidates: any[]
  ): string {
    const basePrompt = `Analyze this web page and identify the most important interactive elements.

Page: ${domState.title}
URL: ${domState.url}

Top interactive elements:
${candidates.slice(0, 30).map((el, i) => `${i + 1}. ${this.formatElementForObservation(el)}`).join('\n')}`;

    if (instruction) {
      return `${basePrompt}

Focus on elements that are relevant to: ${instruction}

For each relevant element, provide:
1. A reliable selector
2. A clear description of what the element does
3. Its role/purpose
4. What action can be performed
5. Its importance (high/medium/low) for the given task`;
    }

    return `${basePrompt}

Identify the most important elements on this page that a user might want to interact with.

For each element, provide:
1. A reliable selector
2. A clear description of what the element does
3. Its role/purpose
4. What action can be performed
5. Its importance (high/medium/low) for general page interaction`;
  }

  private formatElementForObservation(element: any): string {
    const parts = [
      `${element.tagName.toUpperCase()}`,
      element.text && `text="${element.text.substring(0, 50)}${element.text.length > 50 ? '...' : ''}"`,
      element.role && `role=${element.role}`,
      element.name && `name="${element.name}"`,
      element.placeholder && `placeholder="${element.placeholder}"`,
      `selector="${element.selector}"`,
      element.score && `score=${element.score}`,
    ].filter(Boolean);

    if (element.reasons && element.reasons.length > 0) {
      parts.push(`(${element.reasons.join(', ')})`);
    }

    return parts.join(' ');
  }

  private async enrichObservations(
    observations: z.infer<typeof ObserveResultSchema>,
    elements: ProcessedElement[]
  ): Promise<ObserveResult[]> {
    const results: ObserveResult[] = [];

    for (const obs of observations) {
      // Find matching element for additional data
      const element = elements.find(el => 
        el.selector === obs.selector || 
        this.selectorsMatch(el.selector, obs.selector)
      );

      // Validate selector
      let validSelector = obs.selector;
      try {
        const count = await this.page.locator(obs.selector).count();
        if (count !== 1 && element) {
          // Try to find a better selector
          validSelector = await this.elementSelector.findBestSelector(element);
        }
      } catch {
        if (element) {
          validSelector = await this.elementSelector.findBestSelector(element);
        }
      }

      const result: ObserveResult = {
        selector: validSelector,
        description: obs.description,
        role: obs.role || element?.role,
        visible: element?.visible ?? true,
        interactive: element?.interactive ?? true,
        boundingBox: element?.boundingBox ?? { x: 0, y: 0, width: 0, height: 0 },
        attributes: element?.attributes ?? {},
      };

      results.push(result);
    }

    return results;
  }

  private selectorsMatch(selector1: string, selector2: string): boolean {
    // Simple matching - could be enhanced
    if (selector1 === selector2) return true;
    
    // Check if they target the same ID
    const id1 = selector1.match(/#([^\s\[]+)/)?.[1];
    const id2 = selector2.match(/#([^\s\[]+)/)?.[1];
    if (id1 && id2 && id1 === id2) return true;

    // Check if they have the same data-testid
    const testId1 = selector1.match(/\[data-testid="([^"]+)"\]/)?.[1];
    const testId2 = selector2.match(/\[data-testid="([^"]+)"\]/)?.[1];
    if (testId1 && testId2 && testId1 === testId2) return true;

    return false;
  }
}