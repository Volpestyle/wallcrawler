import { NextResponse } from 'next/server';

async function fetchOpenAIPricing() {
  try {
    // Scrape OpenAI pricing page for real-time data
    const response = await fetch('https://openai.com/api/pricing', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PricingBot/1.0)'
      }
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch OpenAI pricing page');
    }
    
    // In a real implementation, you'd parse the HTML to extract pricing
    // For now, we'll return null to indicate pricing unavailable
    return null;
  } catch (error) {
    console.warn('Failed to fetch OpenAI pricing:', error);
    return null;
  }
}

async function fetchAnthropicPricing() {
  try {
    // Scrape Anthropic pricing page
    const response = await fetch('https://www.anthropic.com/pricing', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PricingBot/1.0)'
      }
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch Anthropic pricing page');
    }
    
    // Parse HTML for pricing data
    return null;
  } catch (error) {
    console.warn('Failed to fetch Anthropic pricing:', error);
    return null;
  }
}

async function fetchGeminiPricing() {
  try {
    // Google Cloud Pricing API (requires authentication)
    // For public demo, we'll skip this
    return null;
  } catch (error) {
    console.warn('Failed to fetch Gemini pricing:', error);
    return null;
  }
}

export async function GET() {
  try {
    // Fetch pricing from all providers in parallel
    const [openaiPricing, anthropicPricing, geminiPricing] = await Promise.all([
      fetchOpenAIPricing(),
      fetchAnthropicPricing(),
      fetchGeminiPricing()
    ]);

    const pricing: Record<string, any> = {
      lastFetched: new Date().toISOString(),
      note: 'Real-time pricing unavailable. Most providers do not offer public pricing APIs.',
      available: false
    };

    // Only include providers where we successfully fetched pricing
    if (openaiPricing) pricing.openai = openaiPricing;
    if (anthropicPricing) pricing.anthropic = anthropicPricing;
    if (geminiPricing) pricing.gemini = geminiPricing;
    
    // Ollama is always free
    pricing.ollama = { input: 0, output: 0, note: 'Local models are free' };

    return NextResponse.json(pricing, {
      headers: {
        'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
      }
    });

  } catch (error) {
    console.error('Error fetching pricing:', error);
    
    return NextResponse.json({
      lastFetched: new Date().toISOString(),
      note: 'Pricing data unavailable. Check provider websites for current rates.',
      error: 'Failed to fetch pricing data',
      available: false,
      ollama: { input: 0, output: 0, note: 'Local models are free' }
    }, {
      status: 503,
      headers: {
        'Cache-Control': 'public, max-age=300' // Cache for 5 minutes on error
      }
    });
  }
}