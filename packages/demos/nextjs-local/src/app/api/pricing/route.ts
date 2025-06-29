import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';

// Known pricing data as fallback (updated as of Jan 2025)
const FALLBACK_PRICING = {
  openai: {
    'gpt-4o': { input: 5.0, output: 15.0 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
    'gpt-4-turbo': { input: 10.0, output: 30.0 },
    'gpt-3.5-turbo': { input: 3.0, output: 6.0 },
  },
  anthropic: {
    'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
    'claude-3-5-haiku-20241022': { input: 1.0, output: 5.0 },
    'claude-3-opus-20240229': { input: 15.0, output: 75.0 },
  },
  gemini: {
    'gemini-2.0-flash-exp': { input: 0.075, output: 0.3 },
    'gemini-1.5-pro': { input: 3.5, output: 10.5 },
    'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  },
};

async function fetchGoogleCloudPricing() {
  try {
    // Google Cloud Pricing API for Vertex AI
    const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
    const serviceAccountKeyPath = process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY;

    if (!projectId || !serviceAccountKeyPath) {
      console.warn('Google Cloud credentials not configured, no pricing data available');
      return null;
    }

    // Load service account key from file or parse as JSON string
    let serviceAccountKey: string;
    try {
      if (serviceAccountKeyPath.endsWith('.json')) {
        // It's a file path - read the file
        const keyPath = path.isAbsolute(serviceAccountKeyPath)
          ? serviceAccountKeyPath
          : path.join(process.cwd(), serviceAccountKeyPath);

        if (!fs.existsSync(keyPath)) {
          console.warn(`Service account key file not found: ${keyPath}`);
          return null;
        }

        serviceAccountKey = fs.readFileSync(keyPath, 'utf8');
      } else {
        // It's a JSON string
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

    // Use v2beta public pricing API to get SKUs (first try without filter)
    const pricingApiUrl = 'https://cloudbilling.googleapis.com/v2beta/skus?pageSize=10';

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

    // Parse the pricing data for Gemini models
    const geminiPricing = parseGeminiPricing(pricingData);

    return geminiPricing || null;
  } catch (error) {
    console.warn('Failed to fetch Google Cloud pricing:', error);
    return null;
  }
}

async function createJWT(serviceAccountKey: string, projectId: string): Promise<string> {
  try {
    // Parse the service account key
    const serviceAccount = JSON.parse(serviceAccountKey);

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-billing.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600, // 1 hour expiration
    };

    // Create and sign the JWT
    const token = jwt.sign(payload, serviceAccount.private_key, {
      algorithm: 'RS256',
      keyid: serviceAccount.private_key_id,
    });

    return token;
  } catch (error: any) {
    throw new Error(`Failed to create JWT: ${error.message}`);
  }
}

function parseGeminiPricing(pricingData: any) {
  try {
    const geminiPricing: Record<string, { input: number; output: number }> = {};

    if (pricingData.skus && Array.isArray(pricingData.skus)) {
      for (const sku of pricingData.skus) {
        const displayName = sku.displayName || '';
        const description = sku.description || '';

        // Look for Vertex AI Gemini pricing SKUs
        if (displayName.includes('Vertex AI') && (displayName.includes('Gemini') || description.includes('Gemini'))) {
          // Extract model name and type (input/output tokens)
          let modelName = '';
          let isInputTokens = false;
          let isOutputTokens = false;

          if (displayName.includes('Gemini 1.5 Pro')) {
            modelName = 'gemini-1.5-pro';
          } else if (displayName.includes('Gemini 1.5 Flash')) {
            modelName = 'gemini-1.5-flash';
          } else if (displayName.includes('Gemini 2.0 Flash')) {
            modelName = 'gemini-2.0-flash-exp';
          }

          isInputTokens = displayName.includes('Input') || description.includes('input');
          isOutputTokens = displayName.includes('Output') || description.includes('output');

          if (modelName && (isInputTokens || isOutputTokens) && sku.pricingInfo) {
            const pricingInfo = sku.pricingInfo[0];
            if (pricingInfo && pricingInfo.pricingExpression) {
              const tieredRates = pricingInfo.pricingExpression.tieredRates;
              if (tieredRates && tieredRates[0]) {
                // Convert from pricing per unit to per 1M tokens
                const unitPrice = parseFloat(tieredRates[0].unitPrice.nanos) / 1e9;
                const pricePerMillionTokens = unitPrice * 1000000;

                if (!geminiPricing[modelName]) {
                  geminiPricing[modelName] = { input: 0, output: 0 };
                }

                if (isInputTokens) {
                  geminiPricing[modelName].input = pricePerMillionTokens;
                } else if (isOutputTokens) {
                  geminiPricing[modelName].output = pricePerMillionTokens;
                }
              }
            }
          }
        }
      }
    }

    // Return parsed pricing if we found any, otherwise fallback
    return Object.keys(geminiPricing).length > 0 ? geminiPricing : FALLBACK_PRICING.gemini;
  } catch (error) {
    console.warn('Error parsing Gemini pricing:', error);
    return FALLBACK_PRICING.gemini;
  }
}

async function fetchOpenAIPricing() {
  try {
    // OpenAI doesn't have a public pricing API, so no real-time pricing available
    return null;
  } catch (error) {
    console.warn('Failed to fetch OpenAI pricing:', error);
    return null;
  }
}

async function fetchAnthropicPricing() {
  try {
    // Anthropic doesn't have a public pricing API, so no real-time pricing available
    return null;
  } catch (error) {
    console.warn('Failed to fetch Anthropic pricing:', error);
    return null;
  }
}

export async function GET() {
  try {
    // Fetch pricing from all providers in parallel
    const [openaiPricing, anthropicPricing, geminiPricing] = await Promise.all([
      fetchOpenAIPricing(),
      fetchAnthropicPricing(),
      fetchGoogleCloudPricing(),
    ]);

    // Check if we have any real pricing data
    const hasRealPricingData = openaiPricing || anthropicPricing || geminiPricing;

    // Always include Ollama pricing since local models are always available
    const pricing: Record<string, any> = {
      lastFetched: new Date().toISOString(),
      available: true, // Always available since we at least have Ollama
      ollama: { input: 0, output: 0, note: 'Local models are free' },
    };

    if (!hasRealPricingData) {
      // No real-time cloud pricing data available, but Ollama is still available
      pricing.note = 'Local pricing available. Configure Google Cloud credentials for real-time Gemini pricing.';
      pricing.reason = 'No API credentials configured for cloud provider pricing';

      return NextResponse.json(pricing, {
        status: 200,
        headers: {
          'Cache-Control': 'public, max-age=300', // Cache for 5 minutes when unavailable
        },
      });
    }

    // Update note and add real-time cloud pricing data
    pricing.note = 'Real-time pricing data fetched from provider APIs. Rates are per 1M tokens.';

    // Only include providers where we have real pricing data
    if (openaiPricing) pricing.openai = openaiPricing;
    if (anthropicPricing) pricing.anthropic = anthropicPricing;
    if (geminiPricing) pricing.gemini = geminiPricing;

    return NextResponse.json(pricing, {
      headers: {
        'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
      },
    });
  } catch (error) {
    console.error('Error fetching pricing:', error);

    return NextResponse.json(
      {
        lastFetched: new Date().toISOString(),
        note: 'Pricing data unavailable due to API error.',
        error: 'Failed to fetch real-time pricing',
        available: false,
        ollama: { input: 0, output: 0, note: 'Local models are free' },
      },
      {
        status: 503,
        headers: {
          'Cache-Control': 'public, max-age=60', // Cache for 1 minute on error
        },
      }
    );
  }
}
