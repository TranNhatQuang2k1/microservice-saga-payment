import { loadRedisConfig,      type RedisConfiguration      } from './redis.config.js';
import { loadDatabaseConfig,   type DatabaseConfiguration   } from './database.config.js';
import { loadServerConfig,     type ServerConfiguration     } from './server.config.js';
import { loadAuthConfig,       type AuthConfiguration       } from './auth.config.js';
import { loadSmtpConfig,       type SmtpConfiguration       } from './smtp.config.js';
import { loadStorageConfig,    type StoragePolicyConfiguration } from './storage.config.js';
import { loadTracerConfig,     type TracerConfiguration     } from './tracer.config.js';
import { loadMetricsConfig,    type MetricsConfiguration    } from './metrics.config.js';
import { loadDispatcherConfig, type DispatcherConfiguration } from './dispatcher.config.js';
import { loadBillingConfig,    type BillingAndLicenseConfiguration } from './billing.config.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Root-level env vars — tương đương top-level fields trong Configuration struct
// ---------------------------------------------------------------------------

const AppRootSchema = z.object({
  API_VERSION:    z.string().default('2025-11-24'),
  HOST:           z.string().default('localhost:5005'),
  ENV:            z.string().default('oss'),
  ROOT_PATH:      z.string().default(''),
  MAX_RESPONSE_SIZE: z.coerce.number().int().default(50),
  CONSUMER_POOL_SIZE: z.coerce.number().int().default(100),
  ENABLE_PROFILING:   z.coerce.boolean().default(false),
  INSTANCE_INGEST_RATE: z.coerce.number().int().default(1000),
  API_RATE_LIMIT:       z.coerce.number().int().default(1000),
  WORKER_EXECUTION_MODE: z
    .enum(['events', 'retry', 'default'])
    .default('default'),
  MAX_RETRY_SECONDS: z.coerce.number().int().default(0),
  ENABLE_FEATURE_FLAG: z
    .string()
    .default('')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
}).superRefine((env, ctx) => {
  // tương đương ensureRootPath() trong Go
  const p = env.ROOT_PATH;
  if (!p) return;

  if (!p.startsWith('/')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ROOT_PATH'],
      message: "root path must start with '/' (e.g., '/convoy')" });
  }
  if (p.endsWith('/')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ROOT_PATH'],
      message: "root path should not end with '/' (e.g., use '/convoy' not '/convoy/')" });
  }
  if (p === '/') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ROOT_PATH'],
      message: "root path cannot be '/', use empty string for no prefix" });
  }
  if (!/^[a-zA-Z0-9/_-]+$/.test(p)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ROOT_PATH'],
      message: 'root path contains invalid characters, only alphanumeric, hyphens, underscores, and slashes are allowed' });
  }
});

// ---------------------------------------------------------------------------
// AppConfiguration — tương đương Configuration struct trong Go
// ---------------------------------------------------------------------------

export interface AppConfiguration {
  apiVersion:          string;
  host:                string;
  environment:         string;
  rootPath:            string;
  maxResponseSize:     number;
  consumerPoolSize:    number;
  enableProfiling:     boolean;
  instanceIngestRate:  number;
  apiRateLimit:        number;
  workerExecutionMode: 'events' | 'retry' | 'default';
  maxRetrySeconds:     number;
  enableFeatureFlag:   string[];

  redis:      RedisConfiguration;
  database:   DatabaseConfiguration;
  server:     ServerConfiguration;
  auth:       AuthConfiguration;
  smtp:       SmtpConfiguration;
  storage:    StoragePolicyConfiguration;
  tracer:     TracerConfiguration;
  metrics:    MetricsConfiguration;
  dispatcher: DispatcherConfiguration;
  billing:    BillingAndLicenseConfiguration;
}

// ---------------------------------------------------------------------------
// Singleton — tương đương cfgSingleton atomic.Value trong Go
// ---------------------------------------------------------------------------

let _config: AppConfiguration | null = null;

// ---------------------------------------------------------------------------
// loadConfig — tương đương LoadConfig() trong Go
// Gọi 1 lần duy nhất khi app start; throws nếu config invalid.
// ---------------------------------------------------------------------------

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfiguration {
  const rootResult = AppRootSchema.safeParse(env);

  if (!rootResult.success) {
    const messages = rootResult.error.issues
      .map((issue) => `  [${issue.path.join('.')}] ${issue.message}`)
      .join('\n');
    throw new Error(`App config validation failed:\n${messages}`);
  }

  const r = rootResult.data;

  // tương đương ensureMaxResponseSize() trong Go
  const maxResponseSize = r.MAX_RESPONSE_SIZE > 0
    ? r.MAX_RESPONSE_SIZE * 1024
    : 51200;

  const cfg: AppConfiguration = {
    apiVersion:          r.API_VERSION,
    host:                r.HOST,
    environment:         r.ENV,
    rootPath:            r.ROOT_PATH,
    maxResponseSize,
    consumerPoolSize:    r.CONSUMER_POOL_SIZE,
    enableProfiling:     r.ENABLE_PROFILING,
    instanceIngestRate:  r.INSTANCE_INGEST_RATE,
    apiRateLimit:        r.API_RATE_LIMIT,
    workerExecutionMode: r.WORKER_EXECUTION_MODE,
    maxRetrySeconds:     r.MAX_RETRY_SECONDS,
    enableFeatureFlag:   r.ENABLE_FEATURE_FLAG,

    redis:      loadRedisConfig(env),
    database:   loadDatabaseConfig(env),
    server:     loadServerConfig(env),
    auth:       loadAuthConfig(env),
    smtp:       loadSmtpConfig(env),
    storage:    loadStorageConfig(env),
    tracer:     loadTracerConfig(env),
    metrics:    loadMetricsConfig(env),
    dispatcher: loadDispatcherConfig(env),
    billing:    loadBillingConfig(env),
  };

  _config = cfg;
  return cfg;
}

// ---------------------------------------------------------------------------
// getConfig — tương đương Get() trong Go
// Dùng ở runtime sau khi loadConfig() đã được gọi.
// ---------------------------------------------------------------------------

export function getConfig(): AppConfiguration {
  if (!_config) {
    throw new Error('call loadConfig() before getConfig()');
  }
  return _config;
}

// ---------------------------------------------------------------------------
// createServiceConfig — dành cho microservice chỉ cần một tập nhỏ config.
//
// Mỗi loader là một function (env) => T, TypeScript tự infer ra shape của
// result dựa trên loaders mày truyền vào — hoàn toàn type-safe, không cần
// khai báo thêm interface.
//
// Ví dụ:
//   const cfg = createServiceConfig({
//     redis:    loadRedisConfig,
//     database: loadDatabaseConfig,
//   });
//   cfg.redis.host    // ✅ RedisConfiguration
//   cfg.database.port // ✅ DatabaseConfiguration
//   cfg.smtp          // ❌ compile error — không tồn tại
// ---------------------------------------------------------------------------

type LoaderMap = Record<string, (env: NodeJS.ProcessEnv) => unknown>;

type InferServiceConfig<T extends LoaderMap> = {
  [K in keyof T]: ReturnType<T[K]>;
};

export function createServiceConfig<T extends LoaderMap>(
  loaders: T,
  env: NodeJS.ProcessEnv = process.env,
): InferServiceConfig<T> {
  const errors: string[] = [];
  const result = {} as InferServiceConfig<T>;

  for (const key of Object.keys(loaders) as (keyof T)[]) {
    try {
      (result as Record<keyof T, unknown>)[key] = loaders[key](env);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }

  return result;
}
