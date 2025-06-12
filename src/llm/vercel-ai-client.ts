import { generateObject, generateText, Message } from "ai";
import { z } from "zod";
import { LLMClient, LLMProviderConfig } from "../types/llm";
import { ModelProvider } from "../types/config";
import { createLogger } from "../utils/logger";
import { LLMError } from "../types/errors";
import { randomUUID } from "crypto";

import type { LanguageModelV1 } from "ai";

interface ModelConfig {
  apiKey?: string;
  baseURL?: string;
  region?: string;
}

interface ModelWrapper extends LanguageModelV1 {
  provider: ModelProvider;
  config: ModelConfig;
}

interface MessageContent {
  type: "text" | "image";
  text?: string;
  image?: string;
}

// Import providers conditionally
let openai: any, anthropic: any, bedrock: any, ollama: any;

try {
  const openaiModule = require("@ai-sdk/openai");
  openai = openaiModule.openai;
} catch {}

try {
  const anthropicModule = require("@ai-sdk/anthropic");
  anthropic = anthropicModule.anthropic;
} catch {}

try {
  const bedrockModule = require("@ai-sdk/amazon-bedrock");
  bedrock = bedrockModule.bedrock;
} catch {}

try {
  const ollamaModule = require("ollama-ai-provider");
  ollama = ollamaModule.ollama;
} catch {}

const logger = createLogger("llm");

export class VercelAIClient implements LLMClient {
  private model: ModelWrapper;
  private provider: ModelProvider;

  constructor(private config: LLMProviderConfig & { provider: ModelProvider }) {
    this.provider = config.provider;
    this.model = this.createModel();
  }

  private createModel(): ModelWrapper {
    const { provider, model, apiKey, baseURL } = this.config;

    switch (provider) {
      case "openai":
        if (!openai) {
          throw new Error(
            "OpenAI provider not installed. Run: npm install @ai-sdk/openai"
          );
        }
        return openai(model, { apiKey, baseURL });

      case "anthropic":
        if (!anthropic) {
          throw new Error(
            "Anthropic provider not installed. Run: npm install @ai-sdk/anthropic"
          );
        }
        return anthropic(model, { apiKey, baseURL });

      case "bedrock":
        if (!bedrock) {
          throw new Error(
            "Bedrock provider not installed. Run: npm install @ai-sdk/amazon-bedrock"
          );
        }
        // Bedrock uses AWS credentials, not API key
        return bedrock(model, {
          region: process.env.AWS_REGION || "us-east-1",
        });

      case "ollama":
        if (!ollama) {
          throw new Error(
            "Ollama provider not installed. Run: npm install ollama-ai-provider"
          );
        }
        return ollama(model, { baseURL: baseURL || "http://localhost:11434" });

      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  async generateObject<T>(options: {
    prompt: string;
    schema: z.ZodSchema<T>;
    images?: (string | Buffer | Uint8Array)[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<T> {
    try {
      logger.debug("Generating object", {
        provider: this.provider,
        model: this.config.model,
        schemaShape: Object.keys((options.schema as any)._def.shape || {}),
      });

      const messages = this.buildMessages(options.prompt, options.images);

      const result = await generateObject({
        model: this.model,
        messages,
        schema: options.schema,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
      });

      logger.info("Object generated successfully", {
        provider: this.provider,
        model: this.config.model,
      });

      return result.object;
    } catch (error: any) {
      logger.error("Failed to generate object", error);

      throw new LLMError(
        `Failed to generate object: ${error.message}`,
        this.provider,
        error.status || error.statusCode,
        error
      );
    }
  }

  async generateText(options: {
    prompt: string;
    system?: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<string> {
    try {
      logger.debug("Generating text", {
        provider: this.provider,
        model: this.config.model,
      });

      const messages: Message[] = [];

      if (options.system) {
        messages.push({
          id: randomUUID(),
          role: "system" as const,
          content: options.system,
        });
      }

      messages.push({
        id: randomUUID(),
        role: "user" as const,
        content: options.prompt,
      });

      const result = await generateText({
        model: this.model,
        messages,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
      });

      logger.info("Text generated successfully", {
        provider: this.provider,
        model: this.config.model,
        length: result.text.length,
      });

      return result.text;
    } catch (error: any) {
      logger.error("Failed to generate text", error);

      throw new LLMError(
        `Failed to generate text: ${error.message}`,
        this.provider,
        error.status || error.statusCode,
        error
      );
    }
  }

  private buildMessages(
    prompt: string,
    images?: (string | Buffer | Uint8Array)[]
  ): Message[] {
    const content: MessageContent[] = [{ type: "text", text: prompt }];

    if (images && images.length > 0) {
      for (const image of images) {
        let imageStr: string;

        if (typeof image === "string") {
          imageStr = image;
        } else if (Buffer.isBuffer(image)) {
          imageStr = image.toString("base64");
        } else if (image instanceof Uint8Array) {
          imageStr = Buffer.from(image).toString("base64");
        } else {
          // This case should never happen due to type constraints
          imageStr = String(image);
        }

        content.push({
          type: "image",
          image: imageStr.startsWith("data:")
            ? imageStr
            : `data:image/png;base64,${imageStr}`,
        });
      }
    }

    return [
      {
        id: randomUUID(),
        role: "user" as const,
        content: content as any,
      },
    ];
  }
}
