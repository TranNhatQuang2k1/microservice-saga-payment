import { Redis, Cluster } from 'ioredis';
import { lru } from 'tiny-lru';
import { Packr } from 'msgpackr';
import type { Cache } from '../cache.js';
import type { RedisConfiguration } from '@org/configurations';
import { newClientFromConfig } from '@order-payment-platform/infrastructure-redis';

// useRecords=false — required for cross-service/cross-process compatibility.
// useRecords=true encodes field names as per-instance index → only the same Packr instance can decode.
const packr = new Packr({ useRecords: false });

const CACHE_SIZE   = 128_000;
const LOCAL_TTL_MS = 60_000; // L1 TTL (1 min); Redis L2 uses caller-supplied ttlSeconds

export class RedisCache implements Cache {
  private readonly client: Redis | Cluster;
  private readonly local: ReturnType<typeof lru<Buffer>>;

  constructor(client: Redis | Cluster, localMaxSize = CACHE_SIZE) {
    this.client = client;
    this.local  = lru<Buffer>(localMaxSize, LOCAL_TTL_MS);
  }

  async set(key: string, data: unknown, ttlSeconds: number): Promise<void> {
    const bytes = packr.pack(data);

    if (ttlSeconds > 0) {
      await this.client.set(key, bytes, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, bytes);
    }

    this.local.set(key, bytes);
  }

  async get<T>(key: string, bypass = false): Promise<T | null> {
    if (!bypass) {
      const localHit = this.local.get(key);
      if (localHit !== undefined) return packr.unpack(localHit) as T;
    }

    const raw = await this.client.getBuffer(key);
    if (raw === null) return null;

    if (!bypass) this.local.set(key, raw);
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

function parseRedisUrl(addr: string): { host: string; port: number; password?: string; tls?: object } {
  const isTls = addr.startsWith('rediss://');
  const url   = new URL(addr.startsWith('redis') ? addr : `redis://${addr}`);
  return {
    host:     url.hostname || '127.0.0.1',
    port:     parseInt(url.port || '6379', 10),
    password: url.password || undefined,
    tls:      isTls ? {} : undefined,
  };
}
