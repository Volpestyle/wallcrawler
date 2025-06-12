import { Page, CDPSession, Locator } from "playwright";
import { z } from "zod";
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
  ElementNotFoundError,
  TimeoutError,
  PlaywrightCommandException,
  PlaywrightCommandMethodNotSupportedException,
  WallCrawlerInvalidArgumentError,
} from "../types/errors";
import { createLogger } from "../utils/logger";
import { DOMProcessor } from "../dom/processor";
import { retry } from "../utils/retry";
import {
  methodHandlerMap,
  fallbackLocatorMethod,
  deepLocator,
  buildActObservePrompt,
  SupportedPlaywrightAction,
  MethodHandlerContext,
} from "./utils/act-handler-utils";

const logger = createLogger("act");

export class ActHandler implements IActHandler {
  private selfHeal: boolean;

  constructor(
    private page: Page,
    private cdpSession: CDPSession,
    private llmClient: LLMClient,
    private config: WallCrawlerConfig
  ) {
    this.selfHeal = config.features?.selfHeal ?? true;
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

    try {
      await this._performPlaywrightMethod(
        method,
        args,
        selector,
        domSettleTimeoutMs
      );

      return {
        success: true,
        message: `Action [${method}] performed successfully on selector: ${selector}`,
        action: observe.description || `ObserveResult action (${method})`,
      };
    } catch (err) {
      if (
        !this.selfHeal ||
        err instanceof PlaywrightCommandMethodNotSupportedException
      ) {
        logger.error("Error performing act from an ObserveResult", {
          error: (err as Error).message,
          observe,
        });
        return {
          success: false,
          message: `Failed to perform act: ${(err as Error).message}`,
          action: observe.description || `ObserveResult action (${method})`,
        };
      }

      // Log the error but don't attempt complex self-healing like the broken recursive approach
      logger.error("Error performing act from ObserveResult", {
        error: (err as Error).message,
        observe,
        method,
        selector: observe.selector,
      });
      
      return {
        success: false,
        message: `Failed to perform act: ${(err as Error).message}`,
        action: observe.description || `ObserveResult action (${method})`,
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
