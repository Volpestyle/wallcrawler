import { EncryptJWT, jwtDecrypt, SignJWT } from 'jose';
import { createHash } from 'crypto';

interface JWEPayload {
    sessionId: string;
    userId: string;
    browserOptions?: Record<string, unknown>;
    iat?: number;
    exp?: number;
    sub?: string;
}

// Cache for JWE secret to avoid repeated fetches
let cachedJweSecret: string | null = null;

/**
 * Get JWE secret from AWS Secrets Manager or environment variable
 * @param secretArn - Optional ARN for Secrets Manager (Lambda use case)
 * @param envVarName - Optional environment variable name (ECS use case)
 */
export async function getJweSecret(
    secretArn?: string,
    envVarName: string = 'JWE_SECRET'
): Promise<string> {
    if (cachedJweSecret) return cachedJweSecret;

    // If no ARN provided, try environment variable (ECS case)
    if (!secretArn) {
        cachedJweSecret = process.env[envVarName];
        if (!cachedJweSecret) {
            throw new Error(`${envVarName} not found in environment`);
        }
        return cachedJweSecret;
    }

    // Lambda case: fetch from Secrets Manager
    const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
    const secretsClient = new SecretsManagerClient({});

    const response = await secretsClient.send(
        new GetSecretValueCommand({ SecretId: secretArn })
    );

    const secretValue = JSON.parse(response.SecretString || '{}');
    cachedJweSecret = secretValue.JWE_SECRET;

    if (!cachedJweSecret) {
        throw new Error('JWE_SECRET not found in secrets manager');
    }

    return cachedJweSecret;
}

/**
 * Simple symmetric key JWE operations for services that don't need KMS
 */
export class JWETokenManager {
    private symmetricKey: Uint8Array;

    constructor(jweSecret: string) {
        // Derive a symmetric key from the JWE secret
        this.symmetricKey = createHash('sha256').update(jweSecret).digest();
    }

    /**
     * Create an encrypted JWT (JWE) token using symmetric encryption
     */
    async createToken(payload: JWEPayload, expiresIn: string): Promise<string> {
        const exp = this.calculateExpiration(expiresIn);

        const jwt = await new EncryptJWT({
            ...payload,
            iat: Math.floor(Date.now() / 1000),
            exp,
        })
            .setProtectedHeader({
                alg: 'dir', // Direct key agreement (symmetric)
                enc: 'A256GCM', // Content encryption algorithm
            })
            .setIssuedAt()
            .setExpirationTime(exp)
            .encrypt(this.symmetricKey);

        return jwt;
    }

    /**
     * Decrypt and verify a JWE token
     */
    async verifyToken(token: string): Promise<JWEPayload> {
        const { payload } = await jwtDecrypt<JWEPayload>(token, this.symmetricKey, {
            clockTolerance: 30,
        });

        return payload;
    }

    private calculateExpiration(duration: string): number {
        const match = duration.match(/^(\d+)([smhd])$/);
        if (!match) {
            throw new Error('Invalid duration format');
        }

        const value = parseInt(match[1], 10);
        const unit = match[2];

        const multipliers: Record<string, number> = {
            s: 1,
            m: 60,
            h: 3600,
            d: 86400,
        };

        return Math.floor(Date.now() / 1000) + value * multipliers[unit];
    }
}

/**
 * Create JWT token for WebSocket authentication using SignJWT
 */
export async function createToken(payload: Record<string, unknown>, secret: string, expiresIn: string = '1h'): Promise<string> {
    const secretBytes = new TextEncoder().encode(secret);

    // Parse expiration time (e.g., '1h', '2h', '30m')
    const timeValue = parseInt(expiresIn.slice(0, -1));
    const timeUnit = expiresIn.slice(-1);
    let expirationTime: number;

    switch (timeUnit) {
        case 'h':
            expirationTime = timeValue * 60 * 60;
            break;
        case 'm':
            expirationTime = timeValue * 60;
            break;
        case 's':
            expirationTime = timeValue;
            break;
        default:
            expirationTime = 60 * 60; // Default to 1 hour
    }

    const jwt = await new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(Math.floor(Date.now() / 1000) + expirationTime)
        .sign(secretBytes);

    return jwt;
}

export type { JWEPayload }; 