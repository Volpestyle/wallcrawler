import { createClient } from 'redis';

const REDIS_ENDPOINT = process.env.REDIS_ENDPOINT!;

type RedisClient = ReturnType<typeof createClient>;

let redisClient: RedisClient | null = null;

/**
 * Initialize Redis client with error handling and reconnection strategy
 * Follows Context7 best practices for reliable Redis usage in Lambda
 */
export async function initRedisClient(): Promise<RedisClient> {
  if (!redisClient) {
    redisClient = createClient({
      socket: {
        host: REDIS_ENDPOINT,
        port: 6379,
        reconnectStrategy: (retries: number): number => {
          // Generate a random jitter between 0 – 200 ms
          const jitter = Math.floor(Math.random() * 200);
          // Delay is an exponential back off, (2^retries) * 50 ms, with a maximum value of 2000 ms
          const delay = Math.min(Math.pow(2, retries) * 50, 2000);
          return delay + jitter;
        },
      },
    })
      .on('error', (err: Error) => console.error('Redis Client Error:', err));

    await redisClient.connect();
  }
  return redisClient;
}