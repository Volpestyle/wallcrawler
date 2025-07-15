import type { ConstructorParams } from '@wallcrawler/stagehand';
import { LocalProvider } from '@wallcrawler/infra/local';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Create local provider instance for demo
 */
export function createLocalProvider() {
  return new LocalProvider({
    headless: false,
    artifactsPath: '.wallcrawler/demo/artifacts',
    browserLaunchOptions: {
      viewport: {
        width: 1280,
        height: 720,
      },
      // Additional security and performance options
      args: ['--disable-blink-features=AutomationControlled', '--disable-web-security', '--disable-dev-shm-usage'],
      bypassCSP: true,
      ignoreHTTPSErrors: true,
    },
  });
}

/**
 * Stagehand configuration for local development
 * Uses the modern provider pattern instead of deprecated env
 */
const StagehandConfig: Omit<ConstructorParams, 'provider'> = {
  // Verbose logging for demo purposes
  verbose: 2,

  // DOM settle timeout
  domSettleTimeoutMs: 30_000,

  // Self-healing capabilities
  selfHeal: true,

  // Enable experimental features if needed
  experimental: false,
};

/**
 * Validate required environment variables for the given model
 * Handles both old provider format and new model ID format (provider/model)
 */
export function validateModelConfig(modelIdOrProvider: string): {
  modelName: string;
  apiKey?: string;
  baseURL?: string;
} {
  let provider: string;
  let specificModel: string | null = null;

  // Check if it's a new format model ID (provider/model)
  if (modelIdOrProvider.includes('/')) {
    const parts = modelIdOrProvider.split('/');
    provider = parts[0];
    specificModel = parts[1];
  } else {
    // Legacy format - just the provider name
    provider = modelIdOrProvider;
  }

  // Ollama has different requirements than cloud providers
  if (provider === 'ollama') {
    const baseURL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

    // Use specific model from ID if provided, otherwise fall back to env var
    const modelName = specificModel || process.env.OLLAMA_MODEL || 'llama3';

    return {
      modelName: `ollama/${modelName}`, // Proper format for AI SDK
      baseURL,
    };
  }

  // Cloud providers require API keys
  const apiKeyEnvVar = `${provider.toUpperCase()}_API_KEY`;
  const apiKey = process.env[apiKeyEnvVar];

  if (!apiKey) {
    throw new Error(`Missing ${apiKeyEnvVar} environment variable. ` + `Please set your ${provider} API key.`);
  }

  // Use specific model from ID if provided, otherwise fall back to env var
  let modelName: string;
  if (specificModel) {
    modelName = specificModel;
  } else {
    const modelEnvVar = `${provider.toUpperCase()}_MODEL`;
    const envModelName = process.env[modelEnvVar];

    if (!envModelName) {
      throw new Error(
        `Missing ${modelEnvVar} environment variable. ` + `Please specify the model name for ${provider}.`
      );
    }

    modelName = envModelName;
  }

  return { modelName, apiKey };
}

export default StagehandConfig;
