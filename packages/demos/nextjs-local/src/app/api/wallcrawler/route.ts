import { NextRequest, NextResponse } from 'next/server';
import { WallCrawler } from 'wallcrawler';
import { LocalProvider } from '@wallcrawler/local';
import { z } from 'zod';
import { randomUUID } from 'crypto';

// Use global sessions map
declare global {
  var wallcrawlerSessions: Map<
    string,
    {
      status: 'running' | 'success' | 'error';
      message?: string;
      progress?: number;
      result?: any;
    }
  >;
}

// Initialize global sessions if not exists
if (!global.wallcrawlerSessions) {
  global.wallcrawlerSessions = new Map();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, command, schema, model = 'openai', scenario } = body;

    // Validate input
    if (!url || !command) {
      return NextResponse.json(
        { error: 'URL and command are required' },
        { status: 400 }
      );
    }

    const sessionId = randomUUID();
    global.wallcrawlerSessions.set(sessionId, {
      status: 'running',
      message: 'Initializing...',
    });

    // Process in background
    processAutomation(sessionId, { url, command, schema, model, scenario });

    return NextResponse.json({ sessionId });
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json(
      { error: 'Failed to start automation' },
      { status: 500 }
    );
  }
}

async function processAutomation(
  sessionId: string,
  params: {
    url: string;
    command: string;
    schema?: string;
    model: string;
    scenario: string;
  }
) {
  const session = global.wallcrawlerSessions.get(sessionId)!;

  try {
    // Update status
    session.message = 'Creating browser instance...';
    session.progress = 10;

    // Create local provider
    const provider = new LocalProvider({ storageDir: '.wallcrawler/demo' });

    // Create configuration object without provider
    const config = {
      llm: {
        provider: params.model as 'openai' | 'anthropic' | 'ollama',
        apiKey: process.env[`${params.model.toUpperCase()}_API_KEY`],
        model:
          params.model === 'openai'
            ? 'gpt-4-turbo'
            : params.model === 'anthropic'
              ? 'claude-3-5-sonnet-latest'
              : 'llama2',
        timeout: 30000,
        maxRetries: 3,
      },
      browser: {
        headless: false,
        viewport: { width: 1280, height: 720 },
        timeout: 30000,
      },
      features: {
        selfHeal: true,
        captchaHandling: false,
        requestInterception: false,
        caching: {
          enabled: true,
          ttl: 3600, // 1 hour
          maxSize: 1000, // max cache entries
        },
      },
    };

    // Initialize WallCrawler with provider and config separately
    const crawler = new WallCrawler(provider, config);

    session.message = 'Creating page...';
    session.progress = 30;

    const page = await crawler.createPage();

    session.message = 'Navigating to target URL...';
    session.progress = 50;

    await page.goto(params.url);

    // Parse schema if provided
    let extractionSchema;
    if (params.schema) {
      try {
        // Create a function that returns the schema
        const schemaFunction = new Function('z', `return ${params.schema}`);
        extractionSchema = schemaFunction(z);
      } catch (error) {
        console.error('Schema parsing error:', error);
        // Continue without schema validation
      }
    }

    session.message = 'Executing automation...';
    session.progress = 70;

    // Execute the command
    let result;
    if (extractionSchema) {
      result = await page.extract({
        instruction: params.command,
        schema: extractionSchema,
      });
    } else {
      result = await page.act(params.command);
    }

    // Take screenshot
    const screenshotPath = await page.screenshot({
      path: `.wallcrawler/demo/screenshots/${sessionId}.png`,
    });

    session.message = 'Saving artifacts...';
    session.progress = 90;

    // Clean up
    await crawler.destroySession(page.sessionId);

    // Update session with results
    session.status = 'success';
    session.message = 'Task completed successfully';
    session.progress = 100;
    session.result = {
      success: true,
      data: result,
      screenshots: [
        `/api/wallcrawler/artifacts?type=screenshot&id=${sessionId}`,
      ],
      logs: ['Automation completed successfully'], // Simplified logging for now
    };
  } catch (error) {
    console.error('Automation error:', error);
    session.status = 'error';
    session.message = error instanceof Error ? error.message : 'Unknown error';
    session.result = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
