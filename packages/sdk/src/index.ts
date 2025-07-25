import * as Core from './core';
import * as Errors from './error';
import {
    Sessions,
    Session,
    SessionCreateParams,
    SessionCreateResponse,
    SessionDebugResponse,
    SessionUpdateParams,
    SessionListParams,
    SessionListResponse,
} from './sessions';

export interface ClientOptions {
    apiKey?: string | undefined;
    baseURL?: string | null | undefined;
    timeout?: number | undefined;
    maxRetries?: number | undefined;
    defaultHeaders?: Core.Headers | undefined;
    defaultQuery?: Core.DefaultQuery | undefined;
    fetch?: Core.Fetch | undefined;
}

export class Wallcrawler extends Core.APIClient {
    apiKey: string;
    private _options: ClientOptions;

    constructor({
        baseURL = process.env['WALLCRAWLER_BASE_URL'] || 'https://api.wallcrawler.dev/v1',
        apiKey = process.env['WALLCRAWLER_API_KEY'],
        timeout = 60000,
        maxRetries = 2,
        fetch: overriddenFetch,
        ...opts
    }: ClientOptions = {}) {
        if (!apiKey) {
            throw new Errors.WallcrawlerError('WALLCRAWLER_API_KEY is required');
        }

        const finalBaseURL = baseURL || 'https://api.wallcrawler.dev/v1';
        super({
            baseURL: finalBaseURL,
            timeout,
            maxRetries,
            fetch: overriddenFetch
        });

        this._options = {
            apiKey,
            timeout,
            maxRetries,
            ...opts,
            baseURL: finalBaseURL
        };
        this.apiKey = apiKey;
    }

    sessions: Sessions = new Sessions(this);

    protected override defaultHeaders(opts: Core.FinalRequestOptions): Core.Headers {
        return {
            ...super.defaultHeaders(opts),
            'x-wc-api-key': this.apiKey,
            ...this._options.defaultHeaders,
        };
    }

    protected override defaultQuery(): Core.DefaultQuery | undefined {
        return this._options.defaultQuery;
    }

    static WallcrawlerError = Errors.WallcrawlerError;
    static APIError = Errors.APIError;
    static APIConnectionError = Errors.APIConnectionError;
    static APIConnectionTimeoutError = Errors.APIConnectionTimeoutError;
    static APIUserAbortError = Errors.APIUserAbortError;
    static AuthenticationError = Errors.AuthenticationError;
    static PermissionDeniedError = Errors.PermissionDeniedError;
    static NotFoundError = Errors.NotFoundError;
    static ConflictError = Errors.ConflictError;
    static UnprocessableEntityError = Errors.UnprocessableEntityError;
    static RateLimitError = Errors.RateLimitError;
    static InternalServerError = Errors.InternalServerError;
}

export default Wallcrawler;

// Export types and classes
export {
    Sessions,
    Session,
    SessionCreateParams,
    SessionCreateResponse,
    SessionDebugResponse,
    SessionUpdateParams,
    SessionListParams,
    SessionListResponse,
};
export {
    WallcrawlerError,
    APIError,
    APIConnectionError,
    APIConnectionTimeoutError,
    APIUserAbortError,
    AuthenticationError,
    PermissionDeniedError,
    NotFoundError,
    ConflictError,
    UnprocessableEntityError,
    RateLimitError,
    InternalServerError,
} from './error';

export {
    APIPromise,
    APIClient,
    APIResource
} from './core';

export type {
    Headers,
    DefaultQuery,
    RequestOptions,
    FinalRequestOptions,
} from './core'; 