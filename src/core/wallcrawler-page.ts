import { Page, CDPSession, Frame } from "playwright";
import { WallCrawlerPage } from "../types/page";
import { WallCrawlerConfig } from "../types/config";
import { LLMClient } from "../types/llm";
import { ActOptions, ExtractOptions, ObserveResult } from "../types/handlers";
import { createLogger } from "../utils/logger";
import { ActHandler } from "../handlers/act-handler";
import { ExtractHandler } from "../handlers/extract-handler";
import { ObserveHandler } from "../handlers/observe-handler";
import { DebugManager } from "../utils/debug-manager";
import { InterventionDetector } from "./intervention-detector";
import {
  WallCrawlerNotInitializedError,
  HandlerNotInitializedError,
  WallCrawlerEnvironmentError,
  CaptchaTimeoutError,
  WallCrawlerDefaultError,
  WallCrawlerInvalidArgumentError,
} from "../types/errors";

const logger = createLogger("page");

/**
 * Creates an enhanced WallCrawlerPage using the Proxy pattern to wrap a Playwright Page.
 * 
 * ## Why Use a Proxy Pattern?
 * 
 * The Proxy pattern allows WallCrawler to seamlessly extend Playwright's Page functionality
 * while maintaining full compatibility with the existing Playwright API. This approach provides:
 * 
 * ### 1. **Transparent Playwright Compatibility**
 * - Users get access to ALL existing Playwright methods automatically
 * - Future Playwright updates are automatically supported
 * - No need to manually proxy every Playwright method
 * - Existing Playwright code works without modification
 * 
 * ### 2. **Enhanced Automation Features**
 * - Adds AI-powered methods: `act()`, `extract()`, `observe()`
 * - Provides CDP integration: `sendCDP()`, `enableCDP()`, `disableCDP()`
 * - Includes frame management: `encodeWithFrameId()`
 * - Offers debug capabilities: `debugDom()`, `getMetrics()`
 * - Supports session management: `checkpoint()`, `restore()`
 * 
 * ### 3. **Intelligent Interception**
 * - Automatically waits for DOM settlement after navigation
 * - Tracks action history for debugging and analytics
 * - Manages CDP sessions and frame contexts internally
 * - Handles initialization state and error checking
 * 
 * ### 4. **State Management**
 * - Maintains session continuity across page interactions
 * - Tracks frame hierarchies for multi-frame automation
 * - Preserves CDP session mappings for performance
 * - Coordinates with browser context for multi-page scenarios
 * 
 * ### 5. **Developer Experience**
 * - Single unified interface for both Playwright and WallCrawler features
 * - Type-safe access to enhanced methods via TypeScript interfaces
 * - Seamless integration with existing Playwright workflows
 * - No learning curve for existing Playwright users
 * 
 * ## Implementation Details
 * 
 * The proxy intercepts property access on the Playwright Page object:
 * - **WallCrawler methods**: Routed to internal handlers and state management
 * - **Playwright methods**: Executed normally but with added instrumentation
 * - **Navigation**: Enhanced with automatic DOM settlement waiting
 * - **Error handling**: Provides clear messages for uninitialized access
 * 
 * This architecture follows the same pattern as Stagehand but extends it with
 * additional CDP integration, frame management, and session capabilities needed
 * for enterprise-grade web automation.
 */
export function createWallCrawlerPage(
  page: Page,
  cdpSession: CDPSession,
  llmClient: LLMClient,
  config: WallCrawlerConfig,
  sessionId: string,
  infrastructureProvider?: any
): WallCrawlerPage {
  // State management
  let initialized = false;
  const cdpClients = new WeakMap<Page | Frame, CDPSession>();
  const domSettleTimeoutMs = config.browser?.timeout || 30000;

  // Intervention detection
  const interventionDetector = infrastructureProvider ? 
    new InterventionDetector(llmClient, sessionId) : 
    null;

  // Store the main CDP session
  cdpClients.set(page, cdpSession);

  // Create handlers (will be initialized later)
  const actHandler = new ActHandler(
    page,
    cdpSession,
    llmClient,
    config,
    sessionId,
    infrastructureProvider
  );
  const extractHandler = new ExtractHandler(
    llmClient,
    config
  );
  const observeHandler = new ObserveHandler(
    llmClient,
    config,
    sessionId,
    infrastructureProvider
  );
  const debugManager = new DebugManager(page, cdpSession);

  // Track action history
  const actionHistory: Array<{
    action: string;
    timestamp: number;
    details: any;
  }> = [];

  // Helper functions
  const encodeWithFrameId = (
    fid: string | undefined,
    backendId: number
  ): string => {
    // Use frame ID directly, with "main" for undefined (main frame)
    const frameKey = fid || "main";
    return `${frameKey}-${backendId}`;
  };

  // CDP session management
  const getCDPClient = async (
    target: Page | Frame = page
  ): Promise<CDPSession> => {
    const cached = cdpClients.get(target);
    if (cached) return cached;

    try {
      const context = page.context();
      const session = await context.newCDPSession(target);
      cdpClients.set(target, session);
      return session;
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (msg.includes("does not have a separate CDP session")) {
        // Re-use the main session for same-process iframes
        const rootSession = await getCDPClient(page);
        cdpClients.set(target, rootSession);
        return rootSession;
      }
      throw err;
    }
  };

  const sendCDP = async <T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    target?: Page | Frame
  ): Promise<T> => {
    const client = await getCDPClient(target ?? page);
    return client.send(
      method as Parameters<CDPSession["send"]>[0],
      params as Parameters<CDPSession["send"]>[1]
    ) as Promise<T>;
  };

  const enableCDP = async (
    domain: string,
    target?: Page | Frame
  ): Promise<void> => {
    await sendCDP<void>(`${domain}.enable`, {}, target);
  };

  const disableCDP = async (
    domain: string,
    target?: Page | Frame
  ): Promise<void> => {
    await sendCDP<void>(`${domain}.disable`, {}, target);
  };

  // DOM settlement implementation
  const _waitForSettledDom = async (timeoutMs?: number): Promise<void> => {
    const timeout = timeoutMs ?? domSettleTimeoutMs;
    const client = await getCDPClient();

    const hasDoc = !!(await page.title().catch(() => false));
    if (!hasDoc) await page.waitForLoadState("domcontentloaded");

    await client.send("Network.enable");
    await client.send("Page.enable");
    await client.send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    });

    return new Promise<void>((resolve) => {
      const inflight = new Set<string>();
      const meta = new Map<string, { url: string; start: number }>();
      const docByFrame = new Map<string, string>();

      let quietTimer: NodeJS.Timeout | null = null;
      let stalledRequestSweepTimer: NodeJS.Timeout | null = null;

      const clearQuiet = () => {
        if (quietTimer) {
          clearTimeout(quietTimer);
          quietTimer = null;
        }
      };

      const maybeQuiet = () => {
        if (inflight.size === 0 && !quietTimer)
          quietTimer = setTimeout(() => resolveDone(), 500);
      };

      const finishReq = (id: string) => {
        if (!inflight.delete(id)) return;
        meta.delete(id);
        for (const [fid, rid] of docByFrame)
          if (rid === id) docByFrame.delete(fid);
        clearQuiet();
        maybeQuiet();
      };

      const onRequest = (p: any) => {
        if (p.type === "WebSocket" || p.type === "EventSource") return;

        inflight.add(p.requestId);
        meta.set(p.requestId, { url: p.request.url, start: Date.now() });

        if (p.type === "Document" && p.frameId)
          docByFrame.set(p.frameId, p.requestId);

        clearQuiet();
      };

      const onFinish = (p: { requestId: string }) => finishReq(p.requestId);
      const onCached = (p: { requestId: string }) => finishReq(p.requestId);
      const onDataUrl = (p: any) =>
        p.response.url.startsWith("data:") && finishReq(p.requestId);

      const onFrameStop = (f: any) => {
        const id = docByFrame.get(f.frameId);
        if (id) finishReq(id);
      };

      client.on("Network.requestWillBeSent", onRequest);
      client.on("Network.loadingFinished", onFinish);
      client.on("Network.loadingFailed", onFinish);
      client.on("Network.requestServedFromCache", onCached);
      client.on("Network.responseReceived", onDataUrl);
      client.on("Page.frameStoppedLoading", onFrameStop);

      stalledRequestSweepTimer = setInterval(() => {
        const now = Date.now();
        for (const [id, m] of meta) {
          if (now - m.start > 2_000) {
            inflight.delete(id);
            meta.delete(id);
            logger.debug("Forcing completion of stalled iframe document", {
              url: m.url.slice(0, 120),
            });
          }
        }
        maybeQuiet();
      }, 500);

      maybeQuiet();

      const guard = setTimeout(() => {
        if (inflight.size) {
          logger.warn(
            "DOM-settle timeout reached - network requests still pending",
            {
              count: inflight.size,
            }
          );
        }
        resolveDone();
      }, timeout);

      const resolveDone = () => {
        client.off("Network.requestWillBeSent", onRequest);
        client.off("Network.loadingFinished", onFinish);
        client.off("Network.loadingFailed", onFinish);
        client.off("Network.requestServedFromCache", onCached);
        client.off("Network.responseReceived", onDataUrl);
        client.off("Page.frameStoppedLoading", onFrameStop);
        if (quietTimer) clearTimeout(quietTimer);
        if (stalledRequestSweepTimer) clearInterval(stalledRequestSweepTimer);
        clearTimeout(guard);
        resolve();
      };
    });
  };

  /**
   * Proxy handler that intercepts property access on the Playwright Page.
   * This is the core of WallCrawler's enhancement strategy:
   * 
   * 1. **WallCrawler Methods**: Custom methods are handled by our switch statement
   * 2. **Playwright Methods**: Passed through to the original Page with instrumentation
   * 3. **Navigation Enhancement**: Special handling for `goto` to add DOM settlement
   * 4. **State Management**: Tracks actions and manages initialization
   */
  const proxyHandler: ProxyHandler<Page> = {
    get(target: Page, prop: string | symbol): any {
      // Handle WallCrawlerPage-specific methods
      switch (prop) {
        case "sessionId":
          return sessionId;

        case "act":
          return async (
            actionOrOptions: string | ActOptions | ObserveResult
          ) => {
            try {
              if (!actHandler) {
                throw new HandlerNotInitializedError("Act");
              }

              if (!initialized) {
                throw new WallCrawlerNotInitializedError("act");
              }

              // Handle different input types
              let actOptions: ActOptions;

              if (typeof actionOrOptions === "string") {
                actOptions = { action: actionOrOptions };
              } else if (
                typeof actionOrOptions === "object" &&
                actionOrOptions !== null
              ) {
                // Check if it's an ObserveResult
                if (
                  "selector" in actionOrOptions &&
                  "method" in actionOrOptions
                ) {
                  const observeResult = actionOrOptions as ObserveResult;
                  logger.info("Acting from ObserveResult", { observeResult });
                  return actHandler.actFromObserveResult(observeResult);
                } else if ("action" in actionOrOptions) {
                  actOptions = actionOrOptions as ActOptions;
                } else {
                  throw new WallCrawlerInvalidArgumentError(
                    "Invalid argument. Valid arguments are: a string, an ActOptions object, " +
                      "or an ObserveResult with 'selector' and 'method' fields."
                  );
                }
              } else {
                throw new WallCrawlerInvalidArgumentError(
                  "Invalid argument type for act method"
                );
              }

              logger.info("Executing act", { actOptions });
              actionHistory.push({
                action: "act",
                timestamp: Date.now(),
                details: actOptions,
              });

              const requestId = Math.random().toString(36).substring(2);
              return actHandler.observeAct(
                actOptions,
                observeHandler,
                llmClient,
                requestId
              );
            } catch (err) {
              if (err instanceof Error && err.name.includes("WallCrawler")) {
                throw err;
              }
              throw new WallCrawlerDefaultError(err);
            }
          };

        case "extract":
          return async <T>(options: ExtractOptions<T>) => {
            if (!extractHandler) {
              throw new HandlerNotInitializedError("Extract");
            }

            if (!initialized) {
              throw new WallCrawlerNotInitializedError("extract");
            }

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
            if (!observeHandler) {
              throw new HandlerNotInitializedError("Observe");
            }

            if (!initialized) {
              throw new WallCrawlerNotInitializedError("observe");
            }

            logger.info("Executing observe", { instruction });
            actionHistory.push({
              action: "observe",
              timestamp: Date.now(),
              details: { instruction },
            });
            return observeHandler.observe(instruction, {});
          };

        case "_waitForSettledDom":
          return _waitForSettledDom;

        case "getCDPClient":
          return getCDPClient;

        case "sendCDP":
          return sendCDP;

        case "enableCDP":
          return enableCDP;

        case "disableCDP":
          return disableCDP;

        case "encodeWithFrameId":
          return encodeWithFrameId;

        case "debugDom":
          return async (filepath: string) => {
            logger.info("Exporting debug DOM", { filepath });
            return debugManager.exportDom(filepath);
          };

        case "getMetrics":
          return async () => {
            return debugManager.getMetrics();
          };

        case "checkForIntervention":
          return async (errorContext?: string) => {
            if (!interventionDetector || !infrastructureProvider) {
              logger.debug("No intervention support available");
              return false;
            }

            try {
              const interventionEvent = await interventionDetector.detectIntervention(
                target as any, // Will be converted to WallCrawlerPage interface
                [], // No action history available at page level
                errorContext
              );

              if (interventionEvent) {
                logger.info("Intervention detected via checkForIntervention", {
                  type: interventionEvent.type,
                  confidence: interventionEvent.context.confidence,
                });

                await infrastructureProvider.handleIntervention(interventionEvent);
                return true;
              }

              return false;
            } catch (error) {
              logger.error("Failed to check for intervention", {
                error: (error as Error).message,
              });
              return false;
            }
          };

        case "goto":
          // Enhanced navigation: adds automatic DOM settlement waiting
          const originalGoto = Reflect.get(target, prop).bind(target);
          return async (url: string, options?: any) => {
            const result = await originalGoto(url, options);
            
            // Track navigation for debugging and analytics
            actionHistory.push({
              action: "navigate", 
              timestamp: Date.now(),
              details: { url, options },
            });

            // Wait for DOM to settle after navigation
            await _waitForSettledDom();
            return result;
          };

        // Default: pass through to original Playwright Page
        default:
          const value = target[prop as keyof Page];

          // Wrap Playwright methods to maintain compatibility while adding instrumentation
          if (typeof value === "function") {
            return async (...args: any[]) => {
              const methodName = String(prop);

              // List of methods that should trigger settlement detection
              const settlementMethods = [
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

                // Wait for DOM settlement
                await _waitForSettledDom();

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
          "sessionId",
          "act",
          "extract",
          "observe",
          "_waitForSettledDom",
          "getCDPClient",
          "sendCDP",
          "enableCDP",
          "disableCDP",
          "encodeWithFrameId",
          "waitForCaptchaSolve",
          "checkForIntervention",
          "debugDom",
          "getMetrics",
        ].includes(String(prop))
      );
    },
  };

  // Mark as initialized
  initialized = true;

  // Create and return the proxy
  const wallCrawlerPage = new Proxy(page, proxyHandler) as WallCrawlerPage;
  
  // Initialize handlers with the completed WallCrawlerPage
  extractHandler.init(wallCrawlerPage);
  observeHandler.init(wallCrawlerPage);
  
  return wallCrawlerPage;
}

// Export the WallCrawlerPage type from the types module
export type { WallCrawlerPage } from "../types/page";
