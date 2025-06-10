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
  // Environment
  mode: 'LOCAL' | 'AWS';

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

  // AWS-specific
  aws?: {
    region: string;
    sessionTable: string;
    artifactBucket: string;
    checkpointInterval: number; // ms
  };
}

// Default configuration
export const defaultConfig: WallCrawlerConfig = {
  mode: 'LOCAL',
  llm: {
    provider: 'openai',
    model: 'gpt-4o',
    timeout: 30000,
    maxRetries: 3,
  },
  browser: {
    headless: false,
    viewport: { width: 1280, height: 720 },
    timeout: 30000,
  },
  features: {
    selfHeal: true,
    captchaHandling: false,
    requestInterception: true,
    caching: {
      enabled: true,
      ttl: 300, // 5 minutes
      maxSize: 1000,
    },
  },
};