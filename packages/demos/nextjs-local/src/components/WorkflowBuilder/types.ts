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
  result?: any;
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
  [provider: string]: any;
}

export interface WallcrawlerResponse {
  sessionId?: string;
  result?: any;
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
    type: string;
    title: string;
    config: Record<string, any>;
  }>;
}
