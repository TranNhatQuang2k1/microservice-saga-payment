import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod schema — tương đương DispatcherConfiguration trong Go
// Các list env var là comma-separated string → transform thành string[]
// ---------------------------------------------------------------------------

const csvToArray = z
  .string()
  .default('')
  .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean));

export const DispatcherConfigSchema = z.object({
  DISPATCHER_INSECURE_SKIP_VERIFY: z.coerce.boolean().default(false),

  DISPATCHER_ALLOW_LIST:
    csvToArray.pipe(z.array(z.string())).default(['0.0.0.0/0', '::/0'] as never),

  DISPATCHER_BLOCK_LIST:
    csvToArray.pipe(z.array(z.string())).default(['127.0.0.0/8', '::1/128'] as never),

  DISPATCHER_CACERT_PATH:   z.string().default(''),
  DISPATCHER_CACERT_STRING: z.string().default(''),

  DISPATCHER_PING_METHODS:
    csvToArray.pipe(z.array(z.string())).default(['HEAD', 'GET', 'POST'] as never),

  DISPATCHER_SKIP_PING_VALIDATION: z.coerce.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Output type
// ---------------------------------------------------------------------------

export interface DispatcherConfiguration {
  insecureSkipVerify: boolean;
  allowList:          string[];
  blockList:          string[];
  caCertPath:         string;
  caCertString:       string;
  pingMethods:        string[];
  skipPingValidation: boolean;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export function loadDispatcherConfig(env: NodeJS.ProcessEnv = process.env): DispatcherConfiguration {
  const result = DispatcherConfigSchema.safeParse(env);

  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => `  [${issue.path.join('.')}] ${issue.message}`)
      .join('\n');
    throw new Error(`Dispatcher config validation failed:\n${messages}`);
  }

  const e = result.data;

  return {
    insecureSkipVerify: e.DISPATCHER_INSECURE_SKIP_VERIFY,
    allowList:          e.DISPATCHER_ALLOW_LIST,
    blockList:          e.DISPATCHER_BLOCK_LIST,
    caCertPath:         e.DISPATCHER_CACERT_PATH,
    caCertString:       e.DISPATCHER_CACERT_STRING,
    pingMethods:        e.DISPATCHER_PING_METHODS,
    skipPingValidation: e.DISPATCHER_SKIP_PING_VALIDATION,
  };
}
