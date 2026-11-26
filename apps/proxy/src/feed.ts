/**
 * One upstream source polled on its own timer. Keeps the source's latest region states and
 * its health counters; `SourceSelector` decides which feed is served.
 */
import { REGION_BY_ID } from '@alarmin/shared';
import type { FastifyBaseLogger } from 'fastify';
import {
  collectDeclared,
  type Observation,
  observeSiren,
  observeTryvoha,
  type RegionState,
  statesFrom,
} from './normalize.ts';
import type { RegionTree } from './regionTree.ts';
import type { SirenClient } from './upstream/siren.ts';
import type { TryvohaClient } from './upstream/tryvoha.ts';

export type SourceName = 'siren' | 'tryvoha';

export type FeedResult = { kind: 'not-modified' } | ({ kind: 'ok' } & Observation);

export interface FeedOptions {
  name: SourceName;
  fetch: () => Promise<FeedResult>;
  tree: RegionTree;
  /** Read before every wait, so the selector can speed a feed up or slow it down. */
  intervalMs: () => number;
  log: FastifyBaseLogger;
  now?: () => number;
  /** Regions this source reports on (default: all). */
  covers?: (id: number) => boolean;
}

export class Feed {
  readonly name: SourceName;
  readonly covers: (id: number) => boolean;
  regions: ReadonlyMap<number, RegionState> | null = null;
  /** Epoch ms when `regions` was computed. */
  computedAt = 0;
  unknown: readonly (number | string)[] = [];
  /** Epoch ms of the last successful check (200 or 304); 0 if never. */
  lastOkAt = 0;
  consecutiveFailures = 0;
  consecutiveSuccesses = 0;
  lastError: string | null = null;
  /** Called after every poll, successful or not. */
  onTick: (() => void) | null = null;

  readonly #opts: FeedOptions;
  readonly #now: () => number;
  #timer: NodeJS.Timeout | null = null;
  #running = false;
  #inFlight = false;
  #again = false;

  constructor(opts: FeedOptions) {
    this.#opts = opts;
    this.name = opts.name;
    this.covers = opts.covers ?? (() => true);
    this.#now = opts.now ?? Date.now;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    void this.#loop();
  }

  stop(): void {
    this.#running = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  /** Polls as soon as possible (right after the current poll if one is in flight). */
  pollNow(): void {
    if (!this.#running) return;
    if (this.#inFlight) {
      this.#again = true;
      return;
    }
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    void this.#loop();
  }

  async #loop(): Promise<void> {
    if (!this.#running) return;
    const started = this.#now();
    this.#inFlight = true;
    await this.tick();
    this.#inFlight = false;
    if (!this.#running) return;
    const delay = this.#again ? 0 : Math.max(0, this.#opts.intervalMs() - (this.#now() - started));
    this.#again = false;
    this.#timer = setTimeout(() => void this.#loop(), delay);
  }

  /** One poll. Never throws. */
  async tick(): Promise<void> {
    const { log } = this.#opts;
    try {
      const result = await this.#opts.fetch();
      const now = this.#now();
      if (result.kind === 'ok') this.#apply(result, now);
      if (this.consecutiveFailures > 0)
        log.info({ source: this.name, failures: this.consecutiveFailures }, 'upstream recovered');
      this.lastOkAt = now;
      this.consecutiveFailures = 0;
      this.consecutiveSuccesses++;
      this.lastError = null;
    } catch (err) {
      this.consecutiveFailures++;
      this.consecutiveSuccesses = 0;
      this.lastError = err instanceof Error ? err.message : String(err);
      const level = this.consecutiveFailures === 1 || this.consecutiveFailures % 12 === 0 ? 'warn' : 'debug';
      log[level](
        { source: this.name, err: this.lastError, failures: this.consecutiveFailures },
        'upstream poll failed',
      );
    }
    this.onTick?.();
  }

  #apply(result: Observation, now: number): void {
    const previous = this.regions;
    const regions = statesFrom(result.observed, this.#opts.tree, previous, now);
    if (previous) {
      for (const [id, state] of regions) {
        const before = previous.get(id);
        if (before && before.level !== state.level) {
          this.#opts.log.debug(
            { source: this.name, region: REGION_BY_ID.get(id)?.nameLatin, from: before.level, to: state.level },
            'source level changed',
          );
        }
      }
    }
    const newUnknown = result.unknown.some((u) => !this.unknown.includes(u));
    if (newUnknown) this.#opts.log.warn({ source: this.name, unknown: result.unknown }, 'alerts for unmapped regions');
    this.regions = regions;
    this.computedAt = now;
    this.unknown = result.unknown;
  }
}

/** Siren fetcher: sends the last ETag back so unchanged data costs a 304. */
export function sirenFetcher(client: Pick<SirenClient, 'alerts'>, tree: RegionTree): () => Promise<FeedResult> {
  let etag: string | null = null;
  return async () => {
    const result = await client.alerts(etag);
    if (result.kind === 'not-modified') return result;
    etag = result.etag;
    return { kind: 'ok', ...observeSiren(collectDeclared(result.entries), tree) };
  };
}

export function tryvohaFetcher(client: Pick<TryvohaClient, 'alerts'>): () => Promise<FeedResult> {
  return async () => ({ kind: 'ok', ...observeTryvoha(await client.alerts()) });
}

/** Regions Tryvoha has (Crimea isn't one of them). */
export const tryvohaCovers = (id: number): boolean => Boolean(REGION_BY_ID.get(id)?.tryvohaSlug);
