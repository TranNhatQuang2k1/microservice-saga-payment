// ---------------------------------------------------------------------------
// noop/noop.ts — No-operation cache (do nothing)
// Tương đương convoy/cache/noop/noop.go
//
// NoopCache implement Cache interface nhưng không làm gì cả.
//
// TẠI SAO CẦN NOOP CACHE?
//   - Testing: inject NoopCache thay vì Redis thật → không cần infrastructure
//   - Feature flag: tắt cache runtime mà không thay đổi code caller
//   - Local dev: không muốn setup Redis nhưng code vẫn chạy được
//   - Tương đương null object pattern — tránh null check ở mọi nơi dùng cache
// ---------------------------------------------------------------------------

import type { Cache } from '../cache.js';

// ---------------------------------------------------------------------------
// NoopCache — tất cả methods đều là no-op (không làm gì, không throw).
// Tương đương NoopCache struct trong noop/noop.go.
// ---------------------------------------------------------------------------
export class NoopCache implements Cache {
  async set(_key: string, _data: unknown, _ttlMs: number): Promise<void> {
    // intentionally empty
  }

  async get<T>(_key: string): Promise<T | null> {
    return null;
  }

  async delete(_key: string): Promise<void> {
    // intentionally empty
  }
}

// ---------------------------------------------------------------------------
// newNoopCache — factory function, tương đương NewNoopCache() trong Go.
// ---------------------------------------------------------------------------
export function newNoopCache(): NoopCache {
  return new NoopCache();
}
