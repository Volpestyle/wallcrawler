import { z } from "zod";

export interface LLMClient {
  generateObject<T>(options: {
    prompt: string;
    schema: z.ZodSchema<T>;
    images?: (string | Buffer | Uint8Array)[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<T>;

  generateText(options: {
    prompt: string;
    system?: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<string>;
}

export interface LLMProvider {
  createClient(config: LLMProviderConfig): LLMClient;
}

export interface LLMProviderConfig {
  apiKey?: string;
  baseURL?: string;
  model: string;
  timeout?: number;
  maxRetries?: number;
}
