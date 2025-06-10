# WallCrawler 🕷️

AI-Powered Browser Automation Framework with Vercel AI SDK & Playwright

## Overview

WallCrawler is a next-generation browser automation framework that seamlessly combines deterministic Playwright automation with natural language processing capabilities through a unified LLM interface. Built on Vercel's AI SDK, it provides developers with flexible automation options supporting multiple AI providers including OpenAI, Anthropic, AWS Bedrock, and local Ollama models.

## Features

- 🤖 **Multi-Provider LLM Support**: OpenAI, Anthropic, AWS Bedrock, Ollama, and more
- 🎭 **Enhanced Playwright Integration**: ES6 Proxy-based page wrapper maintaining full API compatibility
- 🔍 **Intelligent Element Selection**: Multi-strategy element discovery with accessibility tree analysis
- 🌐 **Advanced Network Monitoring**: CDP-based network settlement detection
- 💾 **Smart Caching**: Reduce LLM costs with intelligent response caching
- 🔄 **Self-Healing Automation**: Automatic retry with alternative selectors
- 📊 **Structured Data Extraction**: Type-safe extraction with Zod schemas
- 🚀 **AWS Lambda Support**: Checkpoint/resume for long-running automations

## Installation

```bash
npm install wallcrawler
# or
yarn add wallcrawler
# or
pnpm add wallcrawler
```

## Quick Start

```typescript
import { WallCrawler, z } from 'wallcrawler';

// Initialize WallCrawler
const crawler = new WallCrawler({
  llm: {
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: process.env.OPENAI_API_KEY, // Optional, uses env by default
  },
  browser: {
    headless: false,
  },
});

// Launch browser and create page
await crawler.launch();
const page = await crawler.newPage();

// Navigate and interact using natural language
await page.goto('https://example.com');
await page.act('Click the login button');
await page.act('Fill in the email field with user@example.com');

// Extract structured data
const ProductSchema = z.object({
  name: z.string(),
  price: z.number(),
  inStock: z.boolean(),
  imageUrl: z.string().url(),
});

const product = await page.extract({
  instruction: 'Extract the product details from this page',
  schema: ProductSchema,
});

// Observe page elements
const elements = await page.observe('Find all clickable elements in the navigation menu');

// Clean up
await crawler.close();
```

## Configuration

```typescript
const crawler = new WallCrawler({
  // Environment mode
  mode: 'LOCAL', // or 'AWS' for Lambda execution

  // LLM Configuration
  llm: {
    provider: 'anthropic', // 'openai', 'bedrock', 'ollama', etc.
    model: 'claude-3-opus-20240229',
    apiKey: process.env.ANTHROPIC_API_KEY,
    maxRetries: 3,
    timeout: 30000,
  },

  // Browser Configuration
  browser: {
    headless: true,
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Custom User Agent',
    locale: 'en-US',
    timezone: 'America/New_York',
    timeout: 30000,
  },

  // Advanced Features
  features: {
    selfHeal: true,
    captchaHandling: false,
    requestInterception: true,
    caching: {
      enabled: true,
      ttl: 300, // 5 minutes
      maxSize: 1000,
    },
  },

  // AWS Configuration (optional)
  aws: {
    region: 'us-east-1',
    sessionTable: 'wallcrawler-sessions',
    artifactBucket: 'wallcrawler-artifacts',
    checkpointInterval: 60000, // 1 minute
  },
});
```

## API Reference

### Core Methods

#### `page.act(instruction: string, options?: ActOptions)`
Execute an action based on natural language instruction.

```typescript
await page.act('Click the submit button', {
  maxAttempts: 3,
  settlementStrategy: 'patient',
  screenshot: true,
  validateSuccess: async (page) => {
    // Custom validation logic
    return page.url().includes('/success');
  },
});
```

#### `page.extract<T>(options: ExtractOptions<T>)`
Extract structured data from the page.

```typescript
const data = await page.extract({
  instruction: 'Extract all product listings',
  schema: z.array(ProductSchema),
  mode: 'hybrid', // 'text', 'visual', or 'hybrid'
  includeMetadata: true,
});
```

#### `page.observe(instruction?: string)`
Get information about interactive elements on the page.

```typescript
const elements = await page.observe('Find form input fields');
// Returns: Array of ObserveResult with selector, description, role, etc.
```

### Environment Variables

WallCrawler automatically loads API keys from environment variables:

- `OPENAI_API_KEY` - OpenAI API key
- `ANTHROPIC_API_KEY` - Anthropic API key
- `AWS_ACCESS_KEY_ID` & `AWS_SECRET_ACCESS_KEY` - AWS credentials for Bedrock
- `OLLAMA_BASE_URL` - Ollama server URL (default: http://localhost:11434)

## Advanced Usage

### Custom LLM Provider

```typescript
const crawler = new WallCrawler({
  llm: {
    provider: 'openai',
    model: 'gpt-4-turbo-preview',
    baseURL: 'https://custom-proxy.com/v1', // Custom endpoint
    apiKey: 'your-api-key',
  },
});
```

### AWS Lambda Execution

```typescript
const crawler = new WallCrawler({
  mode: 'AWS',
  aws: {
    region: 'us-east-1',
    sessionTable: 'automation-sessions',
    artifactBucket: 'automation-artifacts',
  },
});

// Create checkpoints for long-running tasks
await page.checkpoint();

// Restore from checkpoint
await page.restore(checkpointId);
```

### Debug Tools

```typescript
// Export DOM for debugging
await page.debugDom('./debug/page-dom.json');

// Get performance metrics
const metrics = await page.getMetrics();
console.log(`DOM Nodes: ${metrics.domNodes}`);
console.log(`JS Heap: ${metrics.jsHeapUsed / 1024 / 1024}MB`);
```

## Error Handling

WallCrawler provides typed errors for better error handling:

```typescript
import { 
  ElementNotFoundError, 
  LLMError, 
  TimeoutError 
} from 'wallcrawler';

try {
  await page.act('Click the button');
} catch (error) {
  if (error instanceof ElementNotFoundError) {
    console.log('Button not found:', error.selector);
  } else if (error instanceof LLMError) {
    console.log('LLM error:', error.provider, error.statusCode);
  } else if (error instanceof TimeoutError) {
    console.log('Operation timed out:', error.operation);
  }
}
```

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

## License

MIT License - see [LICENSE](LICENSE) for details.