import { Locator, Page, Frame } from "playwright";
import { createLogger } from "../../utils/logger";
import { 
  PlaywrightCommandException,
  PlaywrightCommandMethodNotSupportedException 
} from "../../types/errors";

const logger = createLogger("act-handler-utils");

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
export const methodHandlerMap: Record<string, (context: MethodHandlerContext) => Promise<void>> = {
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
export async function fallbackLocatorMethod(ctx: MethodHandlerContext): Promise<void> {
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
      processedAction = processedAction.replace(new RegExp(`%${key}%`, 'g'), value);
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