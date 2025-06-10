import { Page, CDPSession } from 'playwright';
import { z } from 'zod';
import { ExtractHandler as IExtractHandler, ExtractOptions } from '../types/handlers';
import { LLMClient } from '../types/llm';
import { WallCrawlerConfig } from '../types/config';
import { createLogger } from '../utils/logger';
import { DOMProcessor } from '../dom/processor';
import { ValidationError } from '../types/errors';

const logger = createLogger('extract');

export class ExtractHandler implements IExtractHandler {
  private domProcessor: DOMProcessor;

  constructor(
    private page: Page,
    private cdpSession: CDPSession,
    private llmClient: LLMClient,
    private config: WallCrawlerConfig
  ) {
    this.domProcessor = new DOMProcessor(page, cdpSession);
  }

  async extract<T>(options: ExtractOptions<T>): Promise<T> {
    const {
      instruction,
      schema,
      mode = 'hybrid',
      includeMetadata = false,
      maxDomSize = 50000,
    } = options;

    logger.info('Extracting data', { instruction, mode });

    try {
      // Transform schema to handle URL fields
      const { transformedSchema, urlPaths } = this.transformSchema(schema);

      // Get content based on mode
      let content: string;
      let images: string[] | undefined;

      switch (mode) {
        case 'text':
          content = await this.getTextContent(maxDomSize);
          break;
        
        case 'visual':
          content = await this.getVisualContent();
          const screenshot = await this.page.screenshot({ encoding: 'base64' });
          images = [screenshot];
          break;
        
        case 'hybrid':
        default:
          content = await this.getHybridContent(maxDomSize);
          if (this.config.llm.provider === 'anthropic' || this.config.llm.provider === 'openai') {
            const screenshot = await this.page.screenshot({ encoding: 'base64' });
            images = [screenshot];
          }
          break;
      }

      // Build extraction prompt
      const prompt = this.buildPrompt(instruction, content, includeMetadata);

      // Extract data using LLM
      const extracted = await this.llmClient.generateObject({
        prompt,
        schema: transformedSchema,
        images,
        temperature: 0.1, // Low temperature for consistent extraction
      });

      // Post-process to restore URLs
      const result = this.restoreUrls(extracted, urlPaths, content);

      // Validate against original schema
      const validated = schema.parse(result);

      logger.info('Data extracted successfully', {
        instruction,
        fields: Object.keys(validated as any),
      });

      return validated;
    } catch (error) {
      logger.error('Failed to extract data', error, { instruction });
      
      if (error instanceof z.ZodError) {
        throw new ValidationError('Extracted data failed schema validation', error.errors);
      }
      
      throw error;
    }
  }

  private transformSchema(schema: z.ZodSchema<any>): {
    transformedSchema: z.ZodSchema<any>;
    urlPaths: string[];
  } {
    const urlPaths: string[] = [];
    
    // Deep clone and transform schema
    const transformedSchema = this.transformZodSchema(schema, '', urlPaths);
    
    logger.debug('Schema transformed', { urlPaths });
    
    return { transformedSchema, urlPaths };
  }

  private transformZodSchema(
    schema: any,
    path: string,
    urlPaths: string[]
  ): any {
    // Handle different Zod types
    if (schema instanceof z.ZodString) {
      // Check if it's a URL string
      if (schema._def.checks?.some((check: any) => check.kind === 'url')) {
        urlPaths.push(path);
        // Transform to number for index reference
        return z.number().describe(`URL reference index for ${path}`);
      }
      return schema;
    }
    
    if (schema instanceof z.ZodObject) {
      const shape: any = {};
      const originalShape = schema._def.shape();
      
      for (const [key, value] of Object.entries(originalShape)) {
        shape[key] = this.transformZodSchema(value, path ? `${path}.${key}` : key, urlPaths);
      }
      
      return z.object(shape);
    }
    
    if (schema instanceof z.ZodArray) {
      return z.array(
        this.transformZodSchema(schema._def.type, `${path}[]`, urlPaths)
      );
    }
    
    // Return schema unchanged for other types
    return schema;
  }

  private async getTextContent(maxSize: number): Promise<string> {
    const dom = await this.domProcessor.getProcessedDOM({
      includeAccessibility: true,
      maxElements: 1000,
    });

    // Build text representation
    const content = [
      `Page: ${dom.title}`,
      `URL: ${dom.url}`,
      '',
      'Content:',
      ...dom.elements
        .filter(el => el.text && el.visible)
        .map(el => {
          const prefix = el.role ? `[${el.role}] ` : '';
          return `${prefix}${el.text}`;
        }),
    ].join('\n');

    return content.substring(0, maxSize);
  }

  private async getVisualContent(): Promise<string> {
    // For visual mode, provide minimal context
    const title = await this.page.title();
    const url = this.page.url();
    
    return `Page: ${title}\nURL: ${url}\n\nAnalyze the screenshot to extract the requested information.`;
  }

  private async getHybridContent(maxSize: number): Promise<string> {
    const dom = await this.domProcessor.getProcessedDOM({
      includeAccessibility: true,
      maxElements: 500, // Fewer elements for hybrid mode
    });

    // Build structured representation
    const content = [
      `Page: ${dom.title}`,
      `URL: ${dom.url}`,
      '',
      'Interactive Elements:',
      ...dom.elements
        .filter(el => el.interactive && el.visible)
        .map(el => this.formatElementForExtraction(el)),
      '',
      'Text Content:',
      ...dom.elements
        .filter(el => el.text && !el.interactive && el.visible)
        .slice(0, 50)
        .map(el => el.text),
    ].join('\n');

    // Collect all URLs from the page
    const urls = await this.page.evaluate(() => {
      const urls: string[] = [];
      document.querySelectorAll('a[href]').forEach((a: any) => {
        if (a.href && !urls.includes(a.href)) {
          urls.push(a.href);
        }
      });
      return urls;
    });

    const urlsSection = urls.length > 0 
      ? `\n\nURLs found on page:\n${urls.map((url, i) => `${i}: ${url}`).join('\n')}`
      : '';

    return (content + urlsSection).substring(0, maxSize);
  }

  private formatElementForExtraction(element: any): string {
    const parts = [
      element.tagName.toUpperCase(),
      element.role && `role="${element.role}"`,
      element.text && `"${element.text}"`,
      element.value && `value="${element.value}"`,
      element.name && `name="${element.name}"`,
    ].filter(Boolean);

    return `- ${parts.join(' ')}`;
  }

  private buildPrompt(
    instruction: string,
    content: string,
    includeMetadata: boolean
  ): string {
    let prompt = `Extract the following information from the page:\n\n${instruction}\n\n`;
    
    if (includeMetadata) {
      prompt += 'Include any relevant metadata or context that might be useful.\n\n';
    }
    
    prompt += `Page content:\n${content}`;
    
    return prompt;
  }

  private restoreUrls(data: any, urlPaths: string[], content: string): any {
    if (urlPaths.length === 0) return data;

    // Extract URLs from content
    const urlMatches = content.match(/\d+: (https?:\/\/[^\s]+)/g) || [];
    const urlMap = new Map<number, string>();
    
    urlMatches.forEach(match => {
      const [index, url] = match.split(': ');
      urlMap.set(parseInt(index), url);
    });

    // Deep clone and restore URLs
    const result = JSON.parse(JSON.stringify(data));
    
    for (const path of urlPaths) {
      const value = this.getValueByPath(result, path);
      if (typeof value === 'number' && urlMap.has(value)) {
        this.setValueByPath(result, path, urlMap.get(value)!);
      }
    }

    return result;
  }

  private getValueByPath(obj: any, path: string): any {
    const parts = path.split(/[.\[\]]/).filter(Boolean);
    let current = obj;
    
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = current[part];
    }
    
    return current;
  }

  private setValueByPath(obj: any, path: string, value: any): void {
    const parts = path.split(/[.\[\]]/).filter(Boolean);
    let current = obj;
    
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!current[part]) current[part] = {};
      current = current[part];
    }
    
    current[parts[parts.length - 1]] = value;
  }
}