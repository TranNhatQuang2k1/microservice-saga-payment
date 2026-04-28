import type { Cache } from '../cache.js';

export class NoopCache implements Cache {
  async set(_key: string, _data: unknown, _ttlSeconds: number): Promise<void> {}
  async get<T>(_key: string, _bypass?: boolean): Promise<T | null> { return null; }
  async delete(_key: string): Promise<void> {}
}

export function newNoopCache(): NoopCache {
  return new NoopCache();
}
