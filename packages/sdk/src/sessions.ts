import * as Core from './core';

export interface Session {
    id: string;
    status: 'RUNNING' | 'STOPPED' | 'ERROR' | 'COMPLETED' | 'TIMED_OUT';
    connectUrl: string;
    createdAt: string;
    projectId: string;
    region?: 'us-west-2' | 'us-east-1' | 'eu-central-1' | 'ap-southeast-1';
    avgCpuUsage?: number;
    memoryUsage?: number;
    userMetadata?: Record<string, unknown>;
    endedAt?: string;
    expiresAt?: string;
    startedAt?: string;
    updatedAt?: string;
}

export interface SessionCreateParams {
    projectId: string;
    keepAlive?: boolean;
    timeout?: number;
    region?: 'us-west-2' | 'us-east-1' | 'eu-central-1' | 'ap-southeast-1';
    userMetadata?: Record<string, unknown>;
    browserSettings?: {
        blockAds?: boolean;
        solveCaptchas?: boolean;
        recordSession?: boolean;
        logSession?: boolean;
        viewport?: {
            width?: number;
            height?: number;
        };
    };
}

export interface SessionCreateResponse {
    id: string;
    connectUrl: string;
    projectId: string;
    status: 'RUNNING' | 'STOPPED' | 'ERROR' | 'COMPLETED' | 'TIMED_OUT';
    createdAt: string;
    region?: string;
    userMetadata?: Record<string, unknown>;
}

export interface SessionDebugResponse {
    debuggerUrl: string;
    wsUrl: string;
    pages?: Array<{
        id: string;
        title: string;
        url: string;
        debuggerUrl: string;
    }>;
}

export interface SessionUpdateParams {
    projectId: string;
    status: 'REQUEST_RELEASE';
}

export interface SessionListParams {
    status?: 'RUNNING' | 'STOPPED' | 'ERROR' | 'COMPLETED' | 'TIMED_OUT';
    q?: string; // Query by user metadata
}

export type SessionListResponse = Array<Session>;

export class Sessions extends Core.APIResource {
    constructor(client: Core.APIClient) {
        super(client);
    }

    /**
     * Create a new browser session
     */
    create(
        params: SessionCreateParams,
        options?: Core.RequestOptions
    ): Core.APIPromise<SessionCreateResponse> {
        return this.post<SessionCreateParams, SessionCreateResponse>('/sessions/start', {
            body: params,
            ...options,
        });
    }

    /**
     * Retrieve session information
     */
    retrieve(
        sessionId: string,
        options?: Core.RequestOptions
    ): Core.APIPromise<Session> {
        return this.get<unknown, Session>(`/sessions/${sessionId}/retrieve`, options);
    }

    /**
     * List sessions with optional filtering
     */
    list(
        query?: SessionListParams,
        options?: Core.RequestOptions
    ): Core.APIPromise<SessionListResponse> {
        return this.get<SessionListParams, SessionListResponse>('/sessions', {
            query,
            ...options,
        });
    }

    /**
     * Update session (mainly for requesting release)
     */
    update(
        sessionId: string,
        params: SessionUpdateParams,
        options?: Core.RequestOptions
    ): Core.APIPromise<Session> {
        return this.patch<SessionUpdateParams, Session>(`/sessions/${sessionId}`, {
            body: params,
            ...options,
        });
    }

    /**
     * Get session debug URLs and WebSocket info
     */
    debug(
        sessionId: string,
        options?: Core.RequestOptions
    ): Core.APIPromise<SessionDebugResponse> {
        return this.get<unknown, SessionDebugResponse>(`/sessions/${sessionId}/debug`, options);
    }

    /**
     * End a session
     */
    end(
        sessionId: string,
        options?: Core.RequestOptions
    ): Core.APIPromise<void> {
        return this.post<unknown, void>(`/sessions/${sessionId}/end`, options);
    }
} 