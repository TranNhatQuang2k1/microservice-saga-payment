import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod schema — tương đương HTTPServerConfiguration + ServerConfiguration trong Go
// ---------------------------------------------------------------------------

export const ServerConfigSchema = z.object({
  SSL:              z.coerce.boolean().default(false),
  SSL_CERT_FILE: z.string().default(''),
  SSL_KEY_FILE:  z.string().default(''),

  PORT:        z.coerce.number().int().positive().default(5005),
  WORKER_PORT: z.coerce.number().int().positive().default(5006),
  AGENT_PORT:  z.coerce.number().int().positive().default(5008),
  INGEST_PORT: z.coerce.number().int().positive().default(5009),
  SOCKET_PORT: z.coerce.number().int().default(0),
  DOMAIN_PORT: z.coerce.number().int().default(0),

  HTTP_PROXY: z.string().default(''),
  NO_PROXY:   z.string().default(''),
}).superRefine((env, ctx) => {
  if (env.SSL && (!env.SSL_CERT_FILE || !env.SSL_KEY_FILE)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SSL_CERT_FILE'],
      message: 'both cert_file and key_file are required for ssl',
    });
  }
});

// ---------------------------------------------------------------------------
// Output types — tương đương HTTPServerConfiguration + ServerConfiguration struct
// ---------------------------------------------------------------------------

export interface HTTPServerConfiguration {
  ssl:         boolean;
  sslCertFile: string;
  sslKeyFile:  string;
  port:        number;
  workerPort:  number;
  agentPort:   number;
  ingestPort:  number;
  socketPort:  number;
  domainPort:  number;
  httpProxy:   string;
  noProxy:     string;
}

export interface ServerConfiguration {
  http: HTTPServerConfiguration;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfiguration {
  const result = ServerConfigSchema.safeParse(env);

  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => `  [${issue.path.join('.')}] ${issue.message}`)
      .join('\n');
    throw new Error(`Server config validation failed:\n${messages}`);
  }

  const e = result.data;

  return {
    http: {
      ssl:         e.SSL,
      sslCertFile: e.SSL_CERT_FILE,
      sslKeyFile:  e.SSL_KEY_FILE,
      port:        e.PORT,
      workerPort:  e.WORKER_PORT,
      agentPort:   e.AGENT_PORT,
      ingestPort:  e.INGEST_PORT,
      socketPort:  e.SOCKET_PORT,
      domainPort:  e.DOMAIN_PORT,
      httpProxy:   e.HTTP_PROXY,
      noProxy:     e.NO_PROXY,
    },
  };
}
