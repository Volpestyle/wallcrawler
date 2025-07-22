import { jwtVerify } from 'jose';

interface JWTPayload {
    sessionId: string;
    exp: number;
    iat: number;
    userId?: string;
    browserOptions?: Record<string, unknown>;
}

/**
 * Validate JWT token and extract session ID
 * This is a shared utility that can be used by both Lambda and containers
 */
export async function validateToken(token: string, secret: string): Promise<string> {
    try {
        const encoder = new TextEncoder();
        const { payload } = await jwtVerify<JWTPayload>(token, encoder.encode(secret));

        if (!payload.sessionId) {
            throw new Error('Session ID not found in token');
        }

        return payload.sessionId;
    } catch (error) {
        throw new Error(`Invalid token: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Validate JWT token and return full payload
 */
export async function validateTokenWithPayload(token: string, secret: string): Promise<JWTPayload> {
    try {
        const encoder = new TextEncoder();
        const { payload } = await jwtVerify<JWTPayload>(token, encoder.encode(secret));

        if (!payload.sessionId) {
            throw new Error('Session ID not found in token');
        }

        return payload;
    } catch (error) {
        throw new Error(`Invalid token: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Extract token from URL query parameters or headers
 */
export function extractToken(url?: string, headers?: Record<string, string>): string | null {
    // Try URL query parameters first
    if (url) {
        const urlParams = new URLSearchParams(url.split('?')[1]);
        const token = urlParams.get('token');
        if (token) return token;
    }

    // Try headers
    if (headers) {
        const authHeader = headers.authorization || headers.Authorization;
        if (authHeader?.startsWith('Bearer ')) {
            return authHeader.replace('Bearer ', '');
        }
    }

    return null;
}

export type { JWTPayload }; 