# Utils/Auth Documentation

## Overview

Authentication utilities for JWE/JWT token management in WallCrawler services.

## High-Level Data Flow

1. **Secret Retrieval**: getJweSecret() from SSM or env.
2. **Token Creation**: JWETokenManager.createToken(payload, expiresIn) → Encrypted JWT.
3. **Token Verification**: verifyToken(token) → Decrypted payload.
4. **Validation**: validateToken(token, secret) → sessionId if valid.

Used in Lambda and containers for session auth.

## Low-Level Data Shapes

### JWEPayload

```ts
interface JWEPayload {
  sessionId: string;
  userId: string;
  browserOptions?: Record<string, unknown>;
  iat?: number;
  exp?: number;
  sub?: string;
}
```

### JWTPayload

```ts
interface JWTPayload {
  sessionId: string;
  exp: number;
  iat: number;
  userId?: string;
  browserOptions?: Record<string, unknown>;
}
```
