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
  provider: string;
  displayName: string;
  modelName: string;
  input: number;
  output: number;
  available: boolean;
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
  lastFetched?: string;
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
