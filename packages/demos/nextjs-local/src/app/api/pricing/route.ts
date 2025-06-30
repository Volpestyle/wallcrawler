import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

interface ModelInfo {
  id: string;
  name: string;
  alias?: string;
  displayName: string;
  provider: string;
  pricing?: {
    input: number;
    output: number;
  };
  inputTypes?: string[];
  outputTypes?: string[];
  optimizedFor?: string;
}

// Create JWT for Google Cloud authentication
async function createJWT(serviceAccountKey: string, projectId: string): Promise<string> {
  const serviceAccount = JSON.parse(serviceAccountKey);
  const now = Math.floor(Date.now() / 1000);

  const payload = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-billing.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600, // 1 hour expiration
  };

  // For Node.js, we need to use the crypto module to sign the JWT
  const crypto = await import('crypto');

  const header = Buffer.from(
    JSON.stringify({
      alg: 'RS256',
      typ: 'JWT',
      kid: serviceAccount.private_key_id,
    })
  ).toString('base64url');

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signInput = `${header}.${payloadB64}`;

  const signature = crypto
    .sign('RSA-SHA256', Buffer.from(signInput), {
      key: serviceAccount.private_key,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    })
    .toString('base64url');

  return `${signInput}.${signature}`;
}

// Parse Gemini pricing from Google Cloud API response
function parseGeminiPricing(
  pricingData: any,
  scrapedGeminiModels: ModelInfo[]
): Record<string, { input: number; output: number }> | null {
  try {
    const geminiPricing: Record<string, { input: number; output: number }> = {};
    console.log('pricing data ', pricingData);

    if (pricingData.skus && Array.isArray(pricingData.skus)) {
      for (const sku of pricingData.skus) {
        const description = sku.description || '';

        // Look for Gemini models specifically
        if (description.toLowerCase().includes('gemini')) {
          // Parse pricing info if available
          if (sku.pricingInfo && sku.pricingInfo.length > 0) {
            const pricingInfo = sku.pricingInfo[0];
            if (pricingInfo.pricingExpression && pricingInfo.pricingExpression.tieredRates) {
              const pricingExpression = pricingInfo.pricingExpression;
              const tieredRates = pricingExpression.tieredRates;

              if (tieredRates[0] && tieredRates[0].unitPrice) {
                const unitPriceData = tieredRates[0].unitPrice;
                const units = parseFloat(unitPriceData.units || '0');
                const nanos = parseFloat(unitPriceData.nanos || '0');
                const unitPrice = units + nanos / 1e9;

                // Get the display quantity to understand the scale
                const displayQuantity = pricingExpression.displayQuantity || 1;

                // Calculate price per million tokens
                let pricePerMillionTokens;
                if (displayQuantity === 1000000) {
                  pricePerMillionTokens = unitPrice; // Already per 1M tokens
                } else if (displayQuantity === 1000) {
                  pricePerMillionTokens = unitPrice * 1000; // Convert from per 1K to per 1M
                } else {
                  pricePerMillionTokens = (unitPrice / displayQuantity) * 1000000;
                }

                // Only process text input/output (skip caching, tuning, etc.)
                if (
                  description.toLowerCase().includes('text') &&
                  (description.toLowerCase().includes('input') || description.toLowerCase().includes('output'))
                ) {
                  // Find best matching scraped model using simple string similarity
                  let bestMatch: ModelInfo | null = null;
                  let bestScore = 0;
                  const descriptionLower = description.toLowerCase();

                  for (const scrapedModel of scrapedGeminiModels) {
                    // Check against model name parts (e.g., "gemini-2.5-pro" -> ["gemini", "2.5", "pro"])
                    const nameParts = scrapedModel.name
                      .toLowerCase()
                      .split('-')
                      .filter((part) => part.length > 0);
                    const nameMatches = nameParts.filter((part) => descriptionLower.includes(part)).length;

                    // Check against display name parts (e.g., "Gemini 2.5 Pro" -> ["gemini", "2.5", "pro"])
                    const displayParts = scrapedModel.displayName
                      .toLowerCase()
                      .split(' ')
                      .filter((part) => part.length > 0);
                    const displayMatches = displayParts.filter((part) => descriptionLower.includes(part)).length;

                    // Calculate match score (higher is better)
                    const score = nameMatches + displayMatches;

                    // Must have at least 2 matching parts to be considered valid
                    if (score >= 2 && score > bestScore) {
                      bestMatch = scrapedModel;
                      bestScore = score;
                    }
                  }

                  const modelName = bestMatch?.name || '';

                  // Determine if it's input or output tokens
                  let tokenType = '';
                  if (description.toLowerCase().includes('input')) {
                    tokenType = 'input';
                  } else if (description.toLowerCase().includes('output')) {
                    tokenType = 'output';
                  }

                  if (modelName && tokenType) {
                    if (!geminiPricing[modelName]) {
                      geminiPricing[modelName] = { input: 0, output: 0 };
                    }
                    geminiPricing[modelName][tokenType as 'input' | 'output'] = pricePerMillionTokens;
                  }
                }
              }
            }
          }
        }
      }
    }

    return Object.keys(geminiPricing).length > 0 ? geminiPricing : null;
  } catch (error) {
    console.warn('Error parsing Gemini pricing:', error);
    return null;
  }
}

// Fetch Google Cloud/Gemini pricing via API
async function fetchGeminiPricing() {
  try {
    console.log('Fetching Google Cloud/Gemini pricing...');

    const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
    const serviceAccountKeyPath = process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY;

    if (!projectId || !serviceAccountKeyPath) {
      console.warn('Google Cloud credentials not configured, skipping Gemini pricing');
      return null;
    }

    // Load service account key
    let serviceAccountKey: string;
    try {
      if (serviceAccountKeyPath.endsWith('.json')) {
        const keyPath = path.isAbsolute(serviceAccountKeyPath)
          ? serviceAccountKeyPath
          : path.join(process.cwd(), serviceAccountKeyPath);

        if (!fs.existsSync(keyPath)) {
          console.warn(`Service account key file not found: ${keyPath}`);
          return null;
        }
        serviceAccountKey = fs.readFileSync(keyPath, 'utf8');
      } else {
        serviceAccountKey = serviceAccountKeyPath;
      }
    } catch (error: any) {
      console.warn('Failed to load service account key:', error.message);
      return null;
    }

    // Get OAuth token first
    const authResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: await createJWT(serviceAccountKey, projectId),
      }),
    });

    if (!authResponse.ok) {
      const errorText = await authResponse.text();
      console.error('Failed to authenticate with Google Cloud:', errorText);
      throw new Error(`Failed to authenticate with Google Cloud: ${authResponse.status}`);
    }

    const { access_token } = await authResponse.json();

    // Use Cloud AI Platform service ID for Vertex AI
    const cloudAiServiceId = 'services/C7E2-9256-1C43';

    // Get SKUs for the Cloud AI Platform service using v1 API
    const pricingApiUrl = `https://cloudbilling.googleapis.com/v1/${cloudAiServiceId}/skus?pageSize=5000&currencyCode=USD`;

    const pricingResponse = await fetch(pricingApiUrl, {
      headers: {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!pricingResponse.ok) {
      const errorText = await pricingResponse.text();
      console.error(`Google Cloud API Error (${pricingResponse.status}):`, errorText);
      throw new Error(`Failed to fetch pricing SKUs: ${pricingResponse.status} - ${errorText}`);
    }

    const pricingData = await pricingResponse.json();

    // We need access to scraped models to match against API descriptions
    // This will be passed from the main function
    return pricingData;
  } catch (error) {
    console.warn('Failed to fetch Gemini pricing:', error);
    return null;
  }
}

export async function GET() {
  try {
    console.log('Loading scraped model data...');

    // Try to load scraped model data
    const dataPath = path.join(process.cwd(), 'public', 'models-data.json');

    if (!fs.existsSync(dataPath)) {
      console.warn('⚠️  Scraped model data not found. Run `pnpm scrape-models` to generate it.');

      return NextResponse.json(
        {
          lastFetched: new Date().toISOString(),
          available: false,
          note: 'Model data not found. Run `pnpm scrape-models` to generate fresh data from provider docs.',
          error: 'No scraped data available',
          models: [],
          sources: [],
          modelsCount: { openai: 0, anthropic: 0, gemini: 0, ollama: 0 },
        },
        {
          status: 503,
          headers: {
            'Cache-Control': 'public, max-age=60', // Short cache for missing data
          },
        }
      );
    }

    // Load the scraped data
    const scrapedData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

    console.log(`✅ Loaded ${scrapedData.models?.length || 0} models from scraped data`);

    // Fetch and merge Gemini pricing data
    const geminiPricingData = await fetchGeminiPricing();

    // Extract scraped Gemini models for matching
    const scrapedGeminiModels: ModelInfo[] = (scrapedData.models || []).filter(
      (model: any) => model.provider === 'gemini'
    );

    // Parse the pricing data using the scraped models
    const geminiPricing = geminiPricingData ? parseGeminiPricing(geminiPricingData, scrapedGeminiModels) : null;

    if (geminiPricing) {
      console.log(`✅ Matched Gemini pricing for ${Object.keys(geminiPricing).length} models using scraped model data`);
      console.log(
        `🔍 Scraped Gemini models available for matching: ${scrapedGeminiModels.map((m: any) => m.name).join(', ')}`
      );
    } else if (geminiPricingData) {
      console.warn('⚠️ No Gemini pricing matches found between API response and scraped models');
    }

    // Check API key status for each provider
    const apiKeyStatus = {
      openai: process.env.OPENAI_API_KEY ? 'configured' : 'missing',
      anthropic: process.env.ANTHROPIC_API_KEY ? 'configured' : 'missing',
      gemini: process.env.GEMINI_API_KEY ? 'configured' : 'missing',
      ollama: 'configured', // Ollama is local, no API key needed
    };

    // Filter for text generation models only (suitable for browser automation)
    const isTextGenerationModel = (model: any): boolean => {
      // For non-Gemini providers, assume all models are text generation
      if (model.provider !== 'gemini') {
        return true;
      }

      // For Gemini models, check output types
      if (model.outputTypes && Array.isArray(model.outputTypes)) {
        const outputTypes = model.outputTypes.map((type: string) => type.toLowerCase());
        
        // Must include text output and NOT be primarily for other media
        const hasTextOutput = outputTypes.some(type => type.includes('text'));
        const isImageGeneration = outputTypes.some(type => type.includes('image')) && !hasTextOutput;
        const isVideoGeneration = outputTypes.some(type => type.includes('video')) && !hasTextOutput;
        const isAudioGeneration = outputTypes.some(type => type.includes('audio')) && !hasTextOutput;
        const isEmbedding = outputTypes.some(type => type.includes('embedding'));
        
        return hasTextOutput && !isImageGeneration && !isVideoGeneration && !isAudioGeneration && !isEmbedding;
      }

      // If no output types specified, include by default (better to be inclusive)
      return true;
    };

    // Add API key status and merge Gemini pricing
    const modelsWithApiStatus = (scrapedData.models || [])
      .filter(isTextGenerationModel) // Filter for text generation models only
      .map((model: any) => {
        let updatedModel = {
          ...model,
          apiKeyStatus: apiKeyStatus[model.provider as keyof typeof apiKeyStatus] || 'missing',
        };

        // If this is a Gemini model and we have pricing data, merge it
        if (model.provider === 'gemini' && geminiPricing) {
          const pricingKey = Object.keys(geminiPricing).find((key) => model.name.includes(key));
          if (pricingKey) {
            updatedModel.pricing = geminiPricing[pricingKey];
            console.log(
              `🔄 Updated pricing for ${model.name}: $${updatedModel.pricing.input}/$${updatedModel.pricing.output}`
            );
          }
        }

        return updatedModel;
      });

    // Build response in expected format
    const response: any = {
      lastFetched: scrapedData.lastUpdated,
      available: true,
      sources: scrapedData.sources || [],
      models: modelsWithApiStatus,
      apiKeyStatus,
      note: `Real model data scraped from provider documentation at ${scrapedData.lastUpdated}`,
      modelsCount: scrapedData.metadata || {},
    };

    // Group by provider for backward compatibility
    const providerGroups = modelsWithApiStatus.reduce((acc: any, model: any) => {
      if (!acc[model.provider]) {
        acc[model.provider] = {};
      }
      // Use the base model name (without provider prefix) as key
      const modelKey = model.name.includes('/') ? model.name.split('/')[1] : model.name;
      acc[model.provider][modelKey] = model.pricing;
      return acc;
    }, {});

    // Add provider-specific pricing data for backward compatibility
    Object.entries(providerGroups).forEach(([provider, models]) => {
      response[provider] = models;
    });

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
      },
    });
  } catch (error) {
    console.error('Critical error loading scraped model data:', error);

    return NextResponse.json(
      {
        lastFetched: new Date().toISOString(),
        available: false,
        note: 'Critical error occurred while loading scraped model data',
        error: error instanceof Error ? error.message : 'Unknown error',
        models: [],
        sources: [],
        modelsCount: { openai: 0, anthropic: 0, gemini: 0, ollama: 0 },
      },
      {
        status: 500,
        headers: {
          'Cache-Control': 'public, max-age=60', // Cache for 1 minute on error
        },
      }
    );
  }
}
