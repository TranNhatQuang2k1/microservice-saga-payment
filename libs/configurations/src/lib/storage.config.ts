import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod schema — tương đương StoragePolicyConfiguration + S3Storage + OnPremStorage
// ---------------------------------------------------------------------------

export const StorageConfigSchema = z.object({
  STORAGE_POLICY_TYPE: z.string().default('on-prem'),

  // S3
  STORAGE_AWS_PREFIX:        z.string().default(''),
  STORAGE_AWS_BUCKET:        z.string().default(''),
  STORAGE_AWS_ACCESS_KEY:    z.string().default(''),
  STORAGE_AWS_SECRET_KEY:    z.string().default(''),
  STORAGE_AWS_REGION:        z.string().default(''),
  STORAGE_AWS_SESSION_TOKEN: z.string().default(''),
  STORAGE_AWS_ENDPOINT:      z.string().default(''),

  // On-prem
  STORAGE_PREM_PATH: z.string().default('/convoy/data'),
});

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface S3StorageConfiguration {
  prefix:       string;
  bucket:       string;
  accessKey:    string;
  secretKey:    string;
  region:       string;
  sessionToken: string;
  endpoint:     string;
}

export interface OnPremStorageConfiguration {
  path: string;
}

export interface StoragePolicyConfiguration {
  type:   string;
  s3:     S3StorageConfiguration;
  onPrem: OnPremStorageConfiguration;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export function loadStorageConfig(env: NodeJS.ProcessEnv = process.env): StoragePolicyConfiguration {
  const result = StorageConfigSchema.safeParse(env);

  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => `  [${issue.path.join('.')}] ${issue.message}`)
      .join('\n');
    throw new Error(`Storage config validation failed:\n${messages}`);
  }

  const e = result.data;

  return {
    type: e.STORAGE_POLICY_TYPE,
    s3: {
      prefix:       e.STORAGE_AWS_PREFIX,
      bucket:       e.STORAGE_AWS_BUCKET,
      accessKey:    e.STORAGE_AWS_ACCESS_KEY,
      secretKey:    e.STORAGE_AWS_SECRET_KEY,
      region:       e.STORAGE_AWS_REGION,
      sessionToken: e.STORAGE_AWS_SESSION_TOKEN,
      endpoint:     e.STORAGE_AWS_ENDPOINT,
    },
    onPrem: {
      path: e.STORAGE_PREM_PATH,
    },
  };
}
