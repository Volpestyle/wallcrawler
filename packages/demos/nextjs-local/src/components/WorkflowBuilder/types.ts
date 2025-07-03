// Union type for different step results based on step type
export type StepResult = 
  | NavigateResult
  | ActResult
  | ObserveResult
  | ExtractResult
  | AgentResult;

export interface NavigateResult {
  type: 'navigate';
  url: string;
  title: string;
  status: number;
}

export interface ActResult {
  type: 'act';
  action: string;
  success: boolean;
  element?: string;
}

export interface ObserveResult {
  type: 'observe';
  observations: Array<{
    element: string;
    description: string;
    confidence: number;
  }>;
}

export interface ExtractResult {
  type: 'extract';
  data: Record<string, unknown>;
  schema: Record<string, unknown>;
}

export interface AgentResult {
  type: 'agent';
  actions: string[];
  finalState: Record<string, unknown>;
  success: boolean;
}

export interface WorkflowStep {
  id: string;
  type: 'navigate' | 'act' | 'observe' | 'extract' | 'agent';
  title: string;
  config: {
    url?: string;
    instruction?: string;
    schema?: string;
    waitTime?: number;
  };
  result?: StepResult;
  status: 'pending' | 'running' | 'completed' | 'error';
  error?: string;
  tokens?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    inference_time_ms?: number;
    cost?: number;
  };
}

export interface ModelInfo {
  id: string; // New: unique identifier like "openai/gpt-4o"
  name: string; // Model name like "gpt-4o"
  displayName: string; // Display name like "GPT-4O (OpenAI)"
  provider: string; // Provider like "openai"
  pricing: ModelPricing; // Pricing information
  type: 'cloud' | 'local'; // Model type
  note?: string; // Optional note (for free models)
  available?: boolean; // Deprecated: kept for compatibility
  hasApiKey?: boolean; // Whether API key is configured
  apiKeyStatus?: 'configured' | 'missing' | 'not_required'; // API key status
}

export interface WorkflowStats {
  totalTokens: number;
  totalCost: number;
  totalInferenceTime: number;
  stepCosts: number[];
}

export interface ModelPricing {
  input: number;
  output: number;
}

export interface ProviderPricing {
  [modelName: string]: ModelPricing;
}

export interface PricingResponse {
  available: boolean;
  note?: string;
  reason?: string;
  lastFetched: string;
  sources?: string[];
  models: ModelInfo[]; // New: comprehensive model list
  modelsCount?: {
    openai: number;
    anthropic: number;
    gemini: number;
  };
  openai?: ProviderPricing;
  anthropic?: ProviderPricing;
  gemini?: ProviderPricing;
  ollama?: {
    input: number;
    output: number;
    note: string;
  };
  [provider: string]: ProviderPricing | { input: number; output: number; note: string } | boolean | string | ModelInfo[] | { openai: number; anthropic: number; gemini: number } | string[] | undefined;
}

export interface WallcrawlerResponse {
  sessionId?: string;
  result?: StepResult;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens?: number;
    inference_time_ms?: number;
  };
  error?: string;
}

export interface StepType {
  value: string;
  label: string;
  icon: React.ReactNode;
  description: string;
  cost: string;
}

export interface WorkflowPreset {
  name: string;
  description: string;
  steps: Array<{
    type: 'navigate' | 'act' | 'observe' | 'extract' | 'agent';
    title: string;
    config: {
      url?: string;
      instruction?: string;
      schema?: string;
      waitTime?: number;
    };
  }>;
}

export interface TaskResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  screenshots?: string[];
  logs?: string[];
}

export interface TaskStatus {
  status: 'idle' | 'running' | 'success' | 'error';
  message?: string;
  progress?: number;
}
