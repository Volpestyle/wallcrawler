import { Page } from "playwright";
import { z } from "zod";

// Act Handler Types
export interface ActHandler {
  actFromObserveResult(
    observeResult: ObserveResult,
    domSettleTimeoutMs?: number
  ): Promise<ActResult>;
  observeAct(
    actionOrOptions: ActOptions,
    observeHandler: ObserveHandler,
    llmClient: any,
    requestId: string
  ): Promise<ActResult>;
}

export interface ActOptions {
  action?: string;
  maxAttempts?: number; // Default: 3
  settlementStrategy?: "aggressive" | "patient" | "none";
  screenshot?: boolean;
  validateSuccess?: (page: Page) => Promise<boolean>;
  timeoutMs?: number;
  domSettleTimeoutMs?: number;
  variables?: Record<string, string>;
  modelName?: string;
  modelClientOptions?: Record<string, any>;
  selfHeal?: boolean;
  iframes?: boolean;
}

export interface ActResult {
  success: boolean;
  message: string;
  action: string;
}

// Extract Handler Types
export interface ExtractHandler {
  extract<T>(options?: ExtractOptions<T>): Promise<T>;
}

export interface ExtractOptions<T> {
  instruction?: string;
  schema?: z.ZodSchema<T>;
  selector?: string; // XPath selector to target specific element
  timeoutMs?: number;
}

// Observe Handler Types
export interface ObserveHandler {
  observe(
    instruction?: string,
    options?: {
      returnAction?: boolean;
      drawOverlay?: boolean;
      fromAct?: boolean;
      iframes?: boolean;
    }
  ): Promise<ObserveResult[]>;
}

export interface ObserveResult {
  selector: string; // XPath selector to the element
  description: string; // Description of the element and what action can be taken
  backendNodeId?: number; // Internal DOM node identifier
  method?: string; // Suggested Playwright method (when returnAction=true)
  arguments?: string[]; // Arguments for the method (when returnAction=true)
}

// Agent Handler Types
export interface AgentHandler {
  execute(task: string, options: AgentOptions): Promise<AgentResult>;
}

export interface AgentOptions {
  maxSteps?: number;
  planningStrategy?: "sequential" | "adaptive";
  allowParallel?: boolean;
  checkpoint?: boolean;
}

export interface AgentResult {
  success: boolean;
  steps: AgentStep[];
  finalOutput?: any;
  error?: string;
}

export interface AgentStep {
  instruction: string;
  action: "act" | "extract" | "observe" | "navigate";
  result: any;
  timestamp: number;
  duration: number;
}
