import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schemes
// ---------------------------------------------------------------------------

export const RedisScheme         = 'redis';
export const RedisSentinelScheme = 'redis-sentinel';
export const RedisSecureScheme   = 'rediss';

// ---------------------------------------------------------------------------
// Zod schema — đọc thẳng từ env vars, parse + validate cùng lúc
// ---------------------------------------------------------------------------

export const RedisConfigSchema = z
  .object({
    // connection
    SCHEME:         z.enum(['redis', 'rediss', 'redis-sentinel']).default('redis'),
    HOST:           z.string().default('localhost'),
    PORT:           z.coerce.number().int().positive().default(6379),
    REDIS_USERNAME: z.string().default(''),
    REDIS_PASSWORD: z.string().default(''),
    DATABASE:       z.string().default(''),

    // cluster: comma-separated addresses, e.g. "host1:6379,host2:6379"
    CLUSTER_ADDRESSES: z.string().default(''),

    // sentinel
    SENTINEL_MASTER_NAME: z.string().default(''),
    SENTINEL_USERNAME:    z.string().default(''),
    SENTINEL_PASSWORD:    z.string().default(''),

    // TLS
    TLS_SKIP_VERIFY:  z.coerce.boolean().default(false),
    TLS_CERT_FILE:    z.string().default(''),
    TLS_KEY_FILE:     z.string().default(''),
    TLS_CA_CERT_FILE: z.string().default(''),
  })
  // cross-field validation — tương đương ensureQueueConfig() trong config.go
  .superRefine((env, ctx) => {
    if (env.SCHEME === RedisSentinelScheme) {
      if (!env.SENTINEL_MASTER_NAME.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SENTINEL_MASTER_NAME'],
          message: 'redis sentinel master_name is required when scheme is redis-sentinel',
        });
      }

      const hasAddresses = env.CLUSTER_ADDRESSES.trim() !== '';
      const hasHostPort  = env.HOST !== '' && env.PORT > 0;
      if (!hasAddresses && !hasHostPort) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CLUSTER_ADDRESSES'],
          message: 'redis sentinel addresses are required when scheme is redis-sentinel',
        });
      }
    }

    // TLS cert + key phải đi cùng nhau
    const hasCert = env.TLS_CERT_FILE !== '';
    const hasKey  = env.TLS_KEY_FILE  !== '';
    if (hasCert !== hasKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TLS_CERT_FILE'],
        message: 'tls_cert_file and tls_key_file must both be set or both be empty',
      });
    }
  });

// ---------------------------------------------------------------------------
// Output type sau khi parse
// ---------------------------------------------------------------------------

export type RedisEnv = z.infer<typeof RedisConfigSchema>;

// ---------------------------------------------------------------------------
// Mapped config — tương đương RedisConfiguration struct trong Go
// ---------------------------------------------------------------------------

export interface RedisConfiguration {
  scheme:           'redis' | 'rediss' | 'redis-sentinel';
  host:             string;
  port:             number;
  username:         string;
  password:         string;
  database:         string;
  addresses:        string;   // raw comma-separated
  masterName:       string;
  sentinelUsername: string;
  sentinelPassword: string;
  tlsSkipVerify:    boolean;
  tlsCertFile:      string;
  tlsKeyFile:       string;
  tlsCACertFile:    string;
}

// ---------------------------------------------------------------------------
// Helper methods — tương đương methods trên RedisConfiguration trong Go
// ---------------------------------------------------------------------------

export function isSentinel(cfg: RedisConfiguration): boolean {
  return cfg.scheme === RedisSentinelScheme;
}

// Go: func (rc RedisConfiguration) SentinelAddresses() []string
export function sentinelAddresses(cfg: RedisConfiguration): string[] {
  if (cfg.addresses.trim()) {
    return cfg.addresses.split(',').map((a) => a.trim()).filter(Boolean);
  }
  if (cfg.host && cfg.port > 0) {
    return [`${cfg.host}:${cfg.port}`];
  }
  return [];
}

// Go: func (rc RedisConfiguration) BuildDsn() []string
export function buildRedisDsn(cfg: RedisConfiguration): string[] {
  if (isSentinel(cfg)) return sentinelAddresses(cfg);

  if (cfg.addresses.trim()) {
    return cfg.addresses.split(',').map((a) => a.trim()).filter(Boolean);
  }

  if (!cfg.scheme) return [];

  const auth = cfg.username || cfg.password
    ? `${encodeURIComponent(cfg.username)}:${encodeURIComponent(cfg.password)}@`
    : '';
  const db = cfg.database ? `/${cfg.database}` : '';

  return [`${cfg.scheme}://${auth}${cfg.host}:${cfg.port}${db}`];
}

export function hasTLSConfig(cfg: RedisConfiguration): boolean {
  return cfg.tlsSkipVerify || cfg.tlsCACertFile !== '' || (cfg.tlsCertFile !== '' && cfg.tlsKeyFile !== '');
}

// ---------------------------------------------------------------------------
// loadRedisConfig — parse env → validate → trả về RedisConfiguration
// Gọi 1 lần khi app start, tương đương LoadConfig() + envconfig.Process() trong Go
// ---------------------------------------------------------------------------

export function loadRedisConfig(env: NodeJS.ProcessEnv = process.env): RedisConfiguration {
  const result = RedisConfigSchema.safeParse(env);

  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => `  [${issue.path.join('.')}] ${issue.message}`)
      .join('\n');
    throw new Error(`Redis config validation failed:\n${messages}`);
  }

  const e = result.data;

  return {
    scheme:           e.SCHEME,
    host:             e.HOST,
    port:             e.PORT,
    username:         e.REDIS_USERNAME,
    password:         e.REDIS_PASSWORD,
    database:         e.DATABASE,
    addresses:        e.CLUSTER_ADDRESSES,
    masterName:       e.SENTINEL_MASTER_NAME,
    sentinelUsername: e.SENTINEL_USERNAME,
    sentinelPassword: e.SENTINEL_PASSWORD,
    tlsSkipVerify:    e.TLS_SKIP_VERIFY,
    tlsCertFile:      e.TLS_CERT_FILE,
    tlsKeyFile:       e.TLS_KEY_FILE,
    tlsCACertFile:    e.TLS_CA_CERT_FILE,
  };
}
