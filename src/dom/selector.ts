import { Page } from 'playwright';
import { ProcessedElement } from './processor';
import { createLogger } from '../utils/logger';

const logger = createLogger('dom');

export interface ElementCandidate extends ProcessedElement {
  score: number;
  reasons: string[];
}

export class ElementSelector {
  constructor(private page: Page) {}

  async findCandidates(
    elements: ProcessedElement[],
    instruction?: string
  ): Promise<ElementCandidate[]> {
    // Filter to interactive and visible elements
    const candidates = elements
      .filter(el => el.visible && (el.interactive || this.isPotentiallyInteractive(el)))
      .map(el => this.scoreElement(el, instruction))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20); // Top 20 candidates

    logger.debug('Found element candidates', {
      total: elements.length,
      candidates: candidates.length,
    });

    return candidates;
  }

  private isPotentiallyInteractive(element: ProcessedElement): boolean {
    // Check for common interactive patterns
    const { tagName, attributes, text } = element;
    
    // Form elements
    if (['input', 'select', 'textarea', 'button'].includes(tagName)) {
      return true;
    }

    // Links
    if (tagName === 'a' && attributes.href) {
      return true;
    }

    // Elements with click-related attributes
    if (attributes.onclick || attributes['data-click'] || attributes['ng-click']) {
      return true;
    }

    // Elements with button-like text
    const buttonPatterns = /^(submit|save|cancel|ok|next|previous|back|continue|login|sign|buy|add|remove|delete|edit|update|search|go|apply|confirm|yes|no)$/i;
    if (text && buttonPatterns.test(text.trim())) {
      return true;
    }

    // Elements with role attribute
    const interactiveRoles = ['button', 'link', 'menuitem', 'tab', 'checkbox', 'radio'];
    if (element.role && interactiveRoles.includes(element.role)) {
      return true;
    }

    return false;
  }

  private scoreElement(element: ProcessedElement, instruction?: string): ElementCandidate {
    let score = 0;
    const reasons: string[] = [];

    // Base score for being interactive
    if (element.interactive) {
      score += 10;
      reasons.push('Interactive element');
    }

    // Score based on visibility
    if (element.visible && element.boundingBox) {
      const { x, y, width, height } = element.boundingBox;
      
      // Prefer elements in viewport
      if (x >= 0 && y >= 0 && x < 1920 && y < 1080) {
        score += 5;
        reasons.push('In viewport');
      }

      // Prefer reasonably sized elements
      if (width > 20 && height > 20) {
        score += 3;
        reasons.push('Good size');
      }
    }

    // Score based on semantic HTML
    const semanticTags = {
      button: 8,
      a: 7,
      input: 6,
      select: 6,
      textarea: 6,
      label: 4,
    };
    
    if (semanticTags[element.tagName as keyof typeof semanticTags]) {
      score += semanticTags[element.tagName as keyof typeof semanticTags];
      reasons.push(`Semantic tag: ${element.tagName}`);
    }

    // Score based on attributes
    if (element.attributes['data-testid']) {
      score += 5;
      reasons.push('Has data-testid');
    }

    if (element.attributes['aria-label'] || element.name) {
      score += 4;
      reasons.push('Has accessible name');
    }

    if (element.role) {
      score += 3;
      reasons.push(`Has role: ${element.role}`);
    }

    // Score based on selector quality
    if (element.selector.startsWith('#')) {
      score += 4;
      reasons.push('Has ID selector');
    } else if (element.selector.includes('[data-')) {
      score += 3;
      reasons.push('Has data attribute selector');
    }

    // Text matching (if instruction provided)
    if (instruction && element.text) {
      const instructionLower = instruction.toLowerCase();
      const textLower = element.text.toLowerCase();
      
      if (textLower.includes(instructionLower) || instructionLower.includes(textLower)) {
        score += 10;
        reasons.push('Text matches instruction');
      }
    }

    return {
      ...element,
      score,
      reasons,
    };
  }

  async validateSelector(selector: string): Promise<boolean> {
    try {
      const count = await this.page.locator(selector).count();
      return count === 1;
    } catch {
      return false;
    }
  }

  async findBestSelector(element: ProcessedElement): Promise<string> {
    // Try selectors in order of preference
    const selectors = [
      element.selector,
      element.xpath,
      // Generate alternative selectors
      element.id ? `#${element.id}` : null,
      element.attributes['data-testid'] ? `[data-testid="${element.attributes['data-testid']}"]` : null,
      element.name ? `[name="${element.name}"]` : null,
      element.attributes['aria-label'] ? `[aria-label="${element.attributes['aria-label']}"]` : null,
    ].filter(Boolean) as string[];

    for (const selector of selectors) {
      if (await this.validateSelector(selector)) {
        return selector;
      }
    }

    // Fall back to the original selector
    return element.selector;
  }
}