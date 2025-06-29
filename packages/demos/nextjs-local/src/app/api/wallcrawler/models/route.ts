import { NextResponse } from 'next/server';
import { validateModelConfig } from '../../../../../stagehand.config';

// Available model providers
const MODEL_PROVIDERS = {
  openai: {
    displayName: 'OpenAI GPT-4o'
  },
  anthropic: {
    displayName: 'Anthropic Claude-3.5-Sonnet'
  },
  gemini: {
    displayName: 'Google Gemini-1.5-Pro'
  },
  ollama: {
    displayName: 'Ollama (Local)'
  }
};

export async function GET() {
  try {
    const availableModels = [];
    
    // Check each model provider
    for (const [provider, config] of Object.entries(MODEL_PROVIDERS)) {
      try {
        validateModelConfig(provider);
        availableModels.push({
          provider,
          ...config,
          available: true
        });
      } catch (error) {
        // Model not configured, skip it
        continue;
      }
    }

    return NextResponse.json({
      models: availableModels
    });

  } catch (error) {
    console.error('Error checking model availability:', error);
    return NextResponse.json(
      { error: 'Failed to check model availability' },
      { status: 500 }
    );
  }
}