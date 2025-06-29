import { ProviderPricing, ModelPricing } from './types';

/**
 * Simple character-based fuzzy match for model names
 * Returns the best matching pricing info or null if no match found
 */
export function fuzzyMatchModelToPricing(
  modelName: string,
  providerPricing: Record<string, ProviderPricing>
): { provider: string; model: string; pricing: ModelPricing } | null {
  if (!modelName) return null;

  const normalizedModelName = modelName.toLowerCase();
  let bestMatch: { provider: string; model: string; pricing: ModelPricing; score: number } | null = null;

  // Search through all providers and models
  for (const [provider, models] of Object.entries(providerPricing)) {
    if (provider === 'lastFetched' || provider === 'note' || provider === 'available') {
      continue; // Skip metadata fields
    }

    if (typeof models !== 'object' || models === null) continue;

    for (const [model, pricing] of Object.entries(models)) {
      if (typeof pricing !== 'object' || !pricing || !('input' in pricing) || !('output' in pricing)) {
        continue;
      }

      const normalizedPricingModel = model.toLowerCase();

      // Simple character-based scoring
      let score = 0;
      const modelChars = normalizedModelName.split('');
      const pricingChars = normalizedPricingModel.split('');

      // Count matching characters in order
      let matchCount = 0;
      let pricingIndex = 0;

      for (const char of modelChars) {
        const foundIndex = pricingChars.indexOf(char, pricingIndex);
        if (foundIndex !== -1) {
          matchCount++;
          pricingIndex = foundIndex + 1;
        }
      }

      // Score based on character match percentage
      score = (matchCount / Math.max(modelChars.length, pricingChars.length)) * 100;

      // Keep the best match
      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = {
          provider,
          model,
          pricing: pricing as ModelPricing,
          score,
        };
      }
    }
  }

  // Return best match if score is reasonable
  if (bestMatch && bestMatch.score >= 30) {
    return {
      provider: bestMatch.provider,
      model: bestMatch.model,
      pricing: bestMatch.pricing,
    };
  }

  return null;
}

/**
 * Calculate cost for a step using fuzzy matched pricing
 */
export function calculateStepCostWithFuzzyMatch(
  tokens: { prompt_tokens: number; completion_tokens: number },
  modelName: string,
  providerPricing: Record<string, ProviderPricing>
): { cost: number; matchedModel?: string } {
  // For Ollama models, always return 0 (free)
  if (modelName.includes('ollama') || modelName.startsWith('ollama/')) {
    return { cost: 0 };
  }

  // Try fuzzy matching
  const match = fuzzyMatchModelToPricing(modelName, providerPricing);

  if (!match) {
    console.warn(`No pricing data found for model: ${modelName}`);
    return { cost: 0 };
  }

  const inputCost = (tokens.prompt_tokens / 1_000_000) * match.pricing.input;
  const outputCost = (tokens.completion_tokens / 1_000_000) * match.pricing.output;

  return {
    cost: inputCost + outputCost,
    matchedModel: `${match.provider}/${match.model}`,
  };
}
