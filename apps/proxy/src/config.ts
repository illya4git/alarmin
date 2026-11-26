import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')
  .default(false);

const boolDefaultTrue = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')
  .default(true);

const ConfigSchema = z.object({
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** Comma-separated static app keys accepted in X-Alarmin-Key. */
  APP_KEYS: z
    .string()
    .transform((s) =>
      s
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().min(16, 'app keys must be at least 16 characters')).min(1)),
  SIREN_BASE_URL: z.url().default('https://siren.pp.ua'),
  POLL_INTERVAL_MS: z.coerce.number().int().min(2000).default(5000),
  /** Fallback source and cross-check (plan D1). */
  TRYVOHA_ENABLED: boolDefaultTrue,
  TRYVOHA_BASE_URL: z.url().default('https://tryvoha.online'),
  /** Cross-check interval while Siren is healthy. Tryvoha allows 120 req/min and caches 30–60 s. */
  TRYVOHA_INTERVAL_MS: z.coerce.number().int().min(15_000).default(60_000),
  /** Interval while Tryvoha is the served source. */
  TRYVOHA_FALLBACK_INTERVAL_MS: z.coerce.number().int().min(5000).default(15_000),
  /** Sources disagreeing on a region for this long are logged and listed in /healthz. */
  DIVERGENCE_AFTER_MS: z.coerce.number().int().positive().default(180_000),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(4000),
  /** Data older than this is reported as stale (x=1) to the watch. */
  STALE_AFTER_MS: z.coerce.number().int().positive().default(30_000),
  TREE_REFRESH_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(24 * 60 * 60 * 1000),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(120),
  /** Set when running behind a reverse proxy so client IPs come from X-Forwarded-For. */
  TRUST_PROXY: bool,
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
