// ---------------------------------------------------------------------------
// Entry point — gọi loadConfig() 1 lần khi app start, sau đó dùng getConfig()
// Tương đương LoadConfig() + Get() pattern trong convoy/config/config.go
// ---------------------------------------------------------------------------

// App-level singleton (dùng cái này là chính)
export { loadConfig, getConfig, createServiceConfig, type AppConfiguration } from './lib/app.config.js';

// Sub-config types — dùng khi cần inject từng phần vào service/module
export {
  type RedisConfiguration,
  RedisScheme, RedisSentinelScheme, RedisSecureScheme,
  isSentinel, sentinelAddresses, buildRedisDsn, hasTLSConfig,
  loadRedisConfig,
} from './lib/redis.config.js';

export { loadServerConfig } from './lib/server.config.js';
export { loadAuthConfig } from './lib/auth.config.js';


export {
  type DatabaseConfiguration,
  type ReadReplicaConfiguration,
  PostgresDatabaseProvider,
  buildDatabaseDsn,
  loadDatabaseConfig
} from './lib/database.config.js';

export {
  type ServerConfiguration,
  type HTTPServerConfiguration,
} from './lib/server.config.js';

export {
  type AuthConfiguration,
  type NativeRealmOptions,
  type JwtRealmOptions,
  type PortalRealmOptions,
  type GoogleOAuthOptions,
  type SSOOptions,
} from './lib/auth.config.js';

export {
  type SmtpConfiguration,
} from './lib/smtp.config.js';

export {
  type StoragePolicyConfiguration,
  type S3StorageConfiguration,
  type OnPremStorageConfiguration,
} from './lib/storage.config.js';

export {
  type TracerConfiguration,
  type OTelConfiguration,
  type SentryConfiguration,
  type DatadogConfiguration,
  type PyroscopeConfiguration,
  OTelTracerProvider, SentryTracerProvider, DatadogTracerProvider,
} from './lib/tracer.config.js';

export {
  type MetricsConfiguration,
  type PrometheusMetricsConfiguration,
  PrometheusMetricsProvider,
} from './lib/metrics.config.js';

export {
  type DispatcherConfiguration,
} from './lib/dispatcher.config.js';

export {
  type BillingConfiguration,
  type BillingAndLicenseConfiguration,
  type LicenseServiceConfiguration,
  type SSOServiceConfiguration,
} from './lib/billing.config.js';
