export type Headers = Record<string, string | undefined>;
export type DefaultQuery = Record<string, string | undefined>;
export type RequestOptions = {
    method?: string;
    headers?: Headers;
    body?: string;
};

export abstract class APIClient {
    constructor(protected options: { baseURL: string; timeout?: number; maxRetries?: number }) { }

    async request(path: string, opts: RequestOptions): Promise<Response> {
        const headers: Record<string, string> = {};

        // Merge headers, filtering out undefined values
        Object.entries({ ...this.defaultHeaders(), ...opts.headers }).forEach(([key, value]) => {
            if (value !== undefined) {
                headers[key] = value;
            }
        });

        return fetch(`${this.options.baseURL}${path}`, {
            method: opts.method || 'GET',
            headers,
            body: opts.body,
            signal: AbortSignal.timeout(this.options.timeout || 60000),
        });
    }

    protected defaultHeaders(): Headers {
        return {
            'Content-Type': 'application/json',
        };
    }
}

export abstract class APIResource {
    constructor(protected client: APIClient) { }

    protected async request(path: string, opts: RequestOptions): Promise<Response> {
        return this.client.request(path, opts);
    }
} 