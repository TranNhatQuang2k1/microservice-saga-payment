import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod schema — tương đương BillingConfiguration + LicenseServiceConfiguration
//              + SSOServiceConfiguration trong Go
// ---------------------------------------------------------------------------

export const BillingConfigSchema = z.object({
  BILLING_ENABLED:           z.coerce.boolean().default(false),
  BILLING_URL:               z.string().default(''),
  BILLING_API_KEY:           z.string().default(''),
  BILLING_ORGANISATION_HOST: z.string().default(''),

  // Payment provider
  PAYMENT_PROVIDER_TYPE:            z.string().default(''),
  PAYMENT_PROVIDER_PUBLISHABLE_KEY: z.string().default(''),

  // License
  LICENSE_KEY: z.string().default(''),

  // License service
  LICENSE_SERVICE_HOST:              z.string().default(''),
  LICENSE_SERVICE_VALIDATE_ENDPOINT: z.string().default(''),
  LICENSE_SERVICE_TIMEOUT:           z.coerce.number().int().default(0),
  LICENSE_SERVICE_RETRY_COUNT:       z.coerce.number().int().default(0),

  // SSO service — tương đương SSOServiceConfiguration + applyServiceDefaults() trong Go
  SSO_SERVICE_HOST:            z.string().default('https://overwatch.getconvoy.cloud'),
  SSO_SERVICE_REDIRECT_PATH:   z.string().default('/sso/redirect'),
  SSO_SERVICE_TOKEN_PATH:      z.string().default('/sso/token'),
  SSO_SERVICE_ADMIN_PORTAL_PATH: z.string().default('/sso/admin-portal'),
  SSO_SERVICE_TIMEOUT:         z.coerce.number().int().default(10_000),
  SSO_SERVICE_RETRY_COUNT:     z.coerce.number().int().default(3),
}).superRefine((env, ctx) => {
  // tương đương BillingConfiguration.Validate() trong Go
  if (env.BILLING_ENABLED) {
    if (!env.BILLING_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BILLING_URL'],
        message: 'billing URL is required when billing is enabled',
      });
    }
    if (!env.BILLING_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BILLING_API_KEY'],
        message: 'billing API key is required when billing is enabled',
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface PaymentProviderConfiguration {
  type:           string;
  publishableKey: string;
}

export interface BillingConfiguration {
  enabled:          boolean;
  url:              string;
  apiKey:           string;
  organisationHost: string;
  paymentProvider:  PaymentProviderConfiguration;
}

export interface LicenseServiceConfiguration {
  host:         string;
  validatePath: string;
  timeoutMs:    number;
  retryCount:   number;
}

export interface SSOServiceConfiguration {
  host:            string;
  redirectPath:    string;
  tokenPath:       string;
  adminPortalPath: string;
  timeoutMs:       number;
  retryCount:      number;
}

export interface BillingAndLicenseConfiguration {
  licenseKey:     string;
  billing:        BillingConfiguration;
  licenseService: LicenseServiceConfiguration;
  ssoService:     SSOServiceConfiguration;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export function loadBillingConfig(env: NodeJS.ProcessEnv = process.env): BillingAndLicenseConfiguration {
  const result = BillingConfigSchema.safeParse(env);

  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => `  [${issue.path.join('.')}] ${issue.message}`)
      .join('\n');
    throw new Error(`Billing config validation failed:\n${messages}`);
  }

  const e = result.data;

  return {
    licenseKey: e.LICENSE_KEY,
    billing: {
      enabled:          e.BILLING_ENABLED,
      url:              e.BILLING_URL,
      apiKey:           e.BILLING_API_KEY,
      organisationHost: e.BILLING_ORGANISATION_HOST,
      paymentProvider: {
        type:           e.PAYMENT_PROVIDER_TYPE,
        publishableKey: e.PAYMENT_PROVIDER_PUBLISHABLE_KEY,
      },
    },
    licenseService: {
      host:         e.LICENSE_SERVICE_HOST,
      validatePath: e.LICENSE_SERVICE_VALIDATE_ENDPOINT,
      timeoutMs:    e.LICENSE_SERVICE_TIMEOUT,
      retryCount:   e.LICENSE_SERVICE_RETRY_COUNT,
    },
    ssoService: {
      host:            e.SSO_SERVICE_HOST,
      redirectPath:    e.SSO_SERVICE_REDIRECT_PATH,
      tokenPath:       e.SSO_SERVICE_TOKEN_PATH,
      adminPortalPath: e.SSO_SERVICE_ADMIN_PORTAL_PATH,
      timeoutMs:       e.SSO_SERVICE_TIMEOUT,
      retryCount:      e.SSO_SERVICE_RETRY_COUNT,
    },
  };
}
