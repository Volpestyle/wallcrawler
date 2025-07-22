import { createClient } from 'redis';

type RedisClient = ReturnType<typeof createClient>;

let redisClient: RedisClient | null = null;

export interface RedisConfig {
    endpoint: string;
    tlsEnabled: boolean;
    password?: string;
    port?: number;
}

/**
 * Initialize Redis client with error handling and reconnection strategy
 * Supports both TLS and non-TLS connections based on configuration
 */
export async function initRedisClient(config?: RedisConfig): Promise<RedisClient> {
    // Use config parameter or fall back to environment variables
    const redisConfig = config || {
        endpoint: process.env.REDIS_ENDPOINT!,
        tlsEnabled: process.env.REDIS_TLS_ENABLED === 'true',
        password: process.env.REDIS_PASSWORD,
        port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT) : 6379,
    };

    if (!redisClient) {
        const clientConfig = redisConfig.tlsEnabled
            ? {
                // TLS configuration for production
                url: `rediss://${redisConfig.endpoint}:${redisConfig.port || 6379}`,
                socket: {
                    tls: true as const,
                    host: redisConfig.endpoint,
                    port: redisConfig.port || 6379,
                    rejectUnauthorized: false,
                    reconnectStrategy: (retries: number): number => {
                        // Generate a random jitter between 0 – 200 ms
                        const jitter = Math.floor(Math.random() * 200);
                        // Delay is an exponential back off, (2^retries) * 50 ms, with a maximum value of 2000 ms
                        const delay = Math.min(Math.pow(2, retries) * 50, 2000);
                        return delay + jitter;
                    },
                },
                password: redisConfig.password,
            }
            : {
                // Non-TLS configuration for development
                socket: {
                    host: redisConfig.endpoint,
                    port: redisConfig.port || 6379,
                    reconnectStrategy: (retries: number): number => {
                        // Generate a random jitter between 0 – 200 ms
                        const jitter = Math.floor(Math.random() * 200);
                        // Delay is an exponential back off, (2^retries) * 50 ms, with a maximum value of 2000 ms
                        const delay = Math.min(Math.pow(2, retries) * 50, 2000);
                        return delay + jitter;
                    },
                },
                password: redisConfig.password,
            };

        redisClient = createClient(clientConfig)
            .on('error', (err: Error) => console.error('Redis Client Error:', err))
            .on('connect', () => console.log('Redis client connected'))
            .on('reconnecting', () => console.log('Redis client reconnecting'))
            .on('ready', () => console.log('Redis client ready'));

        await redisClient.connect();
        console.log(`Redis connected to ${redisConfig.endpoint} (TLS: ${redisConfig.tlsEnabled})`);
    }
    return redisClient;
}

/**
 * Get existing Redis client or throw error if not initialized
 */
export function getRedisClient(): RedisClient {
    if (!redisClient) {
        throw new Error('Redis client not initialized. Call initRedisClient() first.');
    }
    return redisClient;
}

/**
 * Close Redis connection
 */
export async function closeRedisClient(): Promise<void> {
    if (redisClient) {
        await redisClient.quit();
        redisClient = null;
    }
}

export type { RedisClient }; 