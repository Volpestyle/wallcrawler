import * as Core from './core';
import { SessionMetadata } from '@wallcrawler/util-ts';

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

export interface SessionCreateResponse {
    id: string;
    connectUrl: string;
}

export class Sessions extends Core.APIResource {
    constructor(client: Core.APIClient) {
        super(client);
    }

    async create(params: SessionCreateParams, options?: Core.RequestOptions): Promise<SessionCreateResponse> {
        const response = await this.request('/start-session', {
            method: 'POST',
            body: JSON.stringify(params),
            ...options,
        });
        const body = await response.json();
        if (!body.success) {
            throw new Error(body.message);
        }
        return body.data;
    }

    async retrieve(sessionId: string, options?: Core.RequestOptions): Promise<Session> {
        const response = await this.request(`/sessions/${sessionId}/retrieve`, {
            method: 'GET',
            ...options,
        });
        const body = await response.json();
        if (!body.success) {
            throw new Error(body.message);
        }
        return body.data;
    }

    async debug(sessionId: string, options?: Core.RequestOptions): Promise<{ debuggerUrl: string }> {
        const response = await this.request(`/sessions/${sessionId}/debug`, {
            method: 'GET',
            ...options,
        });
        const body = await response.json();
        if (!body.success) {
            throw new Error(body.message);
        }
        return body.data;
    }
} 