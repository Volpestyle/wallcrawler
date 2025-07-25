export interface SessionMetadata {
    id: string;
    state: 'initializing' | 'running' | 'paused' | 'completed';
    script: string;
    cdpEndpoint?: string;
    results?: any;
    pauseReason?: string;
}

export interface ActOptions {
    action: string;
    selector?: string;
    timeoutMs?: number;
    variables?: Record<string, string>;
}

export interface ObserveResult {
    selector: string;
    method: string;
    arguments?: string[];
    description?: string;
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