import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod schema — tương đương AuthConfiguration + sub-structs trong Go
// ---------------------------------------------------------------------------

export const AuthConfigSchema = z.object({
  // Native realm
  NATIVE_REALM_ENABLED: z.coerce.boolean().default(true),

  // JWT realm
  JWT_REALM_ENABLED:            z.coerce.boolean().default(true),
  JWT_RSA_PRIVATE_KEY:          z.string().default(''),
  JWT_RSA_PUBLIC_KEY:           z.string().default(''),
  JWT_EXPIRY:                   z.coerce.number().int().default(0),
  JWT_RSA_REFRESH_PRIVATE_KEY:  z.string().default(''),
  JWT_RSA_REFRESH_PUBLIC_KEY:   z.string().default(''),
  JWT_REFRESH_EXPIRY:           z.coerce.number().int().default(0),

  // Portal realm
  PORTAL_REALM_ENABLED: z.coerce.boolean().default(true),

  // Google OAuth
  GOOGLE_OAUTH_ENABLED:      z.coerce.boolean().default(false),
  GOOGLE_OAUTH_CLIENT_ID:    z.string().default(''),
  GOOGLE_OAUTH_REDIRECT_URL: z.string().default(''),

  // SSO
  SSO_ENABLED:      z.coerce.boolean().default(false),
  SSO_REDIRECT_URL: z.string().default(''),

  // General
  SIGNUP_ENABLED: z.coerce.boolean().default(true),
});

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface NativeRealmOptions {
  enabled: boolean;
}

export interface JwtRealmOptions {
  enabled:            boolean;
  privateKey:         string;
  publicKey:          string;
  expiry:             number;
  refreshPrivateKey:  string;
  refreshPublicKey:   string;
  refreshExpiry:      number;
}

export interface PortalRealmOptions {
  enabled: boolean;
}

export interface GoogleOAuthOptions {
  enabled:     boolean;
  clientId:    string;
  redirectUrl: string;
}

export interface SSOOptions {
  enabled:     boolean;
  redirectUrl: string;
}

export interface AuthConfiguration {
  native:          NativeRealmOptions;
  jwt:             JwtRealmOptions;
  portal:          PortalRealmOptions;
  googleOAuth:     GoogleOAuthOptions;
  sso:             SSOOptions;
  isSignupEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfiguration {
  const result = AuthConfigSchema.safeParse(env);

  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => `  [${issue.path.join('.')}] ${issue.message}`)
      .join('\n');
    throw new Error(`Auth config validation failed:\n${messages}`);
  }

  const e = result.data;

  return {
    native: {
      enabled: e.NATIVE_REALM_ENABLED,
    },
    jwt: {
      enabled:           e.JWT_REALM_ENABLED,
      privateKey:        e.JWT_RSA_PRIVATE_KEY,
      publicKey:         e.JWT_RSA_PUBLIC_KEY,
      expiry:            e.JWT_EXPIRY,
      refreshPrivateKey: e.JWT_RSA_REFRESH_PRIVATE_KEY,
      refreshPublicKey:  e.JWT_RSA_REFRESH_PUBLIC_KEY,
      refreshExpiry:     e.JWT_REFRESH_EXPIRY,
    },
    portal: {
      enabled: e.PORTAL_REALM_ENABLED,
    },
    googleOAuth: {
      enabled:     e.GOOGLE_OAUTH_ENABLED,
      clientId:    e.GOOGLE_OAUTH_CLIENT_ID,
      redirectUrl: e.GOOGLE_OAUTH_REDIRECT_URL,
    },
    sso: {
      enabled:     e.SSO_ENABLED,
      redirectUrl: e.SSO_REDIRECT_URL,
    },
    isSignupEnabled: e.SIGNUP_ENABLED,
  };
}
