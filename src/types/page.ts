import { Page, Cookie, Frame, CDPSession } from "playwright";
import {
  ActOptions,
  ExtractOptions,
  ObserveResult,
  ActResult,
} from "./handlers";
import z from "zod";

export interface WallCrawlerPage extends Page {
  // Session identifier
  sessionId: string;

  // AI-powered methods
  act(instruction: string, options?: ActOptions): Promise<ActResult>;
  act(options: ActOptions): Promise<ActResult>;
  act(observeResult: ObserveResult): Promise<ActResult>;
  extract<T>(options: ExtractOptions<T>): Promise<T>;
  observe(instruction?: string): Promise<ObserveResult[]>;

  // Session management
  checkpoint(): Promise<void>;
  restore(checkpointId: string): Promise<void>;

  // DOM settlement and CDP
  _waitForSettledDom(timeoutMs?: number): Promise<void>;
  getCDPClient(target?: Page | Frame): Promise<CDPSession>;
  sendCDP<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    target?: Page | Frame
  ): Promise<T>;
  enableCDP(domain: string, target?: Page | Frame): Promise<void>;
  disableCDP(domain: string, target?: Page | Frame): Promise<void>;

  // Frame management
  encodeWithFrameId(fid: string | undefined, backendId: number): string;

  // Captcha support
  waitForCaptchaSolve(timeoutMs?: number): Promise<void>;

  // Debugging
  debugDom(filepath: string): Promise<void>;
  getMetrics(): Promise<PageMetrics>;
}

export interface PageMetrics {
  timestamp: number;
  url: string;
  domNodes: number;
  eventListeners: number;
  jsHeapUsed: number;
  jsHeapTotal: number;
  layoutDuration: number;
  scriptDuration: number;
  taskDuration: number;
}

export interface SessionState {
  browserWSEndpoint: string;
  cookies: Cookie[];
  currentUrl: string;
  navigationHistory: string[];
  lastAction: string;
  checkpointTimestamp: number;
}

export const pageTextSchema = z.object({
  page_text: z.string(),
});
