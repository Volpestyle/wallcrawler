import { WallCrawler } from '@wallcrawler/core';
import { LocalProvider } from '@wallcrawler/core/providers/local-provider';
import { z } from 'zod';

async function example() {
  // Create WallCrawler config
  const config = {
    provider: null as any, // Will be set below
    llm: {
      provider: 'openai' as const,
      model: 'gpt-4o',
      apiKey: process.env.OPENAI_API_KEY,
    },
    browser: {
      headless: false, // Show browser in local development
      viewport: { width: 1280, height: 720 },
      timeout: 30000,
    },
    features: {
      selfHeal: true,
      captchaHandling: true,
      requestInterception: true,
      caching: {
        enabled: true,
        ttl: 300,
        maxSize: 1000,
      },
    },
  };

  // Create local provider with config
  const provider = new LocalProvider(config);
  config.provider = provider;

  const crawler = new WallCrawler(config);

  try {
    // Create a browser page
    const page = await crawler.createPage();
    
    // Navigate to a website
    await page.goto('https://example.com');
    
    // Use AI-powered actions
    await page.act('Click on the "More information" link');
    
    // Observe page elements
    const elements = await page.observe('main navigation links');
    console.log('Found elements:', elements);
    
    // Extract structured data
    const pageInfo = await page.extract({
      instruction: 'Extract the main heading and description',
      schema: z.object({
        title: z.string(),
        description: z.string(),
      }),
    });
    
    console.log('Extracted data:', pageInfo);
    
    // Save checkpoint
    const checkpoint = await crawler.getSessionManager().saveCheckpoint(page);
    console.log('Checkpoint saved:', checkpoint);
    
    // Take screenshot
    const screenshot = await page.screenshot();
    const screenshotRef = await provider.saveArtifact({
      type: 'screenshot',
      data: screenshot,
      metadata: { sessionId: page.sessionId },
    });
    console.log('Screenshot saved:', screenshotRef.key);
    
    // Test cache
    const cache = crawler.getCache();
    const cacheKey = cache.generateKey({
      url: await page.url(),
      action: 'extract',
      instruction: 'Extract the main heading and description',
    });
    
    await cache.set(cacheKey, pageInfo, 300);
    const cachedResult = await cache.get(cacheKey);
    console.log('Cached result:', cachedResult);
    
    // Clean up
    await crawler.destroySession(page.sessionId);
    
  } catch (error) {
    console.error('Automation failed:', error);
  }
}

// Run the example
if (require.main === module) {
  example().catch(console.error);
}