import { z } from 'zod';

export interface WallcrawlerConfig {
  apiKey?: string;
  model?: 'openai' | 'anthropic' | 'ollama';
  debug?: boolean;
}

export interface AutomationParams {
  url: string;
  command: string;
  schema?: z.ZodType<any>;
  config?: WallcrawlerConfig;
}

export interface AutomationResult {
  success: boolean;
  data?: any;
  error?: string;
  screenshots?: string[];
  logs?: string[];
}

export class WallcrawlerClient {
  private baseUrl: string;
  private defaultConfig: WallcrawlerConfig;

  constructor(baseUrl: string = '', defaultConfig: WallcrawlerConfig = {}) {
    this.baseUrl = baseUrl;
    this.defaultConfig = defaultConfig;
  }

  async runAutomation(params: AutomationParams): Promise<AutomationResult> {
    const { url, command, schema, config = {} } = params;
    const mergedConfig = { ...this.defaultConfig, ...config };

    try {
      // Start the automation
      const startResponse = await fetch(`${this.baseUrl}/api/wallcrawler`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          command,
          schema: schema ? this.serializeSchema(schema) : undefined,
          model: mergedConfig.model || 'openai',
          debug: mergedConfig.debug,
        }),
      });

      if (!startResponse.ok) {
        throw new Error(`Failed to start automation: ${startResponse.statusText}`);
      }

      const { sessionId } = await startResponse.json();

      // Poll for completion
      return await this.pollForResults(sessionId);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async pollForResults(sessionId: string): Promise<AutomationResult> {
    const maxAttempts = 300; // 5 minutes with 1 second intervals
    let attempts = 0;

    while (attempts < maxAttempts) {
      const statusResponse = await fetch(
        `${this.baseUrl}/api/wallcrawler/status?sessionId=${sessionId}`
      );

      if (!statusResponse.ok) {
        throw new Error('Failed to get status');
      }

      const status = await statusResponse.json();

      if (status.status === 'success' || status.status === 'error') {
        // Get final results
        const resultsResponse = await fetch(
          `${this.baseUrl}/api/wallcrawler/artifacts?sessionId=${sessionId}`
        );

        if (!resultsResponse.ok) {
          throw new Error('Failed to get results');
        }

        return await resultsResponse.json();
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

    throw new Error('Automation timed out');
  }

  private serializeSchema(schema: z.ZodType<any>): string {
    // Convert Zod schema to a string representation
    // This is a simplified version - in production, you'd want more robust serialization
    const schemaString = schema.toString();
    return schemaString;
  }

  async getArtifact(type: 'screenshot', id: string): Promise<Blob> {
    const response = await fetch(
      `${this.baseUrl}/api/wallcrawler/artifacts?type=${type}&id=${id}`
    );

    if (!response.ok) {
      throw new Error('Failed to get artifact');
    }

    return await response.blob();
  }
}