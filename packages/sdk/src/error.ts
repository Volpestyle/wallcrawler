import type { Headers } from "./core";

export class WallcrawlerError extends Error {
    constructor(message?: string) {
        super(message);
        this.name = 'WallcrawlerError';
    }

    static generate(status?: number, error?: Error, message?: string, headers?: any): APIError {
        if (!status) {
            return new APIConnectionError({ message, cause: error });
        }

        const data = error || {};
        if (status === 401) return new APIError({ status, message, headers });
        if (status === 403) return new APIError({ status, message, headers });
        if (status === 404) return new APIError({ status, message, headers });
        if (status === 409) return new APIError({ status, message, headers });
        if (status === 422) return new APIError({ status, message, headers });
        if (status === 429) return new APIError({ status, message, headers });
        if (status >= 500) return new APIError({ status, message, headers });

        return new APIError({ status, message, headers });
    }
}

export class APIError extends WallcrawlerError {
    readonly status: number | undefined;
    readonly headers: Headers | undefined;
    readonly error: Object | undefined;

    constructor({
        message,
        status,
        headers,
        error,
    }: {
        message?: string;
        status?: number;
        headers?: Headers;
        error?: Object;
    }) {
        super(`${APIError.makeMessage(message, status, error)}`);
        this.name = 'APIError';
        this.status = status;
        this.headers = headers;
        this.error = error;
    }

    private static makeMessage(message: string | undefined, status: number | undefined, error: any) {
        const msg =
            message ||
            error?.message ||
            (typeof error === 'string' ? error : JSON.stringify(error)) ||
            'Unknown error occurred';

        if (status && status !== 200) {
            return `${status} ${msg}`;
        }

        return msg;
    }

    static generate(status: number | undefined, error: Error | undefined, message: string | undefined, headers: Headers | undefined): APIError {
        if (!status) {
            return new APIConnectionError({ message, cause: error });
        }

        if (status === 401) return new APIError({ status, message, headers });
        if (status === 403) return new APIError({ status, message, headers });
        if (status === 404) return new APIError({ status, message, headers });
        if (status === 409) return new APIError({ status, message, headers });
        if (status === 422) return new APIError({ status, message, headers });
        if (status === 429) return new APIError({ status, message, headers });
        if (status >= 500) return new APIError({ status, message, headers });

        return new APIError({ status, message, headers });
    }
}

export class APIConnectionError extends APIError {
    readonly cause?: Error | undefined;

    constructor({ message, cause }: { message?: string; cause?: Error | undefined }) {
        super({ message: message ?? 'Connection error.' });
        this.name = 'APIConnectionError';
        this.cause = cause;
    }
}

export class APIConnectionTimeoutError extends APIConnectionError {
    constructor({ message }: { message?: string } = {}) {
        super({ message: message ?? 'Request timed out.' });
        this.name = 'APIConnectionTimeoutError';
    }
}

export class APIUserAbortError extends APIError {
    constructor({ message }: { message?: string } = {}) {
        super({ message: message ?? 'Request was aborted by the user' });
        this.name = 'APIUserAbortError';
    }
}

export class AuthenticationError extends APIError {
    constructor({ message, ...props }: { message?: string; status?: number; headers?: Headers }) {
        super({ message: message ?? 'Authentication failed', ...props });
        this.name = 'AuthenticationError';
    }
}

export class PermissionDeniedError extends APIError {
    constructor({ message, ...props }: { message?: string; status?: number; headers?: Headers }) {
        super({ message: message ?? 'Permission denied', ...props });
        this.name = 'PermissionDeniedError';
    }
}

export class NotFoundError extends APIError {
    constructor({ message, ...props }: { message?: string; status?: number; headers?: Headers }) {
        super({ message: message ?? 'The requested resource was not found', ...props });
        this.name = 'NotFoundError';
    }
}

export class ConflictError extends APIError {
    constructor({ message, ...props }: { message?: string; status?: number; headers?: Headers }) {
        super({ message: message ?? 'A conflict occurred', ...props });
        this.name = 'ConflictError';
    }
}

export class UnprocessableEntityError extends APIError {
    constructor({ message, ...props }: { message?: string; status?: number; headers?: Headers }) {
        super({ message: message ?? 'Unprocessable entity', ...props });
        this.name = 'UnprocessableEntityError';
    }
}

export class RateLimitError extends APIError {
    constructor({ message, ...props }: { message?: string; status?: number; headers?: Headers }) {
        super({ message: message ?? 'Rate limit exceeded', ...props });
        this.name = 'RateLimitError';
    }
}

export class InternalServerError extends APIError {
    constructor({ message, ...props }: { message?: string; status?: number; headers?: Headers }) {
        super({ message: message ?? 'Internal server error', ...props });
        this.name = 'InternalServerError';
    }
}
