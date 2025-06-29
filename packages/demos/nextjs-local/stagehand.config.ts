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
 * Handles Ollama's different configuration requirements (no API key needed)
 */
export function validateModelConfig(modelProvider: string): {
  modelName: string;
  apiKey?: string;
  baseURL?: string;
} {
  // Ollama has different requirements than cloud providers
  if (modelProvider === 'ollama') {
    const baseURL = process.env.OLLAMA_BASE_URL;
    const modelName = process.env.OLLAMA_MODEL;

    if (!baseURL) {
      throw new Error(
        `Missing OLLAMA_BASE_URL environment variable. ` +
          `Please set your Ollama server URL (e.g., http://localhost:11434).`
      );
    }

    if (!modelName) {
      throw new Error(
        `Missing OLLAMA_MODEL environment variable. ` + `Please specify the model name (e.g., llama3, qwen, mistral).`
      );
    }

    return {
      modelName: `ollama/${modelName}`, // Proper format for AI SDK
      baseURL,
    };
  }

  // Cloud providers require API keys
  const apiKeyEnvVar = `${modelProvider.toUpperCase()}_API_KEY`;
  const modelEnvVar = `${modelProvider.toUpperCase()}_MODEL`;

  const apiKey = process.env[apiKeyEnvVar];
  const modelName = process.env[modelEnvVar];

  if (!apiKey) {
    throw new Error(`Missing ${apiKeyEnvVar} environment variable. ` + `Please set your ${modelProvider} API key.`);
  }

  if (!modelName) {
    throw new Error(
      `Missing ${modelEnvVar} environment variable. ` + `Please specify the model name for ${modelProvider}.`
    );
  }

  return { modelName, apiKey };
}

export default StagehandConfig;
