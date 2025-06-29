import { NextResponse } from 'next/server';
import { validateModelConfig } from '../../../../../stagehand.config';

// Available model providers
const MODEL_PROVIDERS = {
  openai: {
    displayName: 'OpenAI',
  },
  anthropic: {
    displayName: 'Anthropic',
  },
  gemini: {
    displayName: 'Gemini',
  },
  ollama: {
    displayName: 'Ollama',
  },
};

export async function GET() {
  try {
    const availableModels = [];

    // Check each model provider
    for (const [provider, config] of Object.entries(MODEL_PROVIDERS)) {
      try {
        const modelConfig = validateModelConfig(provider);
        availableModels.push({
          provider,
          ...config,
          modelName: modelConfig.modelName,
          available: true,
        });
      } catch (error) {
        // Model not configured, skip it
        continue;
      }
    }

    return NextResponse.json({
      models: availableModels,
    });
  } catch (error) {
    console.error('Error checking model availability:', error);
    return NextResponse.json({ error: 'Failed to check model availability' }, { status: 500 });
  }
}
