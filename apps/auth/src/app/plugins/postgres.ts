import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { Pool } from 'pg';
// eslint-disable-next-line @nx/enforce-module-boundaries
import type { PoolConfig, QueryResult, QueryResultRow } from 'pg';
import { buildDatabaseDsn, type DatabaseConfiguration, type ReadReplicaConfiguration } from '@org/configurations';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PostgresDb {
  /** Primary pool — dùng cho INSERT/UPDATE/DELETE và transactional reads */
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;

  /** Read pool — random replica nếu có, fallback về primary */
  readQuery<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;

  /** Raw primary pool — dùng khi cần transaction (pool.connect() → client.query()) */
  pool: Pool;
}

declare module 'fastify' {
  interface FastifyInstance {
    pg: PostgresDb;
  }
}

export interface PostgresPluginOptions {
  config: DatabaseConfiguration; 
}

// ---------------------------------------------------------------------------
// Pool factory — mirrors parseDBConfig() in postgres.go
// ---------------------------------------------------------------------------

const DEFAULT_MAX_CONN = 20;

function buildPool(dsn: string, maxOpenConn: number, maxIdleConn: number): Pool {
  const max = maxOpenConn > 0 ? maxOpenConn : DEFAULT_MAX_CONN;
  const minIdle = maxIdleConn > 0 ? maxIdleConn : Math.max(2, Math.floor(max / 4));

  const cfg: PoolConfig = {
    connectionString:       dsn,
    max,
    min:                    minIdle,
    idleTimeoutMillis:      30_000,  // remove idle connection after 30s
    connectionTimeoutMillis: 5_000, // throw after 5s waiting for a free slot
    allowExitOnIdle:        false,  // keep pool alive for the lifetime of the app
  };

  return new Pool(cfg);
}

function buildReplicaPool(replica: ReadReplicaConfiguration): Pool {
  const dsn = replica.dsn
    || `${replica.scheme || 'postgres'}://${encodeURIComponent(replica.username)}:${encodeURIComponent(replica.password)}@${replica.host}:${replica.port || 5432}/${replica.database}`;

  return buildPool(dsn, replica.maxOpenConn, replica.maxIdleConn);
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const postgresPlugin: FastifyPluginAsync<PostgresPluginOptions> = async (fastify, opts) => {
  const { config } = opts;

  const primaryPool = buildPool(
    buildDatabaseDsn(config),
    config.maxOpenConnections,
    config.maxIdleConnections,
  );

  // mirrors ping() in postgres.go — fail fast if DB unreachable at boot
  try {
    await primaryPool.query('SELECT 1');
    fastify.log.info('[postgres] primary connected');

    // ========================================================
    // 2. THÊM ĐOẠN NÀY: TỰ ĐỘNG TẠO BẢNG (AUTO-MIGRATE)
    // ========================================================
    const initSchemaQuery = `
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

      CREATE TABLE IF NOT EXISTS users (
          uid        UUID PRIMARY KEY DEFAULT uuid_generate_v4(), -- implicit B-tree index via PK
          first_name VARCHAR(100) NOT NULL,
          last_name  VARCHAR(100) NOT NULL,
          email      VARCHAR(255) UNIQUE NOT NULL,               -- implicit B-tree index via UNIQUE
          password   VARCHAR(255) NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Index cho sort/filter theo thời gian tạo (DESC thường dùng khi list users)
      CREATE INDEX IF NOT EXISTS idx_users_created_at ON users (created_at DESC);
    `

    await primaryPool.query(initSchemaQuery);
    fastify.log.info('[postgres] database schema initialized (users table ready)');

  } catch (err) {
    console.log(err)
    await primaryPool.end();
    throw new Error(`[postgres] primary ping failed: ${(err as Error)}`);
  }

  // Read replicas — mirrors ReadReplicas loop in NewDBWithLogger()
  const replicaPools: Pool[] = [];

  for (const replica of config.readReplicas) {
    const replicaPool = buildReplicaPool(replica);
    try {
      await replicaPool.query('SELECT 1');
      replicaPools.push(replicaPool);
      fastify.log.info(`[postgres] replica connected ${replica.host}:${replica.port}`);
    } catch (err) {
      await replicaPool.end();
      fastify.log.warn({ err }, `[postgres] replica ping failed ${replica.host}:${replica.port} — skipping`);
    }
  }

  // mirrors getRandomReplica() in postgres.go
  function pickReadPool(): Pool {
    if (replicaPools.length === 0) return primaryPool;
    return replicaPools[Math.floor(Math.random() * replicaPools.length)];
  }

  const db: PostgresDb = {
    query:      (text, values) => primaryPool.query(text, values as unknown[]),
    readQuery:  (text, values) => pickReadPool().query(text, values as unknown[]),
    pool:       primaryPool,
  };

  fastify.decorate('pg', db);

  // mirrors Close() in postgres.go — close replicas first, then primary
  fastify.addHook('onClose', async () => {
    fastify.log.info('[postgres] closing connections');
    await Promise.all(replicaPools.map((r) => r.end()));
    await primaryPool.end();
    fastify.log.info('[postgres] connections closed');
  });
};

export default fp(postgresPlugin, {
  name: 'postgres',
});
