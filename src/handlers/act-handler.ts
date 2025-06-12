import { Page, CDPSession, Locator } from "playwright";
import {
  ActHandler as IActHandler,
  ActOptions,
  ActResult,
  ObserveResult,
  ObserveHandler,
} from "../types/handlers";
import { LLMClient } from "../types/llm";
import { WallCrawlerConfig } from "../types/config";
import {
  PlaywrightCommandException,
  PlaywrightCommandMethodNotSupportedException,
  WallCrawlerInvalidArgumentError,
} from "../types/errors";
import { createLogger } from "../utils/logger";
import { InterventionDetector } from "../core/intervention-detector";
import { ActionHistoryItem } from "../types/infrastructure";

const logger = createLogger("act");

export interface MethodHandlerContext {
  method: string;
  locator: Locator;
  xpath: string;
  args: unknown[];
  logger: (message: string, details?: any) => void;
  stagehandPage: any; // WallCrawlerPage
  initialUrl: string;
  domSettleTimeoutMs?: number;
}

// Supported Playwright actions
export enum SupportedPlaywrightAction {
  Click = "click",
  Fill = "fill",
  Type = "type",
  Press = "press",
  Select = "select",
  Check = "check",
  Uncheck = "uncheck",
  Hover = "hover",
  Clear = "clear",
  Focus = "focus",
  Blur = "blur",
  DblClick = "dblclick",
  Tap = "tap",
  ScrollIntoViewIfNeeded = "scrollIntoViewIfNeeded",
}

// Deep locator function for frame support
export function deepLocator(page: Page, xpath: string): Locator {
  // Remove xpath= prefix if present
  const cleanXpath = xpath.replace(/^xpath=/, "");

  // Split xpath by frame boundaries
  const parts = cleanXpath.split(/\/\/iframe\[/);

  if (parts.length === 1) {
    // No frames, simple xpath
    return page.locator(`xpath=${cleanXpath}`);
  }

  // Handle frames
  let currentLocator: Locator = page.locator("body");

  for (let i = 0; i < parts.length; i++) {
    if (i === 0) {
      // First part is the main document xpath
      if (parts[i]) {
        currentLocator = page.locator(`xpath=${parts[i]}`);
      }
    } else {
      // Frame parts
      const framePart = `//iframe[${parts[i]}`;
      const frameLocator = page.locator(`xpath=${framePart}`);
      const frame = frameLocator.contentFrame();

      // Get content inside frame
      if (i < parts.length - 1) {
        // More frames to traverse
        currentLocator = frameLocator;
      } else {
        // Last part, actual element
        const elementXpath = parts[i].split(/\]\s*\/\//)[1];
        if (elementXpath) {
          currentLocator = frameLocator.locator(`xpath=//${elementXpath}`);
        }
      }
    }
  }

  return currentLocator;
}

// Method handlers for specific actions
export const methodHandlerMap: Record<
  string,
  (context: MethodHandlerContext) => Promise<void>
> = {
  click: async (ctx) => {
    await ctx.locator.click();
  },

  fill: async (ctx) => {
    const value = String(ctx.args[0] ?? "");
    await ctx.locator.fill(value);
  },

  type: async (ctx) => {
    const text = String(ctx.args[0] ?? "");
    const options = ctx.args[1] as any;
    await ctx.locator.type(text, options);
  },

  press: async (ctx) => {
    const key = String(ctx.args[0] ?? "");
    await ctx.locator.press(key);
  },

  select: async (ctx) => {
    const values = ctx.args[0];
    if (Array.isArray(values)) {
      await ctx.locator.selectOption(values);
    } else {
      await ctx.locator.selectOption(String(values));
    }
  },

  check: async (ctx) => {
    await ctx.locator.check();
  },

  uncheck: async (ctx) => {
    await ctx.locator.uncheck();
  },

  hover: async (ctx) => {
    await ctx.locator.hover();
  },

  clear: async (ctx) => {
    await ctx.locator.clear();
  },

  focus: async (ctx) => {
    await ctx.locator.focus();
  },

  blur: async (ctx) => {
    await ctx.locator.blur();
  },

  dblclick: async (ctx) => {
    await ctx.locator.dblclick();
  },

  tap: async (ctx) => {
    await ctx.locator.tap();
  },

  scrollIntoViewIfNeeded: async (ctx) => {
    await ctx.locator.scrollIntoViewIfNeeded();
  },
};

// Fallback for methods not in the map
export async function fallbackLocatorMethod(
  ctx: MethodHandlerContext
): Promise<void> {
  const locatorMethod = (ctx.locator as any)[ctx.method];

  if (typeof locatorMethod !== "function") {
    throw new PlaywrightCommandMethodNotSupportedException(ctx.method);
  }

  try {
    // Call the method with the provided arguments
    await locatorMethod.apply(ctx.locator, ctx.args);
  } catch (error) {
    logger.error("Error in fallback locator method", {
      method: ctx.method,
      error: (error as Error).message,
    });
    throw new PlaywrightCommandException((error as Error).message);
  }
}

// Build prompt for act observe
export function buildActObservePrompt(
  action: string,
  supportedActions: string[],
  variables?: Record<string, string>
): string {
  let processedAction = action;

  // Replace variables if provided
  if (variables) {
    Object.entries(variables).forEach(([key, value]) => {
      processedAction = processedAction.replace(
        new RegExp(`%${key}%`, "g"),
        value
      );
    });
  }

  return `Find the element to perform this action: ${processedAction}

You should return elements that can be used to perform the requested action.
The action should be one of: ${supportedActions.join(", ")}

For complex actions, break them down:
- "click the submit button" → find button with text/role "submit"
- "fill in the email field" → find input with type="email" or label containing "email"
- "select option X from dropdown Y" → find select element with label/name Y

Return the most specific element that matches the user's intent.`;
}

export class ActHandler implements IActHandler {
  private selfHeal: boolean;
  private interventionDetector: InterventionDetector;
  private actionHistory: ActionHistoryItem[] = [];

  constructor(
    private page: Page,
    private cdpSession: CDPSession,
    private llmClient: LLMClient,
    private config: WallCrawlerConfig,
    private sessionId: string,
    private infrastructureProvider?: any
  ) {
    this.selfHeal = config.features?.selfHeal ?? true;
    this.interventionDetector = new InterventionDetector(this.llmClient, this.sessionId);
  }

  /**
   * Add an action to the history for intervention context
   */
  private addActionToHistory(action: string, success: boolean, error?: string, details?: any): void {
    const historyItem: ActionHistoryItem = {
      action,
      timestamp: Date.now(),
      details,
      success,
      error,
    };
    
    this.actionHistory.push(historyItem);
    
    // Keep only last 10 actions to prevent memory bloat
    if (this.actionHistory.length > 10) {
      this.actionHistory = this.actionHistory.slice(-10);
    }
  }

  /**
   * Check if an error might require intervention and handle accordingly
   */
  private async checkForIntervention(error: Error, actionDescription: string): Promise<boolean> {
    if (!this.infrastructureProvider?.handleIntervention) {
      // No intervention support available
      return false;
    }

    try {
      const wallcrawlerPage = this.page as any;
      const interventionEvent = await this.interventionDetector.detectIntervention(
        wallcrawlerPage,
        this.actionHistory,
        error.message
      );

      if (interventionEvent) {
        logger.info("Intervention detected, triggering intervention flow", {
          type: interventionEvent.type,
          confidence: interventionEvent.context.confidence,
        });

        await this.infrastructureProvider.handleIntervention(interventionEvent);
        return true;
      }

      return false;
    } catch (interventionError) {
      logger.warn("Failed to check for intervention", {
        error: (interventionError as Error).message,
      });
      return false;
    }
  }

  async actFromObserveResult(
    observe: ObserveResult,
    domSettleTimeoutMs?: number
  ): Promise<ActResult> {
    logger.info("Performing act from an ObserveResult", { observe });

    const method = observe.method;
    if (!method || method === "not-supported") {
      logger.error("Cannot execute ObserveResult with unsupported method", {
        method,
        observe,
      });
      return {
        success: false,
        message: `Unable to perform action: The method '${method}' is not supported in ObserveResult.`,
        action: observe.description || `ObserveResult action (${method})`,
      };
    }

    const args = observe.arguments ?? [];
    const selector = observe.selector.replace("xpath=", "");

    const actionDescription = observe.description || `ObserveResult action (${method})`;

    try {
      await this._performPlaywrightMethod(
        method,
        args,
        selector,
        domSettleTimeoutMs
      );

      // Track successful action
      this.addActionToHistory(actionDescription, true, undefined, { method, selector });

      return {
        success: true,
        message: `Action [${method}] performed successfully on selector: ${selector}`,
        action: actionDescription,
      };
    } catch (err) {
      const error = err as Error;
      
      // Track failed action
      this.addActionToHistory(actionDescription, false, error.message, { method, selector });

      // Check if intervention is required
      const interventionTriggered = await this.checkForIntervention(error, actionDescription);
      
      if (interventionTriggered) {
        return {
          success: false,
          message: `Action failed and intervention was triggered: ${error.message}`,
          action: actionDescription,
        };
      }

      if (
        !this.selfHeal ||
        err instanceof PlaywrightCommandMethodNotSupportedException
      ) {
        logger.error("Error performing act from an ObserveResult", {
          error: error.message,
          observe,
        });
        return {
          success: false,
          message: `Failed to perform act: ${error.message}`,
          action: actionDescription,
        };
      }

      // Log the error but don't attempt complex self-healing like the broken recursive approach
      logger.error("Error performing act from ObserveResult", {
        error: error.message,
        observe,
        method,
        selector: observe.selector,
      });

      return {
        success: false,
        message: `Failed to perform act: ${error.message}`,
        action: actionDescription,
      };
    }
  }

  async observeAct(
    actionOrOptions: ActOptions,
    observeHandler: ObserveHandler,
    llmClient: LLMClient,
    requestId: string
  ): Promise<ActResult> {
    // Extract the action string
    let action: string;

    if (!actionOrOptions.action) {
      throw new WallCrawlerInvalidArgumentError(
        "Invalid argument. Action options must have an `action` field."
      );
    }

    action = actionOrOptions.action;

    // Async function to perform observe and act
    const doObserveAndAct = async (): Promise<ActResult> => {
      const instruction = buildActObservePrompt(
        action,
        Object.values(SupportedPlaywrightAction),
        actionOrOptions.variables
      );

      const observeResults = await observeHandler.observe(instruction);

      if (observeResults.length === 0) {
        // Track failed action
        this.addActionToHistory(action, false, "No observe results found", { instruction });
        
        // Check if lack of results might indicate intervention needed
        const fakeError = new Error("No observe results found for action");
        const interventionTriggered = await this.checkForIntervention(fakeError, action);
        
        if (interventionTriggered) {
          return {
            success: false,
            message: `Failed to perform act: No observe results found and intervention was triggered`,
            action,
          };
        }

        return {
          success: false,
          message: `Failed to perform act: No observe results found for action`,
          action,
        };
      }

      const element: ObserveResult = observeResults[0];

      // Apply variable substitution if provided
      if (actionOrOptions.variables) {
        Object.keys(actionOrOptions.variables).forEach((key) => {
          if (element.arguments) {
            element.arguments = element.arguments.map((arg) =>
              String(arg).replace(`%${key}%`, actionOrOptions.variables![key])
            );
          }
        });
      }

      return this.actFromObserveResult(
        element,
        actionOrOptions.domSettleTimeoutMs
      );
    };

    // Handle timeout if specified
    if (!actionOrOptions.timeoutMs) {
      return doObserveAndAct();
    }

    // Race observeAct against timeout
    const { timeoutMs } = actionOrOptions;
    return await Promise.race([
      doObserveAndAct(),
      new Promise<ActResult>((resolve) => {
        setTimeout(() => {
          resolve({
            success: false,
            message: `Action timed out after ${timeoutMs}ms`,
            action,
          });
        }, timeoutMs);
      }),
    ]);
  }

  private async _performPlaywrightMethod(
    method: string,
    args: unknown[],
    xpath: string,
    domSettleTimeoutMs?: number
  ): Promise<void> {
    const locator = deepLocator(this.page, xpath).first();
    const initialUrl = this.page.url();

    logger.debug("Performing playwright method", {
      xpath,
      method,
      args,
    });

    const context: MethodHandlerContext = {
      method,
      locator,
      xpath,
      args,
      logger: (message, details) => logger.debug(message, details),
      stagehandPage: this.page, // In WallCrawler, we pass the page directly
      initialUrl,
      domSettleTimeoutMs,
    };

    try {
      // Look up method in handler map
      const methodFn = methodHandlerMap[method];

      if (methodFn) {
        await methodFn(context);
      } else if (typeof locator[method as keyof Locator] === "function") {
        await fallbackLocatorMethod(context);
      } else {
        logger.error("Chosen method is invalid", { method });
        throw new PlaywrightCommandMethodNotSupportedException(method);
      }

      // Wait for DOM to settle
      const wallcrawlerPage = this.page as any;
      if (wallcrawlerPage._waitForSettledDom) {
        await wallcrawlerPage._waitForSettledDom(domSettleTimeoutMs);
      }
    } catch (e) {
      logger.error("Error performing method", {
        error: (e as Error).message,
        method,
        xpath,
        args,
      });
      throw new PlaywrightCommandException((e as Error).message);
    }
  }
}
