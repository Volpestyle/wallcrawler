import { Page } from 'playwright';
import { ProcessedElement } from './processor';
import { createLogger } from '../utils/logger';

const logger = createLogger('selector');

/**
 * Simplified ElementSelector following Stagehand's approach.
 * 
 * Instead of complex scoring and candidate filtering, we focus on:
 * - Selector validation
 * - XPath generation utilities
 * - Basic selector quality helpers
 * 
 * The LLM handles element intelligence - we just provide clean utilities.
 */
export class ElementSelector {
  constructor(private page: Page) {}

  /**
   * Check if a selector is valid and targets exactly one element.
   * This is useful for validating selectors before using them.
   */
  async validateSelector(selector: string): Promise<boolean> {
    try {
      const count = await this.page.locator(selector).count();
      return count === 1;
    } catch (error) {
      logger.debug('Selector validation failed', { selector, error: (error as Error).message });
      return false;
    }
  }


  /**
   * Find the best working selector for an element.
   * Tries selectors in order of reliability: ID, data-testid, name, aria-label, xpath.
   */
  async findBestSelector(element: ProcessedElement): Promise<string> {
    // Generate selector candidates in order of preference (most reliable first)
    const candidates = [
      // Existing selectors
      element.selector,
      element.xpath,
      
      // ID selector (most reliable)
      element.id ? `#${element.id}` : null,
      
      // Test ID (very reliable for testing)
      element.attributes['data-testid'] ? `[data-testid="${element.attributes['data-testid']}"]` : null,
      
      // Name attribute (reliable for forms)
      element.name ? `[name="${element.name}"]` : null,
      
      // ARIA label (good for accessibility)
      element.attributes['aria-label'] ? `[aria-label="${element.attributes['aria-label']}"]` : null,
    ].filter(Boolean) as string[];

    // Test each candidate and return the first working one
    for (const candidate of candidates) {
      if (await this.validateSelector(candidate)) {
        logger.debug('Found working selector', { element: element.id || element.tagName, selector: candidate });
        return candidate;
      }
    }

    // Fallback to original selector (even if it might not work perfectly)
    logger.warn('No reliable selector found, using fallback', { element: element.id || element.tagName });
    return element.selector;
  }

  /**
   * Generate an XPath for an element using the most reliable attributes.
   * Prefers ID > data-testid > name > text content > class.
   */
  async getXPath(element: ProcessedElement): Promise<string> {
    // Return existing xpath if available
    if (element.xpath) {
      return element.xpath;
    }

    // Generate xpath using most reliable attributes first
    
    // ID is most reliable
    if (element.id) {
      return `//*[@id="${this.escapeXPathValue(element.id)}"]`;
    }

    // data-testid is very reliable for testing
    if (element.attributes['data-testid']) {
      return `//*[@data-testid="${this.escapeXPathValue(element.attributes['data-testid'])}"]`;
    }

    // name attribute is reliable for form elements
    if (element.name) {
      return `//*[@name="${this.escapeXPathValue(element.name)}"]`;
    }

    // Text content can be reliable but needs careful escaping
    if (element.text && element.text.length < 100) { // Avoid very long text
      const cleanText = element.text.trim();
      if (cleanText) {
        return `//${element.tagName}[contains(text(), "${this.escapeXPathValue(cleanText)}")]`;
      }
    }

    // Class-based xpath (use first class only)
    if (element.attributes.class) {
      const firstClass = element.attributes.class.split(' ')[0];
      if (firstClass) {
        return `//${element.tagName}[contains(@class, "${this.escapeXPathValue(firstClass)}")]`;
      }
    }

    // Fallback to tag name with position (less reliable but works)
    return `//${element.tagName}`;
  }

  /**
   * Escape values for safe use in XPath expressions.
   * Handles quotes and special characters properly.
   */
  private escapeXPathValue(value: string): string {
    // If no quotes, wrap in quotes
    if (!value.includes('"') && !value.includes("'")) {
      return value;
    }
    
    // If only double quotes, wrap in single quotes
    if (!value.includes("'")) {
      return value;
    }
    
    // If only single quotes, wrap in double quotes  
    if (!value.includes('"')) {
      return value;
    }
    
    // If both quote types, use concat() function
    const parts = value.split('"');
    const concatParts = parts.map(part => `"${part}"`).join(', \'"\', ');
    return `concat(${concatParts})`;
  }
}