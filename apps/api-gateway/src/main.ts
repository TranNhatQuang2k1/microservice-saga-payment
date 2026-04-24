import Fastify from 'fastify';
import { app } from './app/app';
import { newRedisCache, newCache } from './cache/redis/client';
import { loadRedisConfig } from '@org/configurations';

const host = process.env.HOST ?? 'localhost';
const port = process.env.PORT ? Number(process.env.PORT) : 3008;

const server = Fastify({ logger: true });

// --- smoke test Redis cache ---
async function testCache() {
  const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const cache = newRedisCache([REDIS_URL]);

  await cache.set('hello', { msg: 'world', ts: Date.now() }, 60_000);
  const hit = await cache.get<{ msg: string; ts: number }>('hello');
  console.log('[cache] set/get OK →', hit);

  await cache.delete('hello');
  const miss = await cache.get('hello');
  console.log('[cache] delete OK → miss:', miss);
}

testCache().catch((err) => console.error('[cache] error:', err));

// --- smoke test Redis cache từ RedisConfiguration ---
async function testCacheFromConfig() {
  const cfg   = loadRedisConfig(process.env);
  const cache = newCache(cfg);

  await cache.set('cfg-hello', { msg: 'from config', ts: Date.now() }, 60_000);
  const hit = await cache.get<{ msg: string; ts: number }>('cfg-hello');
  console.log('[cache-cfg] set/get OK →', hit);

  await cache.delete('cfg-hello');
  const miss = await cache.get('cfg-hello');
  console.log('[cache-cfg] delete OK → miss:', miss);
}

testCacheFromConfig().catch((err) => console.error('[cache-cfg] error:', err));

server.register(app);

server.listen({ port, host }, (err) => {
  if (err) {
    server.log.error(err);
    process.exit(1);
  } else {
    console.log(`[ ready ] http://${host}:${port}`);
  }
});
