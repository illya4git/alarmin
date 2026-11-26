import { timingSafeEqual } from 'node:crypto';
import { RAION_BY_ID, RAIONS_BY_OBLAST, REGION_BY_ID, REGIONS, Source } from '@alarmin/shared';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Snapshot, StatusSource } from './sources.ts';

export const API_VERSION = 1;
/** `/v1/all` and `/v1/o` digit for a region the serving source doesn't cover. */
export const UNKNOWN_DIGIT = 3;
/** Oldest watch app version this proxy supports (reported in /v1/meta). */
export const MIN_WATCH_VERSION = '0.1.0';

export interface ServerOptions {
  status: StatusSource;
  appKeys: readonly string[];
  staleAfterMs: number;
  rateLimitPerMin: number;
  trustProxy: boolean;
  logger?: FastifyServerOptions['logger'];
  now?: () => number;
}

function keyMatches(given: string, keys: readonly Buffer[]): boolean {
  const g = Buffer.from(given);
  let ok = false;
  for (const k of keys) {
    if (k.length === g.length && timingSafeEqual(k, g)) ok = true;
  }
  return ok;
}

export async function buildServer(opts: ServerOptions): Promise<FastifyInstance> {
  const now = opts.now ?? Date.now;
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: opts.trustProxy });
  const keys = opts.appKeys.map((k) => Buffer.from(k));

  await app.register(rateLimit, { max: opts.rateLimitPerMin, timeWindow: '1 minute' });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
  });

  const sourceCode = () => (opts.status.source === 'tryvoha' ? Source.Tryvoha : Source.Siren);

  /** One status digit; 3 = not covered by the serving source (never shown as green). */
  const digit = (snapshot: Snapshot, id: number): number => {
    const st = snapshot.regions.get(id);
    return !st || st.unknown ? UNKNOWN_DIGIT : st.level;
  };

  /** Data freshness shared by all watch responses. */
  const freshness = () => {
    const { lastOkAt } = opts.status;
    const ageMs = lastOkAt ? now() - lastOkAt : Number.POSITIVE_INFINITY;
    return {
      a: Number.isFinite(ageMs) ? Math.max(0, Math.round(ageMs / 1000)) : -1,
      x: ageMs > opts.staleAfterMs ? 1 : 0,
    };
  };

  app.get('/healthz', async (_req, reply) => {
    const s = opts.status;
    const { a, x } = freshness();
    const counts = [0, 0, 0];
    for (const r of REGIONS) {
      const st = s.snapshot?.regions.get(r.id);
      if (st) counts[st.level] = (counts[st.level] ?? 0) + 1;
    }
    reply.code(s.snapshot && !x ? 200 : 503);
    return {
      ok: Boolean(s.snapshot) && !x,
      source: s.source,
      mode: s.mode ?? 'primary',
      lastOkAt: s.lastOkAt ? new Date(s.lastOkAt).toISOString() : null,
      ageSeconds: a,
      stale: Boolean(x),
      consecutiveFailures: s.consecutiveFailures,
      lastError: s.lastError,
      regions: { green: counts[0], yellow: counts[1], red: counts[2] },
      unknownRegionIds: s.snapshot?.unknownRegionIds ?? [],
      uncoveredRegionIds: REGIONS.filter((r) => s.snapshot?.regions.get(r.id)?.unknown).map((r) => r.id),
      uncoveredRaions: [...RAION_BY_ID.keys()].filter((id) => s.snapshot?.regions.get(id)?.unknown).length,
      feeds: (s.feeds ?? []).map((f) => ({
        source: f.source,
        lastOkAt: f.lastOkAt ? new Date(f.lastOkAt).toISOString() : null,
        consecutiveFailures: f.consecutiveFailures,
        lastError: f.lastError,
      })),
      divergent: (s.divergent ?? []).map((d) => ({
        ...d,
        since: new Date(d.since).toISOString(),
      })),
    };
  });

  await app.register(
    async (v1) => {
      v1.addHook('onRequest', async (req, reply) => {
        const given = req.headers['x-alarmin-key'];
        if (typeof given !== 'string' || !keyMatches(given, keys)) {
          return reply.code(401).send({ e: 'key' });
        }
      });

      v1.get('/meta', async () => ({
        v: API_VERSION,
        src: opts.status.source,
        n: REGIONS.length,
        min: MIN_WATCH_VERSION,
      }));

      v1.get<{ Params: { id: string } }>('/s/:id', async (req, reply) => {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || !(REGION_BY_ID.has(id) || RAION_BY_ID.has(id))) {
          return reply.code(404).send({ e: 'region' });
        }
        const state = opts.status.snapshot?.regions.get(id);
        if (!state) return reply.code(503).send({ e: 'warming' });
        const fresh = freshness();
        // A region the serving source doesn't cover is reported stale, never as current.
        return {
          l: state.level,
          f: state.flags,
          t: state.since,
          a: fresh.a,
          x: state.unknown ? 1 : fresh.x,
          s: sourceCode(),
        };
      });

      v1.get('/all', async (_req, reply) => {
        const snapshot = opts.status.snapshot;
        if (!snapshot) return reply.code(503).send({ e: 'warming' });
        // One digit per region in map order.
        const m = REGIONS.map((r) => digit(snapshot, r.id)).join('');
        return { m, t: Math.floor(snapshot.computedAt / 1000), ...freshness(), s: sourceCode() };
      });

      // Raions of one oblast, one digit each in raion idx order (empty for regions without raions).
      v1.get<{ Params: { id: string } }>('/o/:id', async (req, reply) => {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || !REGION_BY_ID.has(id)) return reply.code(404).send({ e: 'region' });
        const snapshot = opts.status.snapshot;
        if (!snapshot) return reply.code(503).send({ e: 'warming' });
        const m = (RAIONS_BY_OBLAST.get(id) ?? []).map((r) => digit(snapshot, r.id)).join('');
        return { m, t: Math.floor(snapshot.computedAt / 1000), ...freshness(), s: sourceCode() };
      });
    },
    { prefix: '/v1' },
  );

  return app;
}
