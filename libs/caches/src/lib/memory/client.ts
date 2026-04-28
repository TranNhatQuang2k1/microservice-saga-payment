import { lru } from 'tiny-lru';
import { pack, unpack } from 'msgpackr';
import type { Cache } from '../cache.js';

const CACHE_SIZE     = 128_000;
const DEFAULT_TTL_MS = 60_000;

export class MemoryCache implements Cache {
  private readonly cache: ReturnType<typeof lru<Buffer>>;

  constructor(maxSize = CACHE_SIZE) {
    this.cache = lru<Buffer>(maxSize, DEFAULT_TTL_MS);
  }

  async set(key: string, data: unknown, _ttlSeconds: number): Promise<void> {
    this.cache.set(key, pack(data));
  }

  async get<T>(key: string, _bypass?: boolean): Promise<T | null> {
    const raw = this.cache.get(key);
    if (raw === undefined) return null;
    return unpack(raw) as T;
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
  }
}

export function newMemoryCache(maxSize?: number): MemoryCache {
  return new MemoryCache(maxSize);
}
