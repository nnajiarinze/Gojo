import IORedisLib from 'ioredis';
const IORedis = IORedisLib.default ?? IORedisLib;
import { env } from './env.js';

export const redis = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  retryStrategy(times: number) {
    if (times > 3) return null; // Stop retrying after 3 attempts
    return Math.min(times * 500, 3000);
  },
});

redis.on('error', (err: Error) => {
  console.warn('[Redis] Connection error (non-fatal):', err.message);
});

export const redisSubscriber = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  retryStrategy(times: number) {
    if (times > 3) return null;
    return Math.min(times * 500, 3000);
  },
});

redisSubscriber.on('error', (err: Error) => {
  console.warn('[Redis Subscriber] Connection error (non-fatal):', err.message);
});

export async function connectRedis(): Promise<boolean> {
  try {
    await redis.connect();
    await redisSubscriber.connect();
    console.log('[Redis] Connected');
    return true;
  } catch (err) {
    console.warn('[Redis] Not available — queues will not work until Redis is running');
    return false;
  }
}
