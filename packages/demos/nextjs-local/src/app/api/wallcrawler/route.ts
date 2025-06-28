import { NextRequest, NextResponse } from 'next/server';
import { Stagehand } from '@wallcrawler/stagehand';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import StagehandConfig, {
  validateModelConfig,
} from '../../../../stagehand.config';

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
    const {
      url,
      command,
      schema,
      model = 'openai',
      scenario,
      isAgent = false,
      agentOptions,
    } = body;

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
    processAutomation(sessionId, {
      url,
      command,
      schema,
      model,
      scenario,
      isAgent,
      agentOptions,
    });

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
    isAgent?: boolean;
    agentOptions?: any;
  }
) {
  const session = global.wallcrawlerSessions.get(sessionId)!;

  try {
    // Update status
    session.message = 'Validating configuration...';
    session.progress = 10;

    // Validate model configuration - no defaults, must be properly configured
    const { modelName, apiKey } = validateModelConfig(params.model);

    session.message = 'Creating browser instance...';
    session.progress = 20;

    // Initialize Stagehand using our config
    const stagehand = new Stagehand({
      ...StagehandConfig,
      modelName,
      modelClientOptions: {
        apiKey,
      },
    });

    session.message = 'Initializing browser...';
    session.progress = 30;

    await stagehand.init();

    session.message = 'Navigating to target URL...';
    session.progress = 50;

    await stagehand.page.goto(params.url);

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
    if (params.isAgent) {
      // Validate agent provider
      if (!['openai', 'anthropic'].includes(params.model)) {
        throw new Error(
          `Agent provider '${params.model}' not supported. Use 'openai' or 'anthropic'`
        );
      }

      // Execute as agent task - Stagehand agent expects specific config structure
      const agent = stagehand.agent({
        provider: params.model as 'openai' | 'anthropic',
        model: modelName,
        instructions:
          params.agentOptions?.instructions ||
          `You are a helpful assistant that can use a web browser. 
          You are currently on the page: ${stagehand.page.url()}. 
          Do not ask follow up questions, the user will trust your judgement.`,
        options: {
          apiKey,
          ...params.agentOptions?.options,
        },
      });
      result = await agent.execute(params.command);
    } else if (extractionSchema) {
      result = await stagehand.page.extract({
        instruction: params.command,
        schema: extractionSchema,
      });
    } else {
      result = await stagehand.page.act(params.command);
    }

    // Take screenshot
    session.message = 'Taking screenshot...';
    session.progress = 90;

    const screenshotPath = await stagehand.page.screenshot({
      path: `.wallcrawler/demo/screenshots/${sessionId}.png`,
    });

    // Clean up
    await stagehand.close();

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
      logs: ['Automation completed successfully'],
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
