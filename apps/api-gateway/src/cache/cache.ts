// ---------------------------------------------------------------------------
// cache.ts — Cache interface + factory
// Tương đương convoy/cache/cache.go
//
// Cache interface định nghĩa 3 operations cơ bản: set/get/delete.
// NewCache() là factory tạo RedisCache từ RedisConfiguration — entry point
// dùng trong ứng dụng thực tế.
// ---------------------------------------------------------------------------

import type { RedisConfiguration } from '@org/configurations';
import { newClientFromConfig } from '@order-payment-platform/infrastructure-redis';
import { newRedisCacheFromClient } from './redis/client.js';

// ---------------------------------------------------------------------------
// Cache interface
// Tương đương Cache interface trong cache.go.
// 
// Set    — lưu data vào cache với TTL (milliseconds). TTL=0 → không expire.
// Get    — lấy data ra, deserialize vào `data`. Trả về null nếu cache miss.
// Delete — xoá key khỏi cache.
// ---------------------------------------------------------------------------
export interface Cache {
  set(key: string, data: unknown, ttlMs: number): Promise<void>;
  get<T>(key: string): Promise<T | null>;
  delete(key: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// newCache
// Factory tạo RedisCache từ RedisConfiguration.
// Tương đương NewCache() trong cache.go.
//
// Flow: RedisConfiguration → newClientFromConfig → ioredis client
//       → newRedisCacheFromClient → RedisCache
// ---------------------------------------------------------------------------
export function newCache(cfg: RedisConfiguration): Cache {
  const rdb = newClientFromConfig(cfg);
  return newRedisCacheFromClient(rdb.client);
}
