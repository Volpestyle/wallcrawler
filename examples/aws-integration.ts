import { WallCrawler } from '@wallcrawler/core';
import { AWSInfrastructureProvider } from '@wallcrawler/aws';
import { z } from 'zod';

async function example() {
  // Initialize with AWS provider for cloud execution
  const provider = new AWSInfrastructureProvider({
    region: 'us-east-1',
    artifactsBucket: 'my-wallcrawler-artifacts',
    interventionFunctionName: 'wallcrawler-intervention-handler',
  });

  const crawler = new WallCrawler({
    provider,
    llm: {
      provider: 'bedrock',
      model: 'anthropic.claude-3-sonnet-20240229-v1:0',
    },
    browser: {
      headless: true,
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
  });

  try {
    // Create a browser page - provider handles AWS integration transparently
    const page = await crawler.createPage();
    
    // Navigate to a website
    await page.goto('https://example.com');
    
    // Use AI-powered actions
    await page.act('Click on the login button');
    
    // Check if intervention is required
    const loginFormElements = await page.observe('login form fields');
    
    if (loginFormElements.some(el => el.description.includes('captcha'))) {
      console.log('CAPTCHA detected - intervention will be handled automatically');
      // AWS provider handles notification and portal automatically
      // Execution pauses until intervention is complete
    }
    
    // Extract structured data
    const productData = await page.extract({
      instruction: 'Extract product information',
      schema: z.object({
        name: z.string(),
        price: z.number(),
        description: z.string(),
        availability: z.boolean(),
      }),
    });
    
    console.log('Extracted data:', productData);
    
    // Save checkpoint for later resume
    const checkpoint = await crawler.getSessionManager().saveCheckpoint(page);
    console.log('Checkpoint saved:', checkpoint);
    
    // Access cached results
    const cache = crawler.getCache();
    const cacheKey = cache.generateKey({
      url: await page.url(),
      action: 'extract',
      instruction: 'Extract product information',
    });
    
    const cachedResult = await cache.get(cacheKey);
    if (cachedResult) {
      console.log('Found cached result:', cachedResult);
    }
    
    // Clean up
    await page.close();
    
  } catch (error) {
    console.error('Automation failed:', error);
  }
}

// Lambda handler example
export async function lambdaHandler(event: any, context: any) {
  // In Lambda, the provider would be initialized once and reused
  return example();
}

// Local development example
if (require.main === module) {
  example().catch(console.error);
}