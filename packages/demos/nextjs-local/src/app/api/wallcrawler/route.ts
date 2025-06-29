import { NextRequest, NextResponse } from 'next/server';
import { Stagehand } from '@wallcrawler/stagehand';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import StagehandConfig, { validateModelConfig, createLocalProvider } from '../../../../stagehand.config';

// Global provider instance
declare global {
  var wallcrawlerProvider: any;
}

// Initialize global provider if not exists (force refresh for new methods)
if (!global.wallcrawlerProvider || typeof global.wallcrawlerProvider.setSessionState !== 'function') {
  global.wallcrawlerProvider = createLocalProvider();
}

// Cleanup old unused instances (run every 5 minutes)
const INSTANCE_TIMEOUT = 5 * 60 * 1000; // 5 minutes
setInterval(() => {
  if (global.wallcrawlerProvider && typeof global.wallcrawlerProvider.cleanupSessionState === 'function') {
    global.wallcrawlerProvider.cleanupSessionState(INSTANCE_TIMEOUT);
  }
}, INSTANCE_TIMEOUT);

// Logging functionality
const ENABLE_FILE_LOGGING = process.env.WALLCRAWLER_LOG_TO_FILE === 'true';
const LOG_DIR = join(process.cwd(), 'logs');

function initLogDir() {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

function logToFile(message: string, sessionId?: string) {
  if (!ENABLE_FILE_LOGGING) return;

  initLogDir();
  const timestamp = new Date().toISOString();
  const sessionPrefix = sessionId ? `[${sessionId}] ` : '';
  const logMessage = `${timestamp} ${sessionPrefix}${message}\n`;

  // Log to both general log and session-specific log if sessionId provided
  const generalLogFile = join(LOG_DIR, 'wallcrawler.log');
  appendFileSync(generalLogFile, logMessage);

  if (sessionId) {
    const sessionLogFile = join(LOG_DIR, `session-${sessionId}.log`);
    appendFileSync(sessionLogFile, logMessage);
  }
}

// Enhanced console.log that also logs to file
function enhancedLog(message: string, sessionId?: string) {
  console.log(message);
  logToFile(message, sessionId);
}

export async function POST(request: NextRequest) {
  let currentSessionId: string | undefined;

  try {
    const body = await request.json();
    const { type, config, sessionId, model = 'openai', includeUsage = false } = body;

    currentSessionId = sessionId;
    enhancedLog(
      `[DEBUG] API Request - Type: ${type}, SessionId: ${sessionId || 'null'}, HasConfig: ${!!config}, Model: ${model}`,
      sessionId
    );

    // Validate input
    if (!type || !config) {
      return NextResponse.json({ error: 'Type and config are required' }, { status: 400 });
    }
    let stagehand: Stagehand;

    // Get or create Stagehand instance for session management
    const provider = global.wallcrawlerProvider;

    if (sessionId && provider.hasSessionState(sessionId)) {
      // Reuse existing Stagehand instance
      enhancedLog(`[DEBUG] Reusing existing Stagehand instance for session: ${sessionId}`, sessionId);
      const instanceData = provider.getSessionState(sessionId)!;
      stagehand = instanceData.stagehand;
      currentSessionId = sessionId;

      // Debug the instance data structure
      enhancedLog(
        `[DEBUG] Instance data: ${JSON.stringify({
          hasCurrentModel: 'currentModel' in instanceData,
          currentModel: instanceData.currentModel,
          requestModel: model,
        })}`,
        sessionId
      );

      // Only update model if a different one is provided
      if (model && model !== instanceData.currentModel) {
        enhancedLog(`[DEBUG] Updating model from ${instanceData.currentModel} to ${model}`, sessionId);
        const modelConfig = validateModelConfig(model);
        const modelClientOptions: any = {};
        if (modelConfig.apiKey) {
          modelClientOptions.apiKey = modelConfig.apiKey;
        }
        if (modelConfig.baseURL) {
          modelClientOptions.baseURL = modelConfig.baseURL;
        }

        // Update the LLM client
        stagehand.llmClient = stagehand.llmProvider.getClient(modelConfig.modelName, modelClientOptions);
        provider.updateSessionModel(sessionId, model);
        enhancedLog(`[DEBUG] Updated LLM client for model: ${modelConfig.modelName}`, sessionId);
      } else {
        enhancedLog(`[DEBUG] Keeping existing model: ${instanceData.currentModel}`, sessionId);
        // Ensure LLM client is still configured even if model hasn't changed
        if (!stagehand.llmClient) {
          enhancedLog(`[DEBUG] LLM client missing, reconfiguring for model: ${instanceData.currentModel}`, sessionId);
          const modelConfig = validateModelConfig(instanceData.currentModel!);
          const modelClientOptions: any = {};
          if (modelConfig.apiKey) {
            modelClientOptions.apiKey = modelConfig.apiKey;
          }
          if (modelConfig.baseURL) {
            modelClientOptions.baseURL = modelConfig.baseURL;
          }
          stagehand.llmClient = stagehand.llmProvider.getClient(modelConfig.modelName, modelClientOptions);
          enhancedLog(`[DEBUG] Reconfigured LLM client for model: ${modelConfig.modelName}`, sessionId);
        }
      }

      // Verify the instance is still connected
      try {
        const currentUrl = stagehand.page.url();
        enhancedLog(`[DEBUG] Session browser current URL: ${currentUrl}`, sessionId);
      } catch (error) {
        enhancedLog(`[DEBUG] Session browser disconnected, creating new instance: ${error}`, sessionId);
        // Remove corrupted instance and create new one
        try {
          await stagehand.close();
        } catch (closeError) {
          enhancedLog(`[DEBUG] Error closing corrupted instance: ${closeError}`, sessionId);
        }
        provider.removeSessionState(sessionId);
        throw new Error('Session corrupted, please retry');
      }
    } else {
      // Create new Stagehand instance
      currentSessionId = sessionId; // Use provided sessionId or let Stagehand create new one

      enhancedLog(`[DEBUG] Validating model config for: ${model}`, sessionId);
      const modelConfig = validateModelConfig(model);
      enhancedLog(`[DEBUG] Model config: ${JSON.stringify(modelConfig)}`, sessionId);

      const modelClientOptions: any = {};
      if (modelConfig.apiKey) {
        modelClientOptions.apiKey = modelConfig.apiKey;
      }
      if (modelConfig.baseURL) {
        modelClientOptions.baseURL = modelConfig.baseURL;
      }

      enhancedLog(`[DEBUG] Model client options: ${JSON.stringify(modelClientOptions)}`, sessionId);

      stagehand = new Stagehand({
        ...StagehandConfig,
        provider,
        sessionId: currentSessionId, // Pass sessionId to Stagehand (can be undefined for new session)
        modelName: modelConfig.modelName,
        modelClientOptions,
      });

      if (sessionId) {
        enhancedLog(`[DEBUG] Creating new Stagehand instance for existing session: ${sessionId}`, sessionId);
      } else {
        enhancedLog(`[DEBUG] Creating new Stagehand instance with new session...`, sessionId);
      }

      await stagehand.init();

      // Get the actual sessionId after init (in case Stagehand created a new one)
      currentSessionId = stagehand.sessionId;
      if (!currentSessionId) {
        throw new Error('Failed to get session ID from Stagehand after initialization');
      }
      enhancedLog(`[DEBUG] Stagehand initialized successfully with session: ${currentSessionId}`, currentSessionId);

      // Store the instance for reuse
      provider.setSessionState(currentSessionId, stagehand, model);
      enhancedLog(
        `[DEBUG] Stored Stagehand instance for session: ${currentSessionId} with model: ${model}`,
        currentSessionId
      );
    }

    // Execute the step
    const result = await executeWorkflowStep(stagehand, type, config, currentSessionId, includeUsage);

    // Extract usage data from result if requested
    let usage = undefined;
    if (includeUsage && result && typeof result === 'object' && result.usage) {
      usage = {
        prompt_tokens: result.usage.prompt_tokens || 0,
        completion_tokens: result.usage.completion_tokens || 0,
        total_tokens: result.usage.total_tokens || 0,
        inference_time_ms: result.usage.inference_time_ms || 0,
      };
    }

    enhancedLog(`[DEBUG] Extracted usage data: ${JSON.stringify(usage)}`, currentSessionId);

    const response: any = {
      sessionId: currentSessionId,
      result,
      success: true,
    };

    if (includeUsage) {
      response.usage = usage;
    }

    return NextResponse.json(response);
  } catch (error) {
    enhancedLog(`API error: ${error}`, currentSessionId);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to execute step',
        success: false,
      },
      { status: 500 }
    );
  }
}

async function executeWorkflowStep(
  stagehand: Stagehand,
  type: string,
  config: any,
  sessionId?: string,
  includeUsage: boolean = false
): Promise<any> {
  // Add debugging info about current page state
  enhancedLog(`[DEBUG] Executing step: ${type}`, sessionId);
  enhancedLog(`[DEBUG] Current URL: ${stagehand.page.url()}`, sessionId);

  switch (type) {
    case 'navigate':
      if (!config.url) {
        throw new Error('URL is required for navigate step');
      }
      enhancedLog(`[DEBUG] Navigating to: ${config.url}`, sessionId);
      await stagehand.page.goto(config.url);
      enhancedLog(`[DEBUG] Navigation complete, new URL: ${stagehand.page.url()}`, sessionId);
      return { success: true, url: config.url };

    case 'act':
      if (!config.instruction) {
        throw new Error('Instruction is required for act step');
      }
      enhancedLog(`[DEBUG] Acting with instruction: ${config.instruction}`, sessionId);

      // Check if page is still loaded
      const pageTitle = await stagehand.page.title();
      enhancedLog(`[DEBUG] Current page title: ${pageTitle}`, sessionId);

      const actResult = await stagehand.page.act(config.instruction);
      enhancedLog(`[DEBUG] Act result: ${JSON.stringify(actResult)}`, sessionId);
      return actResult;

    case 'observe':
      if (!config.instruction) {
        throw new Error('Instruction is required for observe step');
      }
      enhancedLog(`[DEBUG] Observing with instruction: ${config.instruction}`, sessionId);

      // Check if page is still loaded
      const pageTitle2 = await stagehand.page.title();
      enhancedLog(`[DEBUG] Current page title: ${pageTitle2}`, sessionId);

      const observeResult = await stagehand.page.observe(config.instruction);
      enhancedLog(`[DEBUG] Observe result: ${JSON.stringify(observeResult)}`, sessionId);

      // Type guard for observe result with elements
      function hasElementsProperty(result: unknown): result is { elements: unknown } {
        return result !== null && typeof result === 'object' && !Array.isArray(result) && 'elements' in result;
      }

      // Type guard for observe result with both elements and usage
      function hasUsageData(result: unknown): result is { elements: unknown; usage: unknown } {
        return hasElementsProperty(result) && 'usage' in result;
      }

      if (!includeUsage) {
        // If usage not requested, return just the elements/result
        if (hasElementsProperty(observeResult)) {
          return observeResult.elements;
        }
        return observeResult;
      }

      if (hasUsageData(observeResult)) {
        return {
          result: observeResult.elements,
          usage: observeResult.usage,
        };
      }

      // Fallback for old format (direct array) - no usage data available
      return {
        result: observeResult,
        usage: undefined,
      };

    case 'extract':
      if (!config.instruction) {
        throw new Error('Instruction is required for extract step');
      }

      enhancedLog(`[DEBUG] Extracting with instruction: ${config.instruction}`, sessionId);

      // Check if page is still loaded and has content
      const pageTitle3 = await stagehand.page.title();
      const pageContent = await stagehand.page.textContent('body');
      enhancedLog(`[DEBUG] Current page title: ${pageTitle3}`, sessionId);
      enhancedLog(`[DEBUG] Page has content: ${pageContent ? pageContent.length > 0 : false}`, sessionId);

      // If page seems empty, log but continue (Stagehand handles DOM settling)
      if (!pageTitle3 || pageTitle3.trim() === '' || !pageContent || pageContent.trim().length < 100) {
        enhancedLog(`[DEBUG] Page seems empty, but continuing (Stagehand will handle DOM settling)`, sessionId);
      }

      let extractOptions: any = {
        instruction: config.instruction,
      };

      // Parse schema if provided
      if (config.schema) {
        try {
          const schemaObj = JSON.parse(config.schema);
          const zodSchema = createZodSchemaFromObject(schemaObj);
          extractOptions.schema = zodSchema;
        } catch (error) {
          enhancedLog(`[DEBUG] Schema parsing failed, proceeding without schema: ${error}`, sessionId);
        }
      }

      const extractResult = await stagehand.page.extract(extractOptions);
      enhancedLog(`[DEBUG] Extract result: ${JSON.stringify(extractResult)}`, sessionId);
      return extractResult;

    case 'agent':
      if (!config.instruction) {
        throw new Error('Instruction is required for agent step');
      }

      // For now, use a simple agent approach
      const agent = stagehand.agent();
      const agentResult = await agent.execute(config.instruction);
      return agentResult;

    default:
      throw new Error(`Unknown step type: ${type}`);
  }
}

// Helper function to create Zod schema from JSON object
function createZodSchemaFromObject(obj: any): z.ZodSchema {
  if (typeof obj !== 'object' || obj === null) {
    return z.any();
  }

  const shape: { [key: string]: z.ZodSchema } = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      if (value === 'string') {
        shape[key] = z.string();
      } else if (value === 'number') {
        shape[key] = z.number();
      } else if (value === 'boolean') {
        shape[key] = z.boolean();
      } else {
        shape[key] = z.string();
      }
    } else if (Array.isArray(value) && value.length > 0) {
      shape[key] = z.array(createZodSchemaFromObject(value[0]));
    } else if (typeof value === 'object') {
      shape[key] = createZodSchemaFromObject(value);
    } else {
      shape[key] = z.any();
    }
  }

  return z.object(shape);
}

// GET endpoint for session status
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID is required' }, { status: 400 });
    }

    const instances = global.wallcrawlerInstances;

    // Check if we have an active Stagehand instance
    if (instances.has(sessionId)) {
      const instanceData = instances.get(sessionId)!;
      try {
        // Verify the instance is still connected
        const currentUrl = instanceData.stagehand.page.url();
        return NextResponse.json({
          sessionId: sessionId,
          status: 'active',
          provider: 'local',
          currentUrl,
          lastUsed: new Date(instanceData.lastUsed).toISOString(),
        });
      } catch (error) {
        // Instance is corrupted, remove it
        instances.delete(sessionId);
        return NextResponse.json({ error: 'Session found but browser connection lost' }, { status: 404 });
      }
    }

    // Fall back to checking provider session
    const provider = global.wallcrawlerProvider;
    try {
      const providerSession = await provider.resumeSession(sessionId);
      return NextResponse.json({
        sessionId: providerSession.sessionId,
        status: 'available', // Session exists but no active browser instance
        provider: providerSession.provider,
        metadata: providerSession.metadata,
      });
    } catch (error) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
  } catch (error) {
    enhancedLog(`GET API error: ${error}`);
    return NextResponse.json({ error: 'Failed to get session status' }, { status: 500 });
  }
}

// DELETE endpoint to cleanup session
export async function DELETE(request: NextRequest) {
  let sessionId: string | null = null;

  try {
    const { searchParams } = new URL(request.url);
    sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID is required' }, { status: 400 });
    }

    const provider = global.wallcrawlerProvider;

    // Clean up Stagehand instance if it exists
    if (provider.hasSessionState(sessionId)) {
      try {
        const instanceData = provider.getSessionState(sessionId)!;
        if (instanceData.stagehand) {
          await instanceData.stagehand.close();
          enhancedLog(`Stagehand instance closed for session: ${sessionId}`, sessionId);
        }
      } catch (error) {
        enhancedLog(`Error closing Stagehand instance: ${error}`, sessionId);
      }
      provider.removeSessionState(sessionId);
    }

    // Clean up provider session
    try {
      await provider.endSession(sessionId);
      enhancedLog(`Provider session ${sessionId} ended successfully`, sessionId);
    } catch (error) {
      enhancedLog(`Error ending provider session: ${error}`, sessionId);
      // Don't fail if session doesn't exist, just log it
    }

    return NextResponse.json({
      success: true,
      message: 'Session cleaned up',
    });
  } catch (error) {
    enhancedLog(`DELETE API error: ${error}`, sessionId || undefined);
    return NextResponse.json({ error: 'Failed to cleanup session' }, { status: 500 });
  }
}
