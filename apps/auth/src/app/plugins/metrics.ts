import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  Registry,
  collectDefaultMetrics,
  Counter,
  Histogram,
  Gauge,
} from 'prom-client';

declare module 'fastify' {
  interface FastifyInstance {
    metricsRegistry: Registry;
  }
  interface FastifyRequest {
    _metricsStartTime: bigint | undefined;
  }
}

const metricsPlugin: FastifyPluginAsync = async (fastify) => {
  const registry = new Registry();
  registry.setDefaultLabels({ app: 'auth', env: process.env.NODE_ENV ?? 'development' });

  // Tự động collect: event loop lag, heap, GC, CPU, file descriptors
  collectDefaultMetrics({ register: registry });

  // ── HTTP metrics ─────────────────────────────────────────────────────────
  const httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });

  const httpTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests count',
    labelNames: ['method', 'route', 'status_code'],
    registers: [registry],
  });

  // ── PostgreSQL primary pool (lazy — evaluated at scrape time) ────────────
  new Gauge({
    name: 'pg_primary_pool_connections_total',
    help: 'Total connections in primary pool (idle + checked-out)',
    registers: [registry],
    collect() { this.set(fastify.pg?.pool?.totalCount ?? 0); },
  });

  new Gauge({
    name: 'pg_primary_pool_connections_idle',
    help: 'Idle connections in primary pool',
    registers: [registry],
    collect() { this.set(fastify.pg?.pool?.idleCount ?? 0); },
  });

  new Gauge({
    name: 'pg_primary_pool_connections_waiting',
    help: 'Clients waiting for a free connection in primary pool',
    registers: [registry],
    collect() { this.set(fastify.pg?.pool?.waitingCount ?? 0); },
  });

  // ── PostgreSQL replica pools (1 series per replica via label) ─────────────
  new Gauge({
    name: 'pg_replica_pool_connections_total',
    help: 'Total connections per replica pool',
    labelNames: ['replica'],
    registers: [registry],
    collect() {
      (fastify.pg?.replicaPools ?? []).forEach((pool, i) => {
        this.set({ replica: String(i) }, pool.totalCount ?? 0);
      });
    },
  });

  new Gauge({
    name: 'pg_replica_pool_connections_idle',
    help: 'Idle connections per replica pool',
    labelNames: ['replica'],
    registers: [registry],
    collect() {
      (fastify.pg?.replicaPools ?? []).forEach((pool, i) => {
        this.set({ replica: String(i) }, pool.idleCount ?? 0);
      });
    },
  });

  new Gauge({
    name: 'pg_replica_pool_connections_waiting',
    help: 'Waiting clients per replica pool',
    labelNames: ['replica'],
    registers: [registry],
    collect() {
      (fastify.pg?.replicaPools ?? []).forEach((pool, i) => {
        this.set({ replica: String(i) }, pool.waitingCount ?? 0);
      });
    },
  });

  // ── PostgreSQL query metrics ───────────────────────────────────────────────
  const pgQueryDuration = new Histogram({
    name: 'pg_query_duration_seconds',
    help: 'PostgreSQL query execution time in seconds',
    labelNames: ['query_type', 'status'], // query_type: write | read
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [registry],
  });

  const pgQueryTotal = new Counter({
    name: 'pg_queries_total',
    help: 'Total PostgreSQL queries executed',
    labelNames: ['query_type', 'status'],
    registers: [registry],
  });

  // Wrap fastify.pg.query / readQuery sau khi tất cả plugins đã load
  fastify.addHook('onReady', async () => {
    const db = fastify.pg;
    if (!db) return;

    const origWrite = db.query.bind(db);
    const origRead  = db.readQuery.bind(db);

    const wrap = (orig: typeof origWrite, type: 'write' | 'read') =>
      async (text: string, values?: unknown[]) => {
        const t = process.hrtime.bigint();
        try {
          const result = await orig(text, values);
          const dur = Number(process.hrtime.bigint() - t) / 1e9;
          pgQueryDuration.observe({ query_type: type, status: 'success' }, dur);
          pgQueryTotal.inc({ query_type: type, status: 'success' });
          return result;
        } catch (err) {
          const dur = Number(process.hrtime.bigint() - t) / 1e9;
          pgQueryDuration.observe({ query_type: type, status: 'error' }, dur);
          pgQueryTotal.inc({ query_type: type, status: 'error' });
          throw err;
        }
      };

    db.query     = wrap(origWrite, 'write') as typeof db.query;
    db.readQuery = wrap(origRead,  'read')  as typeof db.readQuery;
  });

  fastify.decorate('metricsRegistry', registry);

  // ── Request timing hooks ──────────────────────────────────────────────────
  fastify.addHook('onRequest', (request, _reply, done) => {
    request._metricsStartTime = process.hrtime.bigint();
    done();
  });

  fastify.addHook('onResponse', (request, reply, done) => {
    const start = request._metricsStartTime;
    if (start == null) return done();

    const route = request.routeOptions?.url ?? request.url;
    if (route === '/metrics') return done(); // skip noise

    const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
    const labels = {
      method: request.method,
      route,
      status_code: String(reply.statusCode),
    };
    httpDuration.observe(labels, durationSec);
    httpTotal.inc(labels);
    done();
  });

  // ── Scrape endpoint ───────────────────────────────────────────────────────
  fastify.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', registry.contentType);
    return registry.metrics();
  });
};

export default fp(metricsPlugin, { name: 'metrics' });
