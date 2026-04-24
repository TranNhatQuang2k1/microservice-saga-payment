import { z } from 'zod';

// ---------------------------------------------------------------------------
// Constants — tương đương const block trong config.go
// ---------------------------------------------------------------------------

export const PostgresDatabaseProvider = 'postgres' as const;

// ---------------------------------------------------------------------------
// ReadReplica — tương đương ReadReplicaConfiguration (JSON-encoded array in env)
// ---------------------------------------------------------------------------

const ReadReplicaSchema = z.object({
  type:     z.string().default(''),
  scheme:   z.string().default(''),
  host:     z.string().default(''),
  username: z.string().default(''),
  password: z.string().default(''),
  database: z.string().default(''),
  options:  z.string().default(''),
  port:     z.coerce.number().int().default(0),
  dsn:      z.string().default(''),
  maxOpenConn:      z.number().int().default(0),
  maxIdleConn:      z.number().int().default(0),
  connMaxLifetime:  z.number().int().default(0),
});

export type ReadReplicaConfiguration = z.infer<typeof ReadReplicaSchema>;

// ---------------------------------------------------------------------------
// Zod schema — đọc từ env vars (prefix DB_*)
// ---------------------------------------------------------------------------

export const DatabaseConfigSchema = z.object({
  DB_TYPE:     z.string().default(PostgresDatabaseProvider),
  DB_SCHEME:   z.string().default('postgres'),
  DB_HOST:     z.string().default('localhost'),
  DB_USERNAME: z.string().default('postgres'),
  DB_PASSWORD: z.string().default('postgres'),
  DB_DATABASE: z.string().default('convoy'),
  DB_OPTIONS:  z.string().default('sslmode=disable&connect_timeout=30'),
  DB_PORT:     z.coerce.number().int().positive().default(5432),
  DB_DSN:      z.string().default(''),

  DB_MAX_OPEN_CONN:     z.coerce.number().int().default(0),
  DB_MAX_IDLE_CONN:     z.coerce.number().int().default(0),
  DB_CONN_MAX_LIFETIME: z.coerce.number().int().default(3600),

  // JSON-encoded array — tương đương ReadReplicaConfiguration.Decode() trong Go
  DB_READ_REPLICAS: z
    .string()
    .default('[]')
    .transform((v) => {
      try {
        return JSON.parse(v) as unknown[];
      } catch {
        return [];
      }
    })
    .pipe(z.array(ReadReplicaSchema)),
});

// ---------------------------------------------------------------------------
// Output type
// ---------------------------------------------------------------------------

export interface DatabaseConfiguration {
  type:               string;
  scheme:             string;
  host:               string;
  username:           string;
  password:           string;
  database:           string;
  options:            string;
  port:               number;
  dsn:                string;
  maxOpenConnections: number;
  maxIdleConnections: number;
  connMaxLifetime:    number;
  readReplicas:       ReadReplicaConfiguration[];
}

// ---------------------------------------------------------------------------
// Helper — tương đương DatabaseConfiguration.BuildDsn() trong Go
// ---------------------------------------------------------------------------

export function buildDatabaseDsn(cfg: DatabaseConfiguration): string {
  if (cfg.dsn) return cfg.dsn;
  if (!cfg.scheme) return '';

  const auth = cfg.username || cfg.password
    ? `${encodeURIComponent(cfg.username)}:${encodeURIComponent(cfg.password)}@`
    : '';
  const db  = cfg.database ? `/${cfg.database}` : '';
  const opt = cfg.options   ? `?${cfg.options}`  : '';

  return `${cfg.scheme}://${auth}${cfg.host}:${cfg.port}${db}${opt}`;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export function loadDatabaseConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfiguration {
  const result = DatabaseConfigSchema.safeParse(env);

  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => `  [${issue.path.join('.')}] ${issue.message}`)
      .join('\n');
    throw new Error(`Database config validation failed:\n${messages}`);
  }

  const e = result.data;

  return {
    type:               e.DB_TYPE,
    scheme:             e.DB_SCHEME,
    host:               e.DB_HOST,
    username:           e.DB_USERNAME,
    password:           e.DB_PASSWORD,
    database:           e.DB_DATABASE,
    options:            e.DB_OPTIONS,
    port:               e.DB_PORT,
    dsn:                e.DB_DSN,
    maxOpenConnections: e.DB_MAX_OPEN_CONN,
    maxIdleConnections: e.DB_MAX_IDLE_CONN,
    connMaxLifetime:    e.DB_CONN_MAX_LIFETIME,
    readReplicas:       e.DB_READ_REPLICAS,
  };
}
