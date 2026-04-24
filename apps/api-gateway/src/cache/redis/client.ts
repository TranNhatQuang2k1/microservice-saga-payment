import { Redis, Cluster } from 'ioredis';
import { lru } from 'tiny-lru';
import { Packr } from 'msgpackr';
import type { Cache } from '../cache';
import type { RedisConfiguration } from '@org/configurations';
import { newClientFromConfig } from '@order-payment-platform/infrastructure-redis';

// useRecords=false (default msgpack) — required for cross-service/cross-process compatibility.
// useRecords=true encodes field names as per-instance index → only the same Packr instance can decode.
// Since Redis is shared between services, standard msgpack must be used so any service can unpack.
const packr = new Packr({ useRecords: false });

const CACHE_SIZE   = 128_000;
const LOCAL_TTL_MS = 60_000; // L1 TTL — callers must pass ttlMs > LOCAL_TTL_MS, else L1 may serve stale

export class RedisCache implements Cache {
  private readonly client: Redis | Cluster;
  private readonly local: ReturnType<typeof lru<Buffer>>;

  constructor(client: Redis | Cluster, localMaxSize = CACHE_SIZE) {
    this.client = client;
    this.local  = lru<Buffer>(localMaxSize, LOCAL_TTL_MS);
  }

  async set(key: string, data: unknown, ttlMs: number): Promise<void> {
    const bytes = packr.pack(data);

    if (ttlMs > 0) {
      const ttlSec = Math.max(1, Math.round(ttlMs / 1000));
      await this.client.set(key, bytes, 'EX', ttlSec);
    } else {
      await this.client.set(key, bytes);
    }

    // Write-through: cùng Buffer vào L1 — không marshal lại lần 2
    this.local.set(key, bytes);
  }

  async get<T>(key: string): Promise<T | null> {
    const localHit = this.local.get(key);
    if (localHit !== undefined) {
      return packr.unpack(localHit) as T;
    }

    const raw = await this.client.getBuffer(key);
    if (raw === null) return null;

    this.local.set(key, raw);
    return packr.unpack(raw) as T;
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
    this.local.delete(key);
  }
}

export function newRedisCacheFromClient(client: Redis | Cluster): RedisCache {
  return new RedisCache(client);
}

export function newCache(cfg: RedisConfiguration): Cache {
  const rdb = newClientFromConfig(cfg);
  return newRedisCacheFromClient(rdb.client);
}

export function newRedisCache(addresses: string[]): RedisCache {
  if (addresses.length === 0) throw new Error('redis addresses cannot be empty');

  let client: Redis | Cluster;
  if (addresses.length === 1) {
    client = new Redis(parseRedisUrl(addresses[0]));
  } else {
    const nodes = addresses.map(parseRedisUrl);
    client = new Cluster(nodes.map((o) => ({ host: o.host, port: o.port })), {
      redisOptions: { password: nodes[0]?.password, tls: nodes[0]?.tls },
    });
  }

  return new RedisCache(client);
}

// Hỗ trợ: redis://host:port  rediss://host:port  redis://:pass@host:port
function parseRedisUrl(addr: string): { host: string; port: number; password?: string; tls?: object } {
  const isTls  = addr.startsWith('rediss://');
  const url    = new URL(addr.startsWith('redis') ? addr : `redis://${addr}`);
  return {
    host:     url.hostname || '127.0.0.1',
    port:     parseInt(url.port || '6379', 10),
    password: url.password || undefined,
    tls:      isTls ? {} : undefined,
  };
}
