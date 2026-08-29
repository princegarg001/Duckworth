import { z } from 'zod';

/**
 * Environment parsing.
 *
 * Config is validated once, at boot, and the process **exits** if it is
 * invalid. A service that starts with a missing database URL and only
 * discovers it on the first request has turned a deploy-time failure into a
 * user-facing one; a service that starts with `CORS_ORIGINS` silently
 * defaulting to `*` has turned it into a security one.
 */

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const csv = z.string().transform((v) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0),
);

export const NodeEnv = z.enum(['development', 'test', 'production']);
export type NodeEnv = z.infer<typeof NodeEnv>;

const BaseEnv = z.object({
  NODE_ENV: NodeEnv.default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SERVICE_NAME: z.string().default('ipl-api'),
  SERVICE_VERSION: z.string().default('0.0.0-dev'),
  GIT_SHA: z.string().default('unknown'),
});

const DatabaseEnv = z.object({
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid postgres:// URL'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  /**
   * A hard ceiling on any single query. Unbounded queries are the most common
   * way a healthy service becomes an unhealthy one under load.
   */
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).default(10_000),
  DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(100).default(5_000),
  DATABASE_SSL: bool.default('false'),
});

const RedisEnv = z.object({
  /** Optional: the API degrades to no caching rather than failing to start. */
  REDIS_URL: z.string().url().optional(),
  CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(60),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
});

const ServerEnv = z.object({
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** Explicit allowlist. Never `*` — see ADR 0005. */
  CORS_ORIGINS: csv.default('http://localhost:3001'),
  BODY_LIMIT_BYTES: z.coerce.number().int().min(1024).default(1_048_576),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),
  /** Must exceed the load balancer's drain window; see the runbook. */
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(0).default(10_000),
  /** Guards POST /internal/*. Required in production. */
  INTERNAL_API_TOKEN: z.string().min(16).optional(),
  TRUST_PROXY: bool.default('false'),
});

const TelemetryEnv = z.object({
  OTEL_ENABLED: bool.default('false'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  METRICS_ENABLED: bool.default('true'),
});

export const ApiEnvSchema = BaseEnv.merge(DatabaseEnv)
  .merge(RedisEnv)
  .merge(ServerEnv)
  .merge(TelemetryEnv)
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (env.INTERNAL_API_TOKEN === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['INTERNAL_API_TOKEN'],
          message:
            'INTERNAL_API_TOKEN is required in production — /internal routes must be guarded',
        });
      }
      if (env.CORS_ORIGINS.some((o) => o === '*')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CORS_ORIGINS'],
          message: 'CORS_ORIGINS may not be "*" in production',
        });
      }
    }
  });

export type ApiEnv = z.infer<typeof ApiEnvSchema>;

export const IngestEnvSchema = BaseEnv.merge(DatabaseEnv).extend({
  SOURCE_DIR: z.string().default('./data/raw'),
  BATCH_SIZE: z.coerce.number().int().min(100).max(50_000).default(5_000),
});

export type IngestEnv = z.infer<typeof IngestEnvSchema>;

/**
 * Parse or die.
 *
 * Prints every problem at once — a config fix loop that surfaces one missing
 * variable per restart is its own small tragedy — and never echoes values,
 * which would put secrets in the logs.
 */
export function loadEnv<T extends z.ZodTypeAny>(
  schema: T,
  source: NodeJS.ProcessEnv = process.env,
): z.infer<T> {
  const parsed = schema.safeParse(source);
  // `safeParse` on a generic `ZodTypeAny` widens `data` to `any`; the cast
  // restores the caller's inferred type, which is what the signature promises.
  if (parsed.success) return parsed.data as z.infer<T>;

  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
  process.stderr.write(
    `\nInvalid environment configuration:\n${lines.join('\n')}\n\n` +
      `See .env.example for the full set of supported variables.\n\n`,
  );
  process.exit(78); // EX_CONFIG
}

export { z };
