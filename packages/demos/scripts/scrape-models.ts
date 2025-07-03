#!/usr/bin/env node

/**
 * Stagehand script to scrape real model data from official provider documentation
 * Generates accurate model information with exact API names and current pricing
 */

import { Stagehand } from '@wallcrawler/stagehand';
import { LocalProvider } from '../../infra/local/dist/index.js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables
dotenv.config({ path: '../nextjs-local/.env.local' });

// Create local provider for this script
function createLocalProvider() {
  return new LocalProvider({
    headless: false,
    artifactsPath: '.wallcrawler/scripts/artifacts',
    browserLaunchOptions: {
      viewport: {
        width: 1280,
        height: 720,
      },
      args: ['--disable-blink-features=AutomationControlled', '--disable-web-security', '--disable-dev-shm-usage'],
      bypassCSP: true,
      ignoreHTTPSErrors: true,
    },
  });
}

interface ModelInfo {
  id: string;
  name: string; // Exact API model name
  alias?: string;
  displayName: string;
  provider: string;
  pricing?: {
    input: number; // per 1M tokens
    output: number; // per 1M tokens
  };
  inputTypes?: string[];
  outputTypes?: string[];
  optimizedFor?: string;
}

interface ScrapedData {
  lastUpdated: string;
  sources: string[];
  models: ModelInfo[];
  metadata: {
    openai: { count: number; source: string };
    anthropic: { count: number; source: string };
    gemini: { count: number; source: string };
  };
}

async function scrapeOpenAI(stagehand: Stagehand): Promise<ModelInfo[]> {
  console.log('📊 Scraping OpenAI pricing page...');

  try {
    await stagehand.page.goto('https://platform.openai.com/docs/pricing');

    // Extract model data using direct extraction (faster than agents)
    const openaiData = await stagehand.page.extract({
      instruction:
        'Extract all model information from the table. Look for model name like gpt-4.1 (under it will be its full name like gpt-4.1-2025-04-14) and then the input and output price values in the same row',
      schema: z.object({
        models: z.array(
          z.object({
            displayName: z.string().describe('short name like gpt-4.1'),
            fullName: z.string().describe('full name like gpt-4.1-2025-04-14'),
            inputPrice: z.number().describe('input price like $2.00'),
            outputPrice: z.number().describe('output price like $8.00'),
          })
        ),
      }),
    });

    console.log(`✅ Found ${openaiData.models?.length || 0} OpenAI models`);

    return (openaiData.models || []).map((model) => ({
      id: `openai/${model.fullName}`,
      name: model.fullName,
      displayName: model.displayName,
      provider: 'openai',
      pricing: {
        input: model.inputPrice || 0,
        output: model.outputPrice || 0,
      },
    }));
  } catch (error) {
    console.error('❌ Failed to scrape OpenAI:', error);
    return [];
  }
}

async function scrapeAnthropic(stagehand: Stagehand): Promise<ModelInfo[]> {
  console.log('🤖 Scraping Anthropic models...');

  try {
    await stagehand.page.goto('https://www.anthropic.com/pricing#api');

    // Extract model data using direct extraction
    const anthropicPricingData = await stagehand.page.extract({
      instruction:
        'Extract all Claude model information from the pricing table. Look for models like Claude Opus 4 and their input and output pricing per 1M tokens.',
      schema: z.object({
        models: z.array(
          z.object({
            displayName: z.string().describe('display name like Claude Opus 4'),
            inputPrice: z.number().describe('input price per 1M tokens'),
            outputPrice: z.number().describe('output price per 1M tokens'),
          })
        ),
      }),
    });

    await stagehand.page.goto('https://docs.anthropic.com/en/docs/about-claude/models/overview');

    const anthropicModelData = await stagehand.page.extract({
      instruction:
        'Extract all Claude model information from the model names table. Look for model names like Claude Opus 4, API names like claude-opus-4-20250514.',
      schema: z.object({
        models: z.array(
          z.object({
            displayName: z.string().describe('display name like Claude Opus 4'),
            name: z.string().describe('full name like claude-opus-4-20250514'),
            alias: z.string().describe('alias name like claude-opus-4-latest'),
          })
        ),
      }),
    });

    // O(n) solution using Map for fast lookups
    // Create a Map of model data for O(1) lookups
    const modelDataMap = new Map(anthropicModelData.models.map((model) => [model.displayName, model]));

    const anthropicData: Partial<ModelInfo>[] = [];
    const processedDisplayNames = new Set();

    // Add all models with pricing data first
    anthropicPricingData.models.forEach((pricingModel) => {
      const modelData = modelDataMap.get(pricingModel.displayName);
      anthropicData.push({
        ...modelData,
        pricing: {
          input: pricingModel.inputPrice,
          output: pricingModel.outputPrice,
        },
      });
      processedDisplayNames.add(pricingModel.displayName);
    });

    // Add remaining models without pricing data
    anthropicModelData.models.forEach((modelData) => {
      if (!processedDisplayNames.has(modelData.displayName)) {
        anthropicData.push({
          displayName: modelData.displayName,
          name: modelData.name,
          alias: modelData.alias,
        });
      }
    });

    console.log(`✅ Found ${anthropicData.length || 0} Anthropic models`);

    return (anthropicData || [])
      .filter((model) => model.name && model.displayName)
      .map((model) => ({
        id: `anthropic/${model.name}`,
        name: model.name!,
        displayName: model.displayName!,
        provider: 'anthropic',
        pricing: model.pricing,
        type: 'cloud' as const,
      }));
  } catch (error) {
    console.error('❌ Failed to scrape Anthropic:', error);
    return [];
  }
}

async function scrapeGemini(stagehand: Stagehand): Promise<ModelInfo[]> {
  console.log('💎 Scraping Gemini models...');

  try {
    await stagehand.page.goto('https://ai.google.dev/gemini-api/docs/models');

    // Extract model data using direct extraction
    const geminiData = await stagehand.page.extract({
      instruction:
        'Extract all Gemini model variants info form the tables. Look for model display names like Gemini 2.5 Pro, next to full names like gemini-2.5-pro. Inputs types and outputs and optimized for descriptions in the same row',
      schema: z.object({
        models: z.array(
          z.object({
            name: z.string().describe('full name like gemini-2.5-pro'),
            displayName: z.string().describe('display name like Gemini 2.5 Pro'),
            inputTypes: z.array(z.string()).describe('all of the different types included (ex. text, audio, video)'),
            outputTypes: z.array(z.string()).describe('all of the different types included (ex. text, audio, video)'),
            optimizedFor: z.string().describe('ex. (Adaptive thinking, cost efficiency)'),
          })
        ),
      }),
    });

    console.log(`✅ Found ${geminiData.models?.length || 0} Gemini models`);
    return (geminiData.models || []).map((model) => ({
      id: `gemini/${model.name}`,
      name: model.name,
      displayName: model.displayName,
      provider: 'gemini',
      type: 'cloud' as const,
      inputTypes: model.inputTypes,
      outputTypes: model.outputTypes,
      optimizedFor: model.optimizedFor,
    }));
  } catch (error) {
    console.error('❌ Failed to scrape Gemini:', error);
    return [];
  }
}

async function main() {
  console.log('🚀 Starting model data scraping...');

  const provider = createLocalProvider();

  const stagehand = new Stagehand({
    provider,
    verbose: 2, // Maximum verbosity for full logging
    modelName: process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-04-17',
    modelClientOptions: {
      apiKey: process.env.GEMINI_API_KEY,
    },
  });

  try {
    await stagehand.init();

    // Scrape all providers sequentially to avoid rate limiting/bot detection
    console.log('📊 Starting sequential scraping...');
    const openaiModels = await scrapeOpenAI(stagehand);
    console.log('🤖 Moving to Anthropic...');
    const anthropicModels = await scrapeAnthropic(stagehand);
    console.log('💎 Moving to Gemini...');
    const geminiModels = await scrapeGemini(stagehand);

    // Combine all models
    const allModels = [...openaiModels, ...anthropicModels, ...geminiModels];

    const scrapedData: ScrapedData = {
      lastUpdated: new Date().toISOString(),
      sources: [
        'https://platform.openai.com/docs/pricing',
        'https://docs.anthropic.com/en/docs/about-claude/models/overview',
        'https://www.anthropic.com/pricing',
        'https://ai.google.dev/gemini-api/docs/models',
      ],
      models: allModels,
      metadata: {
        openai: { count: openaiModels.length, source: 'https://platform.openai.com/docs/pricing' },
        anthropic: {
          count: anthropicModels.length,
          source: 'https://docs.anthropic.com/en/docs/about-claude/models/overview',
        },
        gemini: { count: geminiModels.length, source: 'https://ai.google.dev/gemini-api/docs/models' },
      },
    };

    // Save to nextjs-local public directory so the API can serve it
    const outputPath = path.join(process.cwd(), '../nextjs-local/public', 'models-data.json');
    fs.writeFileSync(outputPath, JSON.stringify(scrapedData, null, 2));

    console.log('✅ Model data scraping complete!');
    console.log(`📁 Saved ${allModels.length} models to: ${outputPath}`);
    console.log('📊 Breakdown:');
    console.log(`  - OpenAI: ${openaiModels.length} models`);
    console.log(`  - Anthropic: ${anthropicModels.length} models`);
    console.log(`  - Gemini: ${geminiModels.length} models`);
  } catch (error) {
    console.error('❌ Error during scraping:', error);
    process.exit(1);
  } finally {
    await stagehand.close();
  }
}

// Run if called directly
if (process.argv[1] && process.argv[1].endsWith('scrape-models.ts')) {
  main().catch(console.error);
}

export { main as scrapeModels };
