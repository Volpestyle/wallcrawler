import { z } from 'zod';

export interface Session {
    id: string;
    status: 'active' | 'idle' | 'stopped';
    createdAt: string;
    lastActivity?: string;
    debugUrl?: string;
    sessionUrl?: string;
}

export interface WorkflowStep {
    id: string;
    type: 'act' | 'extract' | 'observe' | 'agent';
    name: string;
    parameters: Record<string, unknown>;
    order: number;
}

export interface Workflow {
    id: string;
    name: string;
    description?: string;
    steps: WorkflowStep[];
    createdAt: string;
    lastRun?: string;
}

export interface WorkflowRun {
    id: string;
    workflowId: string;
    status: 'running' | 'completed' | 'failed';
    startTime: string;
    endTime?: string;
    results: Record<string, unknown>[];
    error?: string;
}

export interface StagehandMetrics {
    actPromptTokens: number;
    actCompletionTokens: number;
    actInferenceTimeMs: number;
    extractPromptTokens: number;
    extractCompletionTokens: number;
    extractInferenceTimeMs: number;
    observePromptTokens: number;
    observeCompletionTokens: number;
    observeInferenceTimeMs: number;
    agentPromptTokens: number;
    agentCompletionTokens: number;
    agentInferenceTimeMs: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalInferenceTimeMs: number;
}

export interface LogEntry {
    timestamp: string;
    level: 'info' | 'warn' | 'error';
    message: string;
    data?: Record<string, unknown>;
}

export const ActOptionsSchema = z.object({
    action: z.string(),
    modelName: z.string().optional(),
    variables: z.record(z.string(), z.string()).optional(),
    domSettleTimeoutMs: z.number().optional(),
    timeoutMs: z.number().optional(),
    iframes: z.boolean().optional(),
});

export const ExtractOptionsSchema = z.object({
    instruction: z.string().optional(),
    schema: z.any().optional(),
    modelName: z.string().optional(),
    domSettleTimeoutMs: z.number().optional(),
    selector: z.string().optional(),
    iframes: z.boolean().optional(),
});

export const ObserveOptionsSchema = z.object({
    instruction: z.string().optional(),
    modelName: z.string().optional(),
    domSettleTimeoutMs: z.number().optional(),
    returnAction: z.boolean().optional(),
    drawOverlay: z.boolean().optional(),
    iframes: z.boolean().optional(),
});

export const AgentExecuteSchema = z.object({
    instruction: z.string(),
    maxSteps: z.number().optional(),
    autoScreenshot: z.boolean().optional(),
    waitBetweenActions: z.number().optional(),
    context: z.string().optional(),
});

export type ActOptions = z.infer<typeof ActOptionsSchema>;
export type ExtractOptions = z.infer<typeof ExtractOptionsSchema>;
export type ObserveOptions = z.infer<typeof ObserveOptionsSchema>;
export type AgentExecuteOptions = z.infer<typeof AgentExecuteSchema>; 