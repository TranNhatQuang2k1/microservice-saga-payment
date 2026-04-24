import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod schema — tương đương SMTPConfiguration trong Go
// ---------------------------------------------------------------------------

export const SmtpConfigSchema = z.object({
  SMTP_SSL:      z.coerce.boolean().default(false),
  SMTP_PROVIDER: z.string().default(''),
  SMTP_URL:      z.string().default(''),
  SMTP_PORT:     z.coerce.number().int().default(0),
  SMTP_USERNAME: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  SMTP_FROM:     z.string().default(''),
  SMTP_REPLY_TO: z.string().default(''),
});

// ---------------------------------------------------------------------------
// Output type
// ---------------------------------------------------------------------------

export interface SmtpConfiguration {
  ssl:      boolean;
  provider: string;
  url:      string;
  port:     number;
  username: string;
  password: string;
  from:     string;
  replyTo:  string;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export function loadSmtpConfig(env: NodeJS.ProcessEnv = process.env): SmtpConfiguration {
  const result = SmtpConfigSchema.safeParse(env);

  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => `  [${issue.path.join('.')}] ${issue.message}`)
      .join('\n');
    throw new Error(`SMTP config validation failed:\n${messages}`);
  }

  const e = result.data;

  return {
    ssl:      e.SMTP_SSL,
    provider: e.SMTP_PROVIDER,
    url:      e.SMTP_URL,
    port:     e.SMTP_PORT,
    username: e.SMTP_USERNAME,
    password: e.SMTP_PASSWORD,
    from:     e.SMTP_FROM,
    replyTo:  e.SMTP_REPLY_TO,
  };
}
