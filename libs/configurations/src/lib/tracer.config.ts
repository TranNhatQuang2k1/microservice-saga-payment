import { z } from 'zod';

// ---------------------------------------------------------------------------
// Constants — tương đương const block trong config.go
// ---------------------------------------------------------------------------

export const OTelTracerProvider    = 'otel'    as const;
export const SentryTracerProvider  = 'sentry'  as const;
export const DatadogTracerProvider = 'datadog' as const;

export type TracerProvider =
  | typeof OTelTracerProvider
  | typeof SentryTracerProvider
  | typeof DatadogTracerProvider;

// ---------------------------------------------------------------------------
// Zod schema — tương đương TracerConfiguration + sub-structs
// ---------------------------------------------------------------------------

export const TracerConfigSchema = z.object({
  TRACER_PROVIDER: z
    .enum(['otel', 'sentry', 'datadog'])
    .default('otel'),

  // OTel
  OTEL_SAMPLE_RATE:          z.coerce.number().default(1.0),
  OTEL_COLLECTOR_URL:        z.string().default(''),
  OTEL_INSECURE_SKIP_VERIFY: z.coerce.boolean().default(true),
  OTEL_AUTH_HEADER_NAME:     z.string().default(''),
  OTEL_AUTH_HEADER_VALUE:    z.string().default(''),

  // Sentry
  SENTRY_DSN:         z.string().default(''),
  SENTRY_SAMPLE_RATE: z.coerce.number().default(0),
  SENTRY_DEBUG:       z.coerce.boolean().default(false),
  SENTRY_ENVIRONMENT: z.string().default(''),

  // Datadog
  DATADOG_AGENT_URL: z.string().default(''),

  // Pyroscope
  ENABLE_PYROSCOPE_PROFILING: z.coerce.boolean().default(false),
  PYROSCOPE_URL:              z.string().default(''),
  PYROSCOPE_USERNAME:         z.string().default(''),
  PYROSCOPE_PASSWORD:         z.string().default(''),
  PYROSCOPE_PROFILE_ID:       z.string().default(''),
});

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface OTelAuthConfiguration {
  headerName:  string;
  headerValue: string;
}

export interface OTelConfiguration {
  auth:               OTelAuthConfiguration;
  sampleRate:         number;
  collectorUrl:       string;
  insecureSkipVerify: boolean;
}

export interface SentryConfiguration {
  dsn:         string;
  sampleRate:  number;
  debug:       boolean;
  environment: string;
}

export interface DatadogConfiguration {
  agentUrl: string;
}

export interface PyroscopeConfiguration {
  enableProfiling: boolean;
  url:             string;
  username:        string;
  password:        string;
  profileId:       string;
}

export interface TracerConfiguration {
  type:      TracerProvider;
  otel:      OTelConfiguration;
  sentry:    SentryConfiguration;
  datadog:   DatadogConfiguration;
  pyroscope: PyroscopeConfiguration;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export function loadTracerConfig(env: NodeJS.ProcessEnv = process.env): TracerConfiguration {
  const result = TracerConfigSchema.safeParse(env);

  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => `  [${issue.path.join('.')}] ${issue.message}`)
      .join('\n');
    throw new Error(`Tracer config validation failed:\n${messages}`);
  }

  const e = result.data;

  return {
    type: e.TRACER_PROVIDER,
    otel: {
      auth: {
        headerName:  e.OTEL_AUTH_HEADER_NAME,
        headerValue: e.OTEL_AUTH_HEADER_VALUE,
      },
      sampleRate:         e.OTEL_SAMPLE_RATE,
      collectorUrl:       e.OTEL_COLLECTOR_URL,
      insecureSkipVerify: e.OTEL_INSECURE_SKIP_VERIFY,
    },
    sentry: {
      dsn:         e.SENTRY_DSN,
      sampleRate:  e.SENTRY_SAMPLE_RATE,
      debug:       e.SENTRY_DEBUG,
      environment: e.SENTRY_ENVIRONMENT,
    },
    datadog: {
      agentUrl: e.DATADOG_AGENT_URL,
    },
    pyroscope: {
      enableProfiling: e.ENABLE_PYROSCOPE_PROFILING,
      url:             e.PYROSCOPE_URL,
      username:        e.PYROSCOPE_USERNAME,
      password:        e.PYROSCOPE_PASSWORD,
      profileId:       e.PYROSCOPE_PROFILE_ID,
    },
  };
}
