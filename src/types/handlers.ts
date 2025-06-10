import { Page } from 'playwright';
import { z } from 'zod';

// Act Handler Types
export interface ActHandler {
  execute(instruction: string, options: ActOptions): Promise<void>;
}

export interface ActOptions {
  maxAttempts?: number; // Default: 3
  settlementStrategy?: 'aggressive' | 'patient' | 'none';
  screenshot?: boolean;
  validateSuccess?: (page: Page) => Promise<boolean>;
}

// Extract Handler Types
export interface ExtractHandler {
  extract<T>(options: ExtractOptions<T>): Promise<T>;
}

export interface ExtractOptions<T> {
  instruction: string;
  schema: z.ZodSchema<T>;
  mode?: 'text' | 'visual' | 'hybrid';
  includeMetadata?: boolean;
  maxDomSize?: number; // Default: 50000 chars
}

// Observe Handler Types
export interface ObserveHandler {
  observe(instruction?: string): Promise<ObserveResult[]>;
}

export interface ObserveResult {
  selector: string; // XPath or CSS
  description: string;
  role?: string; // Accessibility role
  visible: boolean;
  interactive: boolean;
  boundingBox: { x: number; y: number; width: number; height: number };
  attributes: Record<string, string>;
}

// Agent Handler Types
export interface AgentHandler {
  execute(task: string, options: AgentOptions): Promise<AgentResult>;
}

export interface AgentOptions {
  maxSteps?: number;
  planningStrategy?: 'sequential' | 'adaptive';
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
  action: 'act' | 'extract' | 'observe' | 'navigate';
  result: any;
  timestamp: number;
  duration: number;
}