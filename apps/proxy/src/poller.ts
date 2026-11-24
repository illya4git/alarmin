import { REGION_BY_ID } from '@alarmin/shared';
import type { FastifyBaseLogger } from 'fastify';
import { collectDeclared, computeStates, type RegionState } from './normalize.ts';
import type { RegionTree } from './regionTree.ts';
import type { AlertsResult } from './upstream/siren.ts';

export interface Snapshot {
  regions: ReadonlyMap<number, RegionState>;
  /** Epoch ms when this snapshot was computed. */
  computedAt: number;
  unknownRegionIds: readonly number[];
}

/** Read-only view the HTTP layer needs. */
export interface StatusSource {
  readonly snapshot: Snapshot | null;
  /** Epoch ms of the last successful upstream check (200 or 304); 0 if never. */
  readonly lastOkAt: number;
  readonly consecutiveFailures: number;
  readonly lastError: string | null;
  readonly source: string;
}

export interface PollerOptions {
  fetchAlerts: (etag: string | null) => Promise<AlertsResult>;
  tree: RegionTree;
  intervalMs: number;
  log: FastifyBaseLogger;
  now?: () => number;
}

export class Poller implements StatusSource {
  readonly source = 'siren';
  snapshot: Snapshot | null = null;
  lastOkAt = 0;
  consecutiveFailures = 0;
  lastError: string | null = null;

  readonly #opts: PollerOptions;
  readonly #now: () => number;
  #etag: string | null = null;
  #timer: NodeJS.Timeout | null = null;
  #running = false;

  constructor(opts: PollerOptions) {
    this.#opts = opts;
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

  async #loop(): Promise<void> {
    if (!this.#running) return;
    const started = this.#now();
    await this.tick();
    if (!this.#running) return;
    const delay = Math.max(0, this.#opts.intervalMs - (this.#now() - started));
    this.#timer = setTimeout(() => void this.#loop(), delay);
  }

  /** One poll. Never throws. */
  async tick(): Promise<void> {
    const { log } = this.#opts;
    try {
      const result = await this.#opts.fetchAlerts(this.#etag);
      const now = this.#now();
      if (result.kind === 'ok') {
        this.#etag = result.etag;
        this.#apply(result, now);
      }
      if (this.consecutiveFailures > 0) log.info({ failures: this.consecutiveFailures }, 'upstream recovered');
      this.lastOkAt = now;
      this.consecutiveFailures = 0;
      this.lastError = null;
    } catch (err) {
      this.consecutiveFailures++;
      this.lastError = err instanceof Error ? err.message : String(err);
      const level = this.consecutiveFailures === 1 || this.consecutiveFailures % 12 === 0 ? 'warn' : 'debug';
      log[level]({ err: this.lastError, failures: this.consecutiveFailures }, 'upstream poll failed');
    }
  }

  #apply(result: Extract<AlertsResult, { kind: 'ok' }>, now: number): void {
    const declared = collectDeclared(result.entries);
    const previous = this.snapshot?.regions ?? null;
    const { regions, unknownRegionIds } = computeStates(declared, this.#opts.tree, previous, now);

    if (previous) {
      for (const [id, state] of regions) {
        const before = previous.get(id);
        if (before && before.level !== state.level) {
          this.#opts.log.info(
            { region: REGION_BY_ID.get(id)?.nameLatin, id, from: before.level, to: state.level, flags: state.flags },
            'level changed',
          );
        }
      }
    }
    if (unknownRegionIds.length) this.#opts.log.warn({ unknownRegionIds }, 'alerts for regions outside the tree');

    this.snapshot = { regions, computedAt: now, unknownRegionIds };
  }
}
