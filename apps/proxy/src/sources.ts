/**
 * Source selection (plan §3.1): serve Siren, fall back to Tryvoha when Siren fails,
 * and log when the two disagree for too long.
 *
 * - PRIMARY → FALLBACK after N failed Siren polls in a row, or no Siren success for a while.
 * - FALLBACK → PRIMARY after M successful Siren polls in a row.
 * - Both down → keep serving the last snapshot; its age makes it stale for the watch.
 * - Regions the serving source doesn't cover (Crimea in Tryvoha) keep their last known
 *   level, marked `unknown` (stale for the watch), never reported as green. Raions likewise.
 * - Divergence is tracked for top-level regions only.
 * - Divergence (levels differ while both feeds are fresh) is tracked per region; past the
 *   threshold it's logged and listed in /healthz. It never triggers a switch.
 */
import { RAIONS, REGION_BY_ID, REGIONS } from '@alarmin/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Feed, SourceName } from './feed.ts';
import type { RegionState } from './normalize.ts';

export interface Snapshot {
  /** Top-level regions and raions, by Siren ID. */
  regions: ReadonlyMap<number, RegionState>;
  /** Epoch ms when this snapshot was computed. */
  computedAt: number;
  unknownRegionIds: readonly (number | string)[];
}

export interface FeedStatus {
  source: SourceName;
  /** Epoch ms; 0 if never. */
  lastOkAt: number;
  consecutiveFailures: number;
  lastError: string | null;
}

export interface Divergence {
  id: number;
  name: string;
  /** Level per source, keyed by source name. */
  levels: Partial<Record<SourceName, number>>;
  /** Epoch ms when the disagreement began. */
  since: number;
}

/** Read-only view the HTTP layer needs. */
export interface StatusSource {
  readonly snapshot: Snapshot | null;
  /** Epoch ms when the served data was last confirmed upstream; 0 if never. */
  readonly lastOkAt: number;
  readonly consecutiveFailures: number;
  readonly lastError: string | null;
  /** Source currently served. */
  readonly source: SourceName;
  readonly mode?: 'primary' | 'fallback' | undefined;
  readonly feeds?: readonly FeedStatus[] | undefined;
  /** Disagreements that have lasted past the threshold. */
  readonly divergent?: readonly Divergence[] | undefined;
}

export interface SelectorOptions {
  primary: Feed;
  /** null disables fallback and the cross-check. */
  fallback: Feed | null;
  log: FastifyBaseLogger;
  now?: () => number;
  failoverAfterFailures?: number;
  failoverAfterMs?: number;
  recoverAfterSuccesses?: number;
  divergenceAfterMs?: number;
  /** A feed's data is compared only while its last success is this recent. */
  primaryFreshMs: number;
  fallbackFreshMs: number;
}

export class SourceSelector implements StatusSource {
  mode: 'primary' | 'fallback' = 'primary';
  snapshot: Snapshot | null = null;
  lastOkAt = 0;

  readonly #o: Required<Omit<SelectorOptions, 'fallback' | 'now'>> & { fallback: Feed | null };
  readonly #now: () => number;
  readonly #startedAt: number;
  #switchedAt = 0;
  /** Region → when its sources started disagreeing, and whether that was logged. */
  readonly #disagree = new Map<number, { since: number; reported: boolean }>();

  constructor(opts: SelectorOptions) {
    this.#o = {
      failoverAfterFailures: 3,
      failoverAfterMs: 30_000,
      recoverAfterSuccesses: 3,
      divergenceAfterMs: 180_000,
      ...opts,
      fallback: opts.fallback,
    };
    this.#now = opts.now ?? Date.now;
    this.#startedAt = this.#now();
  }

  get active(): Feed {
    return this.mode === 'fallback' && this.#o.fallback ? this.#o.fallback : this.#o.primary;
  }

  get source(): SourceName {
    return this.active.name;
  }

  get consecutiveFailures(): number {
    return this.active.consecutiveFailures;
  }

  get lastError(): string | null {
    return this.active.lastError;
  }

  get feeds(): FeedStatus[] {
    return [this.#o.primary, this.#o.fallback]
      .filter((f): f is Feed => f !== null)
      .map((f) => ({
        source: f.name,
        lastOkAt: f.lastOkAt,
        consecutiveFailures: f.consecutiveFailures,
        lastError: f.lastError,
      }));
  }

  get divergent(): Divergence[] {
    const { primary, fallback } = this.#o;
    const out: Divergence[] = [];
    if (!fallback) return out;
    for (const [id, d] of this.#disagree) {
      if (!d.reported) continue;
      out.push({
        id,
        name: REGION_BY_ID.get(id)?.nameLatin ?? String(id),
        levels: { [primary.name]: primary.regions?.get(id)?.level, [fallback.name]: fallback.regions?.get(id)?.level },
        since: d.since,
      });
    }
    return out;
  }

  /** Re-evaluates mode, served snapshot and divergence. Call after every feed poll. */
  evaluate(): void {
    const now = this.#now();
    this.#updateMode(now);
    this.#serve(now);
    this.#checkDivergence(now);
  }

  #updateMode(now: number): void {
    const { primary, fallback, log } = this.#o;
    if (!fallback) return;
    if (this.mode === 'primary') {
      const silentFor = now - (primary.lastOkAt || this.#startedAt);
      if (primary.consecutiveFailures >= this.#o.failoverAfterFailures || silentFor > this.#o.failoverAfterMs) {
        this.mode = 'fallback';
        this.#switchedAt = now;
        log.warn(
          {
            from: primary.name,
            to: fallback.name,
            failures: primary.consecutiveFailures,
            lastError: primary.lastError,
          },
          'switching to fallback source',
        );
        fallback.pollNow();
      }
    } else if (primary.consecutiveSuccesses >= this.#o.recoverAfterSuccesses && primary.lastOkAt > this.#switchedAt) {
      this.mode = 'primary';
      log.info({ from: fallback.name, to: primary.name }, 'primary source back');
    }
  }

  #serve(now: number): void {
    const feed = this.active;
    if (!feed.regions) return; // nothing from this source yet: keep the last snapshot, it ages into stale
    const previous = this.snapshot?.regions ?? null;
    const regions = new Map<number, RegionState>();
    for (const r of [...REGIONS, ...RAIONS]) {
      const prev = previous?.get(r.id);
      if (!feed.covers(r.id)) {
        regions.set(r.id, { level: prev?.level ?? 0, flags: prev?.flags ?? 0, since: prev?.since ?? 0, unknown: true });
        continue;
      }
      const next = feed.regions.get(r.id);
      if (!next) continue;
      // Keep `since` across polls and source switches while the level holds.
      const since = prev && !prev.unknown && prev.level === next.level ? prev.since : next.since;
      regions.set(r.id, { level: next.level, flags: next.flags, since });
      if (prev && prev.level !== next.level) {
        // Raion changes are frequent; keep them out of the info log.
        this.#o.log[REGION_BY_ID.has(r.id) ? 'info' : 'debug'](
          { region: r.nameLatin, id: r.id, from: prev.level, to: next.level, flags: next.flags, source: feed.name },
          'level changed',
        );
      }
    }
    this.snapshot = { regions, computedAt: now, unknownRegionIds: feed.unknown };
    this.lastOkAt = feed.lastOkAt;
  }

  #checkDivergence(now: number): void {
    const { primary, fallback, log } = this.#o;
    if (!fallback) return;
    const fresh =
      primary.regions &&
      fallback.regions &&
      now - primary.lastOkAt <= this.#o.primaryFreshMs &&
      now - fallback.lastOkAt <= this.#o.fallbackFreshMs;
    if (!fresh) {
      // Can't compare; forget open disagreements rather than let them age into false alarms.
      this.#disagree.clear();
      return;
    }
    for (const r of REGIONS) {
      if (!fallback.covers(r.id) || !primary.covers(r.id)) continue;
      const a = primary.regions?.get(r.id)?.level;
      const b = fallback.regions?.get(r.id)?.level;
      const open = this.#disagree.get(r.id);
      if (a === b) {
        if (open?.reported) {
          log.info(
            { region: r.nameLatin, id: r.id, lastedSeconds: Math.round((now - open.since) / 1000) },
            'sources agree again',
          );
        }
        this.#disagree.delete(r.id);
        continue;
      }
      if (!open) {
        this.#disagree.set(r.id, { since: now, reported: false });
      } else if (!open.reported && now - open.since >= this.#o.divergenceAfterMs) {
        open.reported = true;
        log.warn(
          {
            region: r.nameLatin,
            id: r.id,
            [primary.name]: a,
            [fallback.name]: b,
            sinceSeconds: Math.round((now - open.since) / 1000),
          },
          'sources disagree',
        );
      }
    }
  }
}
