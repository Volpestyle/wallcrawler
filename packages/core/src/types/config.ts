export type ModelProvider = 
  | 'openai'
  | 'anthropic'
  | 'bedrock'
  | 'ollama'
  | 'google'
  | 'azure'
  | 'groq'
  | 'mistral'
  | 'perplexity'
  | 'togetherai'
  | 'xai'
  | 'deepseek'
  | 'cerebras';

export interface WallCrawlerConfig {
  // LLM Configuration
  llm: {
    provider: ModelProvider;
    model: string;
    apiKey?: string; // Loaded from env if not provided
    baseURL?: string; // Custom endpoints
    timeout?: number;
    maxRetries?: number;
  };

  // Browser Configuration
  browser: {
    headless: boolean;
    viewport: { width: number; height: number };
    userAgent?: string;
    locale?: string;
    timezone?: string;
    timeout: number; // Default: 30000ms
  };

  // Advanced Features
  features: {
    selfHeal: boolean;
    captchaHandling: boolean;
    requestInterception: boolean;
    caching: {
      enabled: boolean;
      ttl: number; // seconds
      maxSize: number; // entries
    };
  };
}