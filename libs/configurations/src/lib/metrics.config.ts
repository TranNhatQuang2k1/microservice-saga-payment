import { z } from 'zod';

// ---------------------------------------------------------------------------
// Constants — tương đương const block trong config.go
// ---------------------------------------------------------------------------

export const PrometheusMetricsProvider = 'prometheus' as const;

export type MetricsBackend = typeof PrometheusMetricsProvider;

// ---------------------------------------------------------------------------
// Zod schema — tương đương MetricsConfiguration trong Go
// ---------------------------------------------------------------------------

export const MetricsConfigSchema = z.object({
  METRICS_ENABLED: z.coerce.boolean().default(false),
  METRICS_BACKEND: z.string().default(PrometheusMetricsProvider),

  METRICS_SAMPLE_TIME:                           z.coerce.number().int().default(5),
  METRICS_QUERY_TIMEOUT:                         z.coerce.number().int().default(30),
  METRICS_MATERIALIZED_VIEW_REFRESH_INTERVAL:    z.coerce.number().int().default(2),
}).superRefine((env, ctx) => {
  if (env.METRICS_ENABLED && env.METRICS_BACKEND !== PrometheusMetricsProvider) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['METRICS_BACKEND'],
      message: `unsupported metrics backend "${env.METRICS_BACKEND}", only "prometheus" is supported`,
    });
  }
});

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface PrometheusMetricsConfiguration {
  sampleTime:                    number;
  queryTimeout:                  number;
  materializedViewRefreshInterval: number;
}

export interface MetricsConfiguration {
  isEnabled:  boolean;
  backend:    string;
  prometheus: PrometheusMetricsConfiguration;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export function loadMetricsConfig(env: NodeJS.ProcessEnv = process.env): MetricsConfiguration {
  const result = MetricsConfigSchema.safeParse(env);

  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => `  [${issue.path.join('.')}] ${issue.message}`)
      .join('\n');
    throw new Error(`Metrics config validation failed:\n${messages}`);
  }

  const e = result.data;

  return {
    isEnabled: e.METRICS_ENABLED,
    backend:   e.METRICS_BACKEND,
    prometheus: {
      sampleTime:                      e.METRICS_SAMPLE_TIME,
      queryTimeout:                    e.METRICS_QUERY_TIMEOUT,
      materializedViewRefreshInterval: e.METRICS_MATERIALIZED_VIEW_REFRESH_INTERVAL,
    },
  };
}
