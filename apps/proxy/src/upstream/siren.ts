/**
 * siren.pp.ua adapter (same shape as the official api.ukrainealarm.com v3).
 *
 * `/api/v3/alerts` lists every region with an active alert. Entries also repeat
 * alerts *inherited* from ancestors (a hromada lists its raion's alert, with the
 * raion's regionId), so consumers should key on `activeAlerts[].regionId`.
 */
import type { SirenRegionNode } from '@alarmin/shared';
import { z } from 'zod';

const AlertLevelSchema = z.object({
  alertLevel: z.string(),
  reason: z.string().nullish(),
  createdAt: z.string(),
});

const ActiveAlertSchema = z.object({
  regionId: z.string(),
  regionType: z.string(),
  type: z.string(),
  lastUpdate: z.string().nullish(),
  activeAlertLevels: z.array(AlertLevelSchema).nullish(),
});

const AlertEntrySchema = z.object({
  regionId: z.string(),
  regionType: z.string(),
  regionName: z.string().nullish(),
  regionEngName: z.string().nullish(),
  lastUpdate: z.string().nullish(),
  activeAlerts: z.array(ActiveAlertSchema),
});

export const SirenAlertsSchema = z.array(AlertEntrySchema);
export type SirenAlertEntry = z.infer<typeof AlertEntrySchema>;

const RegionNodeSchema: z.ZodType<SirenRegionNode> = z.lazy(() =>
  z.object({
    regionId: z.string(),
    regionType: z.string().optional(),
    regionName: z.string().optional(),
    regionChildIds: z.array(RegionNodeSchema).nullish(),
  }),
);
export const SirenRegionsSchema = z.object({ states: z.array(RegionNodeSchema) });

export type AlertsResult = { kind: 'not-modified' } | { kind: 'ok'; etag: string | null; entries: SirenAlertEntry[] };

export interface SirenClientOptions {
  baseUrl: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

const USER_AGENT = 'alarmin-proxy/0.1';

export class SirenClient {
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: SirenClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.#timeoutMs = options.timeoutMs;
    this.#fetch = options.fetch ?? fetch;
  }

  /** Fetches active alerts; sends If-None-Match when an ETag is known. */
  async alerts(etag: string | null): Promise<AlertsResult> {
    const headers: Record<string, string> = { 'user-agent': USER_AGENT, accept: 'application/json' };
    if (etag) headers['if-none-match'] = etag;
    const res = await this.#fetch(`${this.#baseUrl}/api/v3/alerts`, {
      headers,
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (res.status === 304) return { kind: 'not-modified' };
    if (!res.ok) throw new Error(`Siren alerts HTTP ${res.status}`);
    const entries = SirenAlertsSchema.parse(await res.json());
    return { kind: 'ok', etag: res.headers.get('etag'), entries };
  }

  async regions(): Promise<SirenRegionNode[]> {
    const res = await this.#fetch(`${this.#baseUrl}/api/v3/regions`, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(this.#timeoutMs * 5),
    });
    if (!res.ok) throw new Error(`Siren regions HTTP ${res.status}`);
    return SirenRegionsSchema.parse(await res.json()).states;
  }
}
