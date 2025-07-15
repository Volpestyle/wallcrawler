import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // Fetch pricing data which now includes comprehensive model list
    const pricingResponse = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/pricing`);

    if (!pricingResponse.ok) {
      throw new Error('Failed to fetch pricing data');
    }

    const pricingData = await pricingResponse.json();

    // Extract models from pricing response
    const models = pricingData.models || [];

    // Add API key status to all models and mark availability
    const availableModels = models.map((model: any) => {
      if (model.type === 'local') {
        // Local models (Ollama) are always available
        return {
          ...model,
          hasApiKey: true,
          apiKeyStatus: 'not_required',
        };
      }

      // Check if provider has API key configured
      // Handle special cases for provider API key names
      let apiKeyEnvVar: string;
      if (model.provider === 'gemini') {
        // Gemini uses either GEMINI_API_KEY or GOOGLE_API_KEY
        apiKeyEnvVar = 'GEMINI_API_KEY';
        // Also check for Google Cloud credentials
        const hasGoogleCloudKey =
          !!process.env.GOOGLE_CLOUD_PROJECT_ID && !!process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY;
        const hasGeminiKey = !!process.env[apiKeyEnvVar];
        const hasApiKey = hasGeminiKey || hasGoogleCloudKey;

        return {
          ...model,
          hasApiKey,
          apiKeyStatus: hasApiKey ? 'configured' : 'missing',
        };
      } else {
        apiKeyEnvVar = `${model.provider.toUpperCase()}_API_KEY`;
      }

      const hasApiKey = !!process.env[apiKeyEnvVar];

      return {
        ...model,
        hasApiKey,
        apiKeyStatus: hasApiKey ? 'configured' : 'missing',
      };
    });

    return NextResponse.json({
      models: availableModels,
      total: availableModels.length,
      lastUpdated: pricingData.lastFetched,
      sources: pricingData.sources,
    });
  } catch (error) {
    console.error('Error fetching models:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch model list',
        models: [],
        total: 0,
      },
      { status: 500 }
    );
  }
}
