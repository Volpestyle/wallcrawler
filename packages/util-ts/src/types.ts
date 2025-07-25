import { z } from "zod";

export interface SessionMetadata {
    id: string;
    state: 'initializing' | 'running' | 'paused' | 'completed';
    script: string;
    cdpEndpoint?: string;
    results?: any;
    pauseReason?: string;
}

// Types matching original Stagehand exactly
export interface ActOptions {
    action: string;
    modelName?: string;
    modelClientOptions?: Record<string, unknown>;
    variables?: Record<string, string>;
    domSettleTimeoutMs?: number;
    timeoutMs?: number;
    iframes?: boolean;
}

export interface ObserveResult {
    selector: string;
    description: string;
    backendNodeId?: number;
    method?: string;
    arguments?: string[];
}

export interface ObserveOptions {
    instruction?: string;
    modelName?: string;
    modelClientOptions?: Record<string, unknown>;
    domSettleTimeoutMs?: number;
    returnAction?: boolean;
    onlyVisible?: boolean;
    drawOverlay?: boolean;
    iframes?: boolean;
}

export interface Session {
    id: string;
    status: 'RUNNING' | 'STOPPED' | 'ERROR';
    connectUrl: string;
}

export interface SessionCreateParams {
    projectId: string;
    script?: string;
    userMetadata?: Record<string, string>;
}

export interface StreamData {
    type: 'frame' | 'pause' | 'error';
    data?: string;
    reason?: string;
}

// Log types matching original Stagehand
export type LogLevel = 0 | 1 | 2;

export const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
    0: "error",
    1: "info",
    2: "debug",
};

export type LogLine = {
    id?: string;
    category?: string;
    message: string;
    level?: LogLevel;
    timestamp?: string;
    auxiliary?: {
        [key: string]: {
            value: string;
            type: "object" | "string" | "html" | "integer" | "float" | "boolean";
        };
    };
};

export interface ActResult {
    success: boolean;
    message: string;
    action: string;
}

export interface StartSessionResult {
    sessionId: string;
    debugUrl: string;
    sessionUrl: string;
}

// Using proper Zod constraints like original Stagehand
export interface ExtractOptions<T extends z.AnyZodObject> {
    instruction?: string;
    schema?: T;
    modelName?: string;
    modelClientOptions?: Record<string, unknown>;
    domSettleTimeoutMs?: number;
    useTextExtract?: boolean;
    selector?: string;
    iframes?: boolean;
}

export type ExtractResult<T extends z.AnyZodObject> = z.infer<T>; 