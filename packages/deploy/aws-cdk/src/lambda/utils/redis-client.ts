import { createClient, RedisClientType } from 'redis';

interface RedisConfig {
  socket: {
    host: string;
    port: number;
    reconnectStrategy?: (attempts: number) => Error | number;
    tls?: boolean;
  };
}

let redisClient: RedisClientType | null = null;

/**
 * Get or create a Redis client with TLS support
 */
export async function getRedisClient(): Promise<RedisClientType> {
  if (redisClient && redisClient.isReady) {
    return redisClient;
  }

  const endpoint = process.env.REDIS_ENDPOINT!;
  const isTlsEnabled = process.env.REDIS_TLS_ENABLED === 'true';
  const environment = process.env.ENVIRONMENT || 'development';

  const config: RedisConfig = {
    socket: {
      host: endpoint,
      port: 6379,
      reconnectStrategy: (attempts: number) => {
        if (attempts > 10) {
          return new Error('Redis connection failed after 10 attempts');
        }
        return Math.min(attempts * 100, 3000); // Exponential backoff with max 3s
      },
    },
  };

  // Configure TLS for production
  if (isTlsEnabled && environment !== 'development') {
    config.socket.tls = true;
    // ElastiCache uses AWS-managed certificates, no custom CA needed
  }

  redisClient = createClient(config);

  // Error handling
  redisClient.on('error', (err) => {
    console.error('Redis Client Error:', err);
  });

  redisClient.on('connect', () => {
    console.log(`Redis connected (TLS: ${isTlsEnabled})`);
  });

  await redisClient.connect();
  return redisClient;
}

/**
 * Safely disconnect Redis client
 */
export async function disconnectRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
