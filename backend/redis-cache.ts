/**
 * Redis cache for Feed/API (bxr stack). TTL-based cache for latest feed keys.
 */

import Redis from "ioredis";

const DEFAULT_TTL_SEC = 10;
let client: Redis | null = null;

export function getRedis(): Redis | null {
  const url = (process.env.REDIS_URL ?? "").trim();
  if (!url) return null;
  if (!client) {
    try {
      client = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: true });
    } catch {
      return null;
    }
  }
  return client;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSec = DEFAULT_TTL_SEC): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.setex(key, ttlSec, JSON.stringify(value));
  } catch (err) {
    console.warn("[redis] set failed:", err instanceof Error ? err.message : err);
  }
}

export const CACHE_KEYS = {
  SPACE_WEATHER_LATEST: "feed:space-weather:latest",
  MMS_LATEST: "feed:mms:latest",
  AURORA_LATEST: "feed:aurora:latest",
} as const;

export function isRedisConfigured(): boolean {
  return (process.env.REDIS_URL ?? "").trim() !== "";
}
