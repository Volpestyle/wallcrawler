import * as Core from './core';
import * as Errors from './error';
import { Sessions, Session, SessionCreateParams, SessionCreateResponse } from './sessions';

export interface ClientOptions {
    apiKey?: string | undefined;
    baseURL?: string | null | undefined;
    timeout?: number | undefined;
    maxRetries?: number | undefined;
    defaultHeaders?: Core.Headers | undefined;
    defaultQuery?: Core.DefaultQuery | undefined;
}

export class Wallcrawler extends Core.APIClient {
    apiKey: string;
    private _options: ClientOptions;

    constructor({
        baseURL = process.env['WALLCRAWLER_BASE_URL'] || 'https://api.yourdomain.com/v1',
        apiKey = process.env['WALLCRAWLER_API_KEY'],
        ...opts
    }: ClientOptions = {}) {
        if (!apiKey) {
            throw new Errors.WallcrawlerError('WALLCRAWLER_API_KEY is required');
        }

        const finalBaseURL = baseURL || 'https://api.yourdomain.com/v1';
        super({ baseURL: finalBaseURL, timeout: opts.timeout ?? 60000, maxRetries: opts.maxRetries ?? 2 });
        this._options = { apiKey, ...opts, baseURL: finalBaseURL };
        this.apiKey = apiKey;
    }

    sessions: Sessions = new Sessions(this);

    protected override defaultHeaders(): Core.Headers {
        return {
            ...super.defaultHeaders(),
            'X-Wallcrawler-API-Key': this.apiKey,
            ...this._options.defaultHeaders,
        };
    }

    static WallcrawlerError = Errors.WallcrawlerError;
}

export default Wallcrawler;
export { Sessions, Session, SessionCreateParams, SessionCreateResponse };
export { WallcrawlerError } from './error'; 