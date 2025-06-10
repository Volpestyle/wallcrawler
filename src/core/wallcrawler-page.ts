import { Page, CDPSession } from 'playwright';
import { WallCrawlerPage } from '../types/page';
import { WallCrawlerConfig } from '../types/config';
import { NetworkMonitor } from '../types/cdp';
import { LLMClient } from '../types/llm';
import { ActOptions, ExtractOptions, ObserveResult } from '../types/handlers';
import { createLogger } from '../utils/logger';
import { ActHandler } from '../handlers/act-handler';
import { ExtractHandler } from '../handlers/extract-handler';
import { ObserveHandler } from '../handlers/observe-handler';
import { SessionManager } from '../aws/session-manager';
import { DebugManager } from '../utils/debug-manager';

const logger = createLogger('page');

export function createWallCrawlerPage(
  page: Page,
  cdpSession: CDPSession,
  networkMonitor: NetworkMonitor,
  llmClient: LLMClient,
  config: WallCrawlerConfig,
  sessionId: string
): WallCrawlerPage {
  // Create handlers
  const actHandler = new ActHandler(page, cdpSession, networkMonitor, llmClient, config);
  const extractHandler = new ExtractHandler(page, cdpSession, llmClient, config);
  const observeHandler = new ObserveHandler(page, cdpSession, llmClient, config);
  const sessionManager = new SessionManager(config, sessionId);
  const debugManager = new DebugManager(page, cdpSession);

  // Track action history
  const actionHistory: Array<{ action: string; timestamp: number; details: any }> = [];

  // Create proxy handler
  const proxyHandler: ProxyHandler<Page> = {
    get(target: Page, prop: string | symbol, receiver: any): any {
      // Handle WallCrawlerPage-specific methods
      switch (prop) {
        case 'act':
          return async (instruction: string, options?: ActOptions) => {
            logger.info('Executing act', { instruction, options });
            actionHistory.push({
              action: 'act',
              timestamp: Date.now(),
              details: { instruction, options },
            });
            return actHandler.execute(instruction, options);
          };

        case 'extract':
          return async <T>(options: ExtractOptions<T>) => {
            logger.info('Executing extract', { instruction: options.instruction });
            actionHistory.push({
              action: 'extract',
              timestamp: Date.now(),
              details: options,
            });
            return extractHandler.extract(options);
          };

        case 'observe':
          return async (instruction?: string) => {
            logger.info('Executing observe', { instruction });
            actionHistory.push({
              action: 'observe',
              timestamp: Date.now(),
              details: { instruction },
            });
            return observeHandler.observe(instruction);
          };

        case 'checkpoint':
          return async () => {
            logger.info('Creating checkpoint');
            return sessionManager.checkpoint(page);
          };

        case 'restore':
          return async (checkpointId: string) => {
            logger.info('Restoring from checkpoint', { checkpointId });
            return sessionManager.restore(checkpointId, page);
          };

        case 'debugDom':
          return async (filepath: string) => {
            logger.info('Exporting debug DOM', { filepath });
            return debugManager.exportDom(filepath);
          };

        case 'getMetrics':
          return async () => {
            return debugManager.getMetrics();
          };

        // Default: pass through to original page
        default:
          const value = target[prop as keyof Page];
          
          // If it's a function, wrap it to add settlement detection
          if (typeof value === 'function') {
            return async (...args: any[]) => {
              const methodName = String(prop);
              
              // List of methods that should trigger settlement detection
              const settlementMethods = [
                'goto', 'click', 'fill', 'type', 'press', 'selectOption',
                'check', 'uncheck', 'hover', 'tap', 'dragAndDrop'
              ];
              
              if (settlementMethods.includes(methodName)) {
                logger.debug(`Intercepted ${methodName} call`);
                
                // Execute the original method
                const result = await value.apply(target, args);
                
                // Wait for network settlement
                if (config.features.requestInterception) {
                  await networkMonitor.waitForSettlement();
                }
                
                actionHistory.push({
                  action: methodName,
                  timestamp: Date.now(),
                  details: { args },
                });
                
                return result;
              }
              
              // For other methods, just pass through
              return value.apply(target, args);
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
      return prop in target || 
        ['act', 'extract', 'observe', 'checkpoint', 'restore', 'debugDom', 'getMetrics'].includes(String(prop));
    },
  };

  // Create and return the proxy
  return new Proxy(page, proxyHandler) as WallCrawlerPage;
}