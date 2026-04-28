import * as path from 'path';
import type { FastifyInstance } from 'fastify';
import AutoLoad from '@fastify/autoload';
import cachePlugin from './plugins/cache';
import requireAuth from './plugins/require-auth';
import postgresPlugin from './plugins/postgres';
import { loadAuthConfig, loadRedisConfig } from '@org/configurations';
import { loadDatabaseConfig } from '@org/configurations';
import fp from 'fastify-plugin';
import { PgUserRepository } from './repository/pg_user_repo'; // Đường dẫn tới file implement Repo của cậu

export async function app(fastify: FastifyInstance) {
  const authCfg = loadAuthConfig();

  // cache.ts — registered first so fastify.cache is available to all other plugins
  const cacheBackend = (process.env.CACHE_BACKEND as 'redis' | 'memory') ?? 'redis'
  fastify.register(cachePlugin, {
    backend: cacheBackend,
    redis: cacheBackend === 'redis' ? loadRedisConfig() : undefined,
  });

  fastify.register(postgresPlugin, {
    config : loadDatabaseConfig()
  });

  // 2. KHỞI TẠO VÀ GẮN userRepo VÀO FASTIFY
  fastify.register(fp(async (instance) => {
    const repo = new PgUserRepository(instance.pg);
    
    instance.decorate('userRepo', repo);
  }));

  // sensible.ts — no deps, safe to auto-load
  // cache.ts / require-auth.ts / postgres.ts — excluded; managed manually above/below
  fastify.register(AutoLoad, {
    dir: path.join(__dirname, 'plugins'),
    ignorePattern: /require-auth|cache|postgres/,
    options: {},
  });

  fastify.register(requireAuth, {
    jwtOptions: {
      secret:        authCfg.jwt.secret,
      expiry:        authCfg.jwt.expiry,
      refreshSecret: authCfg.jwt.refreshSecret,
      refreshExpiry: authCfg.jwt.refreshExpiry,
    },
  });

  fastify.register(AutoLoad, {
    dir: path.join(__dirname, 'routes'),
    options: {},
  });
}
