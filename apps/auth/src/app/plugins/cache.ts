import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { newRedisCacheFromClient, newMemoryCache, newNoopCache } from '@org/caches';
import type { Cache } from '@org/caches';
import type { RedisConfiguration } from '@org/configurations';
import { newClientFromConfig } from '@order-payment-platform/infrastructure-redis';

declare module 'fastify' {
  interface FastifyInstance {
    cache: Cache;
  }
}

export interface CachePluginOptions {
  backend: 'redis' | 'memory' | 'noop';
  /** Required when backend === 'redis' */
  redis?: RedisConfiguration;
  /** Optional tuning for memory backend */
  memory?: { maxSize?: number };
}

const cachePlugin: FastifyPluginAsync<CachePluginOptions> = async (fastify, opts) => {
  let cache: Cache;

  switch (opts.backend) {
    case 'redis': {
      if (!opts.redis) {
        throw new Error('cache plugin: redis config is required when backend is "redis"');
      }

      // newClientFromConfig already calls attachListeners internally (connect/ready/error/close/reconnecting)
      const { client } = newClientFromConfig(opts.redis);
      cache = newRedisCacheFromClient(client);

      fastify.addHook('onClose', async () => {
        fastify.log.info('Closing Redis connection...');
        await client.quit();
        fastify.log.info('Redis connection closed');
      });

      break;
    }

    case 'memory':
      cache = newMemoryCache(opts.memory?.maxSize);
      break;

    case 'noop':
      cache = newNoopCache();
      break;

    default:
      throw new Error(`cache plugin: unknown backend "${(opts as CachePluginOptions).backend}"`);
  }

  fastify.decorate('cache', cache);
};

export default fp(cachePlugin, {
  name: 'cache',
});
