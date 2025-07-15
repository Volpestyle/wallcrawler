import { EncryptJWT, jwtDecrypt } from 'jose';
import { createHash } from 'crypto';

interface JWEPayload {
  sessionId: string;
  userId: string;
  browserOptions?: Record<string, unknown>;
  iat?: number;
  exp?: number;
  sub?: string;
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
