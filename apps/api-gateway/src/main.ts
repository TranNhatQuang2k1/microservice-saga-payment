import Fastify from 'fastify';
import { app } from './app/app';
import { newCache } from '@org/caches';
import { loadRedisConfig, loadServerConfig } from '@org/configurations';

const serverCfg = loadServerConfig();
const host = process.env.HOST ?? 'localhost';
const port = serverCfg.http.port;

const server = Fastify({ logger: true });

async function testCacheFromConfig() {
  const cache = newCache(loadRedisConfig());

  let t = performance.now();
  await cache.set('cfg-hello', { msg: 'from config', ts: Date.now() }, 60);
  console.log(`[cache-cfg] set       → ${(performance.now() - t).toFixed(2)}ms`);

  t = performance.now();
  const hit = await cache.get<{ msg: string; ts: number }>('cfg-hello');
  console.log(`[cache-cfg] get (hit) → ${(performance.now() - t).toFixed(2)}ms`, hit);

  t = performance.now();
  const hitRam = await cache.get<{ msg: string; ts: number }>('cfg-hello');
  console.log(`[cache] get (L1 hit)  → ${(performance.now() - t).toFixed(2)}ms`, hitRam);

  t = performance.now();
  await cache.delete('cfg-hello');
  console.log(`[cache-cfg] delete    → ${(performance.now() - t).toFixed(2)}ms`);

  t = performance.now();
  const miss = await cache.get('cfg-hello');
  console.log(`[cache-cfg] get (miss)→ ${(performance.now() - t).toFixed(2)}ms`, miss);
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
