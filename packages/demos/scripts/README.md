# Stagehand Automation Scripts

This directory contains standalone Stagehand scripts for various automation tasks. These scripts demonstrate how to build automation tools using Stagehand outside of web applications.

## Setup

```bash
# Install dependencies for scripts
cd packages/demos/scripts
pnpm install
```

## Usage

### Scrape Model Data

```bash
# From the scripts directory
pnpm scrape-models
```

This script will:
1. **Visit OpenAI pricing page** - Extract model names and pricing from https://platform.openai.com/docs/pricing
2. **Visit Anthropic docs** - Get model names from https://docs.anthropic.com/en/docs/about-claude/models/overview and pricing from https://www.anthropic.com/pricing  
3. **Visit Gemini docs** - Extract model information from https://ai.google.dev/gemini-api/docs/models
4. **Add Ollama models** - Include common local models like Llama, Qwen, Mistral, etc.
5. **Save to JSON** - Write all data to `../nextjs-local/public/models-data.json` for the demo to use

The scraping uses Stagehand's `extract()` method with structured schemas to ensure we get:
- **Exact API model names** (like `claude-3-5-sonnet-20241022`, `gemini-2.5-flash-preview-04-17`)
- **Current pricing** (input/output costs per 1M tokens)
- **Display names** and metadata

## Output Format

The generated `public/models-data.json` contains:

```json
{
  "lastUpdated": "2025-01-30T12:00:00.000Z",
  "sources": [
    "https://platform.openai.com/docs/pricing",
    "https://docs.anthropic.com/en/docs/about-claude/models/overview",
    "https://ai.google.dev/gemini-api/docs/models"
  ],
  "models": [
    {
      "id": "openai/gpt-4o",
      "name": "gpt-4o",
      "displayName": "GPT-4o",
      "provider": "openai", 
      "pricing": { "input": 5, "output": 15 },
      "type": "cloud"
    }
  ],
  "metadata": {
    "openai": { "count": 8, "source": "..." },
    "anthropic": { "count": 6, "source": "..." },
    "gemini": { "count": 5, "source": "..." },
    "ollama": { "count": 8, "source": "..." }
  }
}
```

## Why This Approach?

- **Accuracy**: Gets real model names directly from provider docs, not approximations
- **Currency**: Always has latest pricing and model availability 
- **Reliability**: No web scraping brittleness - uses AI extraction with schemas
- **Auditability**: Can see exactly what sources were used and when
- **Performance**: Static JSON file loads instantly vs. real-time scraping

## Updating Model Data

Run the scraper periodically to keep model information current:

```bash
# Weekly update recommended
pnpm scrape-models
```

The demo will automatically use the updated data on next API call.