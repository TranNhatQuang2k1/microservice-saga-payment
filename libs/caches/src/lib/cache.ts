export interface Cache {
  /** bypass=true skips L1 and reads directly from the source (Redis). MemoryCache/NoopCache ignore it. */
  get<T>(key: string, bypass?: boolean): Promise<T | null>
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>
  delete(key: string): Promise<void>
}
