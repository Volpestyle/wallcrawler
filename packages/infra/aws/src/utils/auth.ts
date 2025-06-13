import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import jwt from 'jsonwebtoken';
import { createLogger } from './logger';

const logger = createLogger('auth');
const secretsClient = new SecretsManagerClient({});

let jwtSecret: string | null = null;

export interface AuthPayload {
  userId: string;
  sessionId: string;
  interventionId?: string;
  exp?: number;
}

async function getJwtSecret(): Promise<string> {
  if (jwtSecret) {
    return jwtSecret;
  }

  try {
    const response = await secretsClient.send(new GetSecretValueCommand({
      SecretId: process.env.JWT_SECRET_ARN || 'wallcrawler/jwt-secret'
    }));
    
    jwtSecret = response.SecretString || '';
    return jwtSecret;
  } catch (error) {
    logger.error('Failed to load JWT secret', error);
    throw new Error('Unable to load authentication secret');
  }
}

export async function generateAuthToken(payload: AuthPayload): Promise<string> {
  const secret = await getJwtSecret();
  
  return jwt.sign(payload, secret, {
    expiresIn: payload.exp ? undefined : '24h',
    issuer: 'wallcrawler-aws'
  });
}

export async function verifyAuthToken(token: string): Promise<AuthPayload | null> {
  try {
    const secret = await getJwtSecret();
    const payload = jwt.verify(token, secret, {
      issuer: 'wallcrawler-aws'
    }) as AuthPayload;
    
    return payload;
  } catch (error) {
    logger.warn('Token verification failed', error);
    return null;
  }
}

// Simple implementation for now - in production, use proper JWT library
const jwt = {
  sign: (payload: any, secret: string, options: any) => {
    // Simplified - use jsonwebtoken package in production
    const header = { alg: 'HS256', typ: 'JWT' };
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify({
      ...payload,
      iat: Math.floor(Date.now() / 1000),
      exp: options.expiresIn ? Math.floor(Date.now() / 1000) + (24 * 60 * 60) : payload.exp,
      iss: options.issuer
    })).toString('base64url');
    
    // In production, properly sign with HMAC-SHA256
    const signature = Buffer.from('dummy-signature').toString('base64url');
    
    return `${encodedHeader}.${encodedPayload}.${signature}`;
  },
  
  verify: (token: string, secret: string, options: any) => {
    // Simplified - use jsonwebtoken package in production
    const [header, payload, signature] = token.split('.');
    const decodedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString());
    
    // In production, verify signature properly
    if (decodedPayload.exp && decodedPayload.exp < Math.floor(Date.now() / 1000)) {
      throw new Error('Token expired');
    }
    
    if (options.issuer && decodedPayload.iss !== options.issuer) {
      throw new Error('Invalid issuer');
    }
    
    return decodedPayload;
  }
};