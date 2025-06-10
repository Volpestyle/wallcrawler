import { Page, CDPSession } from 'playwright';
import { AXNode } from '../types/cdp';
import { createLogger } from '../utils/logger';

const logger = createLogger('dom');

export interface ProcessedDOM {
  title: string;
  url: string;
  elements: ProcessedElement[];
  accessibility: AXNode[];
  timestamp: number;
}

export interface ProcessedElement {
  id: string;
  tagName: string;
  text?: string;
  value?: string;
  placeholder?: string;
  role?: string;
  name?: string;
  description?: string;
  selector: string;
  xpath: string;
  visible: boolean;
  interactive: boolean;
  boundingBox?: { x: number; y: number; width: number; height: number };
  attributes: Record<string, string>;
}

export interface DOMProcessorOptions {
  includeAccessibility?: boolean;
  includeInvisible?: boolean;
  maxElements?: number;
  chunkSize?: number;
}

export class DOMProcessor {
  constructor(
    private page: Page,
    private cdpSession: CDPSession
  ) {}

  async getProcessedDOM(options: DOMProcessorOptions = {}): Promise<ProcessedDOM> {
    const {
      includeAccessibility = true,
      includeInvisible = false,
      maxElements = 1000,
      chunkSize = 1000,
    } = options;

    logger.debug('Processing DOM', options);

    try {
      // Get page metadata
      const title = await this.page.title();
      const url = this.page.url();

      // Get accessibility tree if requested
      let accessibility: AXNode[] = [];
      if (includeAccessibility) {
        accessibility = await this.getAccessibilityTree();
      }

      // Get DOM elements
      const elements = await this.getElements({
        includeInvisible,
        maxElements,
        chunkSize,
      });

      logger.info('DOM processed', {
        elementCount: elements.length,
        accessibilityNodeCount: accessibility.length,
      });

      return {
        title,
        url,
        elements,
        accessibility,
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.error('Failed to process DOM', error);
      throw error;
    }
  }

  private async getAccessibilityTree(): Promise<AXNode[]> {
    try {
      const { nodes } = await this.cdpSession.send('Accessibility.getFullAXTree');
      return nodes || [];
    } catch (error) {
      logger.warn('Failed to get accessibility tree', error);
      return [];
    }
  }

  private async getElements(options: {
    includeInvisible: boolean;
    maxElements: number;
    chunkSize: number;
  }): Promise<ProcessedElement[]> {
    const { includeInvisible, maxElements, chunkSize } = options;

    // First inject the helper functions
    await this.page.evaluate(initializeHelpers);

    // Then get elements
    const elements = await this.page.evaluate(
      ({ includeInvisible, maxElements, chunkSize }) => {
        const processedElements: any[] = [];
        const allElements = document.querySelectorAll('*');
        
        // Process in chunks to avoid blocking
        for (let i = 0; i < allElements.length && processedElements.length < maxElements; i++) {
          const element = allElements[i] as HTMLElement;
          
          // Skip invisible elements if requested
          if (!includeInvisible) {
            const style = window.getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
              continue;
            }
          }

          // Skip script and style elements
          if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(element.tagName)) {
            continue;
          }

          // Get element properties
          const rect = element.getBoundingClientRect();
          const isVisible = rect.width > 0 && rect.height > 0;
          
          const processed = {
            id: element.id || `element-${i}`,
            tagName: element.tagName.toLowerCase(),
            text: element.textContent?.trim().substring(0, 100),
            value: (element as any).value,
            placeholder: element.getAttribute('placeholder'),
            role: element.getAttribute('role'),
            name: element.getAttribute('name') || element.getAttribute('aria-label'),
            description: element.getAttribute('aria-description'),
            selector: (window as any).generateSelector(element),
            xpath: (window as any).generateXPath(element),
            visible: isVisible,
            interactive: (window as any).isInteractive(element),
            boundingBox: isVisible ? {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            } : undefined,
            attributes: (window as any).getAttributes(element),
          };

          processedElements.push(processed);
        }

        return processedElements;
      },
      { includeInvisible, maxElements, chunkSize }
    );

    return elements;
  }
}

// Add helper functions to page context
declare global {
  interface Window {
    generateSelector(element: Element): string;
    generateXPath(element: Element): string;
    isInteractive(element: Element): boolean;
    getAttributes(element: Element): Record<string, string>;
  }
}

// Inject helper functions
const initializeHelpers = `
window.generateSelector = function(element) {
  // Try ID first
  if (element.id) {
    return '#' + CSS.escape(element.id);
  }

  // Try unique class combination
  const classes = Array.from(element.classList).filter(c => c.length > 0);
  if (classes.length > 0) {
    const selector = element.tagName.toLowerCase() + '.' + classes.map(c => CSS.escape(c)).join('.');
    if (document.querySelectorAll(selector).length === 1) {
      return selector;
    }
  }

  // Try attribute selectors
  const attrs = ['name', 'type', 'placeholder', 'aria-label', 'data-testid'];
  for (const attr of attrs) {
    const value = element.getAttribute(attr);
    if (value) {
      const selector = element.tagName.toLowerCase() + '[' + attr + '="' + CSS.escape(value) + '"]';
      if (document.querySelectorAll(selector).length === 1) {
        return selector;
      }
    }
  }

  // Fall back to nth-child
  const parent = element.parentElement;
  if (parent) {
    const index = Array.from(parent.children).indexOf(element) + 1;
    const parentSelector = window.generateSelector(parent);
    return parentSelector + ' > ' + element.tagName.toLowerCase() + ':nth-child(' + index + ')';
  }

  return element.tagName.toLowerCase();
};

window.generateXPath = function(element) {
  if (element.id) {
    return '//*[@id="' + element.id + '"]';
  }

  const parts = [];
  let current = element;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let index = 1;
    let sibling = current.previousSibling;

    while (sibling) {
      if (sibling.nodeType === Node.ELEMENT_NODE && sibling.nodeName === current.nodeName) {
        index++;
      }
      sibling = sibling.previousSibling;
    }

    const tagName = current.nodeName.toLowerCase();
    const part = tagName + '[' + index + ']';
    parts.unshift(part);

    current = current.parentElement;
  }

  return '/' + parts.join('/');
};

window.isInteractive = function(element) {
  const tagName = element.tagName.toLowerCase();
  const interactiveTags = ['a', 'button', 'input', 'select', 'textarea', 'label'];
  
  if (interactiveTags.includes(tagName)) {
    return true;
  }

  // Check for click handlers or role
  const hasClickHandler = element.onclick !== null || element.getAttribute('onclick') !== null;
  const hasRole = ['button', 'link', 'menuitem', 'tab'].includes(element.getAttribute('role') || '');
  
  return hasClickHandler || hasRole;
};

window.getAttributes = function(element) {
  const attrs = {};
  for (const attr of element.attributes) {
    // Skip very long attribute values
    if (attr.value.length < 100) {
      attrs[attr.name] = attr.value;
    }
  }
  return attrs;
};
`;