import { timingSafeEqual } from 'node:crypto';
import { REGION_BY_ID, REGIONS } from '@alarmin/shared';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { StatusSource } from './sources.ts';

export const API_VERSION = 1;
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
    for (const st of s.snapshot?.regions.values() ?? []) counts[st.level] = (counts[st.level] ?? 0) + 1;
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
      uncoveredRegionIds: [...(s.snapshot?.regions ?? [])].filter(([, st]) => st.unknown).map(([id]) => id),
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
        if (!Number.isInteger(id) || !REGION_BY_ID.has(id)) return reply.code(404).send({ e: 'region' });
        const state = opts.status.snapshot?.regions.get(id);
        if (!state) return reply.code(503).send({ e: 'warming' });
        const fresh = freshness();
        // A region the serving source doesn't cover is reported stale, never as current.
        return { l: state.level, f: state.flags, t: state.since, a: fresh.a, x: state.unknown ? 1 : fresh.x };
      });

      v1.get('/all', async (_req, reply) => {
        const snapshot = opts.status.snapshot;
        if (!snapshot) return reply.code(503).send({ e: 'warming' });
        const m = REGIONS.map((r) => snapshot.regions.get(r.id)?.level ?? 0).join('');
        return { m, t: Math.floor(snapshot.computedAt / 1000), ...freshness() };
      });
    },
    { prefix: '/v1' },
  );

  return app;
}
