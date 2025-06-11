import { Page, CDPSession } from "playwright";
import { WallCrawlerPage } from "../types/page";
import { WallCrawlerConfig } from "../types/config";
import { NetworkMonitor } from "../types/cdp";
import { LLMClient } from "../types/llm";
import { ActOptions, ExtractOptions } from "../types/handlers";
import { createLogger } from "../utils/logger";
import { ActHandler } from "../handlers/act-handler";
import { ExtractHandler } from "../handlers/extract-handler";
import { ObserveHandler } from "../handlers/observe-handler";
import { DebugManager } from "../utils/debug-manager";

const logger = createLogger("page");

export function createWallCrawlerPage(
  page: Page,
  cdpSession: CDPSession,
  networkMonitor: NetworkMonitor,
  llmClient: LLMClient,
  config: WallCrawlerConfig,
  sessionId: string
): WallCrawlerPage {
  // Create handlers
  const actHandler = new ActHandler(
    page,
    cdpSession,
    networkMonitor,
    llmClient,
    config
  );
  const extractHandler = new ExtractHandler(
    page,
    cdpSession,
    llmClient,
    config
  );
  const observeHandler = new ObserveHandler(
    page,
    cdpSession,
    llmClient,
    config
  );
  const debugManager = new DebugManager(page, cdpSession);

  // Track action history
  const actionHistory: Array<{
    action: string;
    timestamp: number;
    details: any;
  }> = [];

  // Create proxy handler
  const proxyHandler: ProxyHandler<Page> = {
    get(target: Page, prop: string | symbol): any {
      // Handle WallCrawlerPage-specific methods
      switch (prop) {
        case "act":
          return async (instruction: string, options?: ActOptions) => {
            logger.info("Executing act", { instruction, options });
            actionHistory.push({
              action: "act",
              timestamp: Date.now(),
              details: { instruction, options },
            });
            return actHandler.execute(instruction, options);
          };

        case "extract":
          return async <T>(options: ExtractOptions<T>) => {
            logger.info("Executing extract", {
              instruction: options.instruction,
            });
            actionHistory.push({
              action: "extract",
              timestamp: Date.now(),
              details: options,
            });
            return extractHandler.extract(options);
          };

        case "observe":
          return async (instruction?: string) => {
            logger.info("Executing observe", { instruction });
            actionHistory.push({
              action: "observe",
              timestamp: Date.now(),
              details: { instruction },
            });
            return observeHandler.observe(instruction);
          };


        case "debugDom":
          return async (filepath: string) => {
            logger.info("Exporting debug DOM", { filepath });
            return debugManager.exportDom(filepath);
          };

        case "getMetrics":
          return async () => {
            return debugManager.getMetrics();
          };

        // Default: pass through to original page
        default:
          const value = target[prop as keyof Page];

          // If it's a function, wrap it to add settlement detection
          if (typeof value === "function") {
            return async (...args: any[]) => {
              const methodName = String(prop);

              // List of methods that should trigger settlement detection
              const settlementMethods = [
                "goto",
                "click",
                "fill",
                "type",
                "press",
                "selectOption",
                "check",
                "uncheck",
                "hover",
                "tap",
                "dragAndDrop",
              ];

              if (settlementMethods.includes(methodName)) {
                logger.debug(`Intercepted ${methodName} call`);

                // Execute the original method
                const boundMethod = Reflect.get(target, prop).bind(target);
                const result = await boundMethod(...args);

                // Wait for network settlement
                if (
                  config.features.requestInterception &&
                  "waitForSettlement" in networkMonitor &&
                  typeof (
                    networkMonitor as { waitForSettlement: () => Promise<void> }
                  ).waitForSettlement === "function"
                ) {
                  await (
                    networkMonitor as { waitForSettlement: () => Promise<void> }
                  ).waitForSettlement();
                }

                actionHistory.push({
                  action: methodName,
                  timestamp: Date.now(),
                  details: { args },
                });

                return result;
              }

              // For other methods, just pass through
              const boundMethod = Reflect.get(target, prop).bind(target);
              return boundMethod(...args);
            };
          }

          return value;
      }
    },

    // Pass through property assignments
    set(target: Page, prop: string | symbol, value: any): boolean {
      (target as any)[prop] = value;
      return true;
    },

    // Handle 'in' operator
    has(target: Page, prop: string | symbol): boolean {
      return (
        prop in target ||
        [
          "act",
          "extract",
          "observe",
          "debugDom",
          "getMetrics",
        ].includes(String(prop))
      );
    },
  };

  // Create and return the proxy
  return new Proxy(page, proxyHandler) as WallCrawlerPage;
}
