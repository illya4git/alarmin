/**
 * tryvoha.online adapter (fallback source, plan D1).
 *
 * `/api/v1/alerts` lists every region with an active alert, by slug:
 * `type` is `state` (oblast or separately announcing city), `district` (raion) or
 * `community` (hromada); `oblast_slug` names the top-level region (a state's own slug).
 * Only air-raid alerts are published; `level` is `red` or `yellow` (yellow = drone threat).
 * No ETag; `updated_at` changes on every response, so bodies are never diffed whole.
 * Terms: 120 req/min/IP, responses cached 30–60 s, attribution to Tryvoha.online required.
 */
import { z } from 'zod';

const TryvohaAlertSchema = z.object({
  slug: z.string(),
  type: z.string(),
  name_uk: z.string().nullish(),
  name_en: z.string().nullish(),
  oblast_slug: z.string().nullish(),
  level: z.string(),
  started_at: z.string().nullish(),
});

export const TryvohaAlertsSchema = z.object({
  updated_at: z.string().nullish(),
  alerts: z.array(TryvohaAlertSchema),
});
export type TryvohaAlert = z.infer<typeof TryvohaAlertSchema>;

export interface TryvohaClientOptions {
  baseUrl: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

const USER_AGENT = 'alarmin-proxy/0.1';

export class TryvohaClient {
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: TryvohaClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.#timeoutMs = options.timeoutMs;
    this.#fetch = options.fetch ?? fetch;
  }

  async alerts(): Promise<TryvohaAlert[]> {
    const res = await this.#fetch(`${this.#baseUrl}/api/v1/alerts`, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (!res.ok) throw new Error(`Tryvoha alerts HTTP ${res.status}`);
    return TryvohaAlertsSchema.parse(await res.json()).alerts;
  }
}
