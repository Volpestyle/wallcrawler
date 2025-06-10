import { LLMClient, LLMProviderConfig } from '../types/llm';
import { ModelProvider } from '../types/config';
import { VercelAIClient } from './vercel-ai-client';
import { createLogger } from '../utils/logger';

const logger = createLogger('llm');

export class LLMClientFactory {
  static create(config: LLMProviderConfig & { provider: ModelProvider }): LLMClient {
    // For now, we'll use the Vercel AI SDK client for all providers
    // This can be extended to support legacy clients if needed
    
    logger.info('Creating LLM client', {
      provider: config.provider,
      model: config.model,
    });

    // Load API key from environment if not provided
    const apiKey = config.apiKey || this.getApiKeyFromEnv(config.provider);
    
    if (!apiKey && config.provider !== 'ollama') {
      throw new Error(
        `No API key found for provider ${config.provider}. ` +
        `Please set ${this.getEnvVarName(config.provider)} or provide apiKey in config.`
      );
    }

    return new VercelAIClient({
      ...config,
      apiKey,
    });
  }

  private static getApiKeyFromEnv(provider: ModelProvider): string | undefined {
    const envVarName = this.getEnvVarName(provider);
    return process.env[envVarName];
  }

  private static getEnvVarName(provider: ModelProvider): string {
    const envVarMap: Record<ModelProvider, string> = {
      openai: 'OPENAI_API_KEY',
      anthropic: 'ANTHROPIC_API_KEY',
      bedrock: 'AWS_ACCESS_KEY_ID', // Bedrock uses AWS credentials
      ollama: 'OLLAMA_BASE_URL', // Ollama doesn't need API key
      google: 'GOOGLE_GENERATIVE_AI_API_KEY',
      azure: 'AZURE_API_KEY',
      groq: 'GROQ_API_KEY',
      mistral: 'MISTRAL_API_KEY',
      perplexity: 'PERPLEXITY_API_KEY',
      togetherai: 'TOGETHER_API_KEY',
      xai: 'XAI_API_KEY',
      deepseek: 'DEEPSEEK_API_KEY',
      cerebras: 'CEREBRAS_API_KEY',
    };

    return envVarMap[provider] || `${provider.toUpperCase()}_API_KEY`;
  }
}