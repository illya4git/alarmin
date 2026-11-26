import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { BUNDLED_SIREN_PARENTS, Level } from '@alarmin/shared';
import type { FastifyBaseLogger } from 'fastify';
import { Feed, type FeedResult, tryvohaCovers } from '../src/feed.ts';
import type { Observed } from '../src/normalize.ts';
import { RegionTree } from '../src/regionTree.ts';
import { SourceSelector } from '../src/sources.ts';

const tree = new RegionTree(BUNDLED_SIREN_PARENTS);
const KYIV_CITY = 31;
const CRIMEA = 9999;
const LVIVSKA = 27;

const warnings: string[] = [];
const log = {
  info() {},
  debug() {},
  error() {},
  warn(_obj: unknown, msg: string) {
    warnings.push(msg);
  },
} as unknown as FastifyBaseLogger;

const red = (top: number): Observed => ({ top, scope: 'own', raion: '', type: 'AIR', level: 'Red', createdAt: 0 });

/** A feed whose next poll result is set by the test. */
function scripted(name: 'siren' | 'tryvoha', clock: { t: number }) {
  let next: FeedResult | Error = { kind: 'ok', observed: [], unknown: [] };
  const feed = new Feed({
    name,
    fetch: async () => {
      if (next instanceof Error) throw next;
      return next;
    },
    tree,
    intervalMs: () => 5000,
    log,
    now: () => clock.t,
    ...(name === 'tryvoha' ? { covers: tryvohaCovers } : {}),
  });
  return {
    feed,
    set(r: Observed[] | Error) {
      next = r instanceof Error ? r : { kind: 'ok', observed: r, unknown: [] };
    },
  };
}

describe('SourceSelector', () => {
  const clock = { t: 0 };
  let siren: ReturnType<typeof scripted>;
  let tryvoha: ReturnType<typeof scripted>;
  let sel: SourceSelector;

  /** Advances the clock and polls the given feeds (the selector re-evaluates after each). */
  async function step(ms: number, ...feeds: Feed[]) {
    clock.t += ms;
    for (const f of feeds) await f.tick();
  }

  beforeEach(() => {
    clock.t = 1_800_000_000_000;
    warnings.length = 0;
    siren = scripted('siren', clock);
    tryvoha = scripted('tryvoha', clock);
    sel = new SourceSelector({
      primary: siren.feed,
      fallback: tryvoha.feed,
      log,
      now: () => clock.t,
      primaryFreshMs: 30_000,
      fallbackFreshMs: 124_000,
    });
    siren.feed.onTick = () => sel.evaluate();
    tryvoha.feed.onTick = () => sel.evaluate();
  });

  test('serves Siren while it is healthy', async () => {
    siren.set([red(KYIV_CITY), red(CRIMEA)]);
    await step(0, siren.feed, tryvoha.feed);
    assert.equal(sel.mode, 'primary');
    assert.equal(sel.source, 'siren');
    assert.equal(sel.snapshot?.regions.get(KYIV_CITY)?.level, Level.Red);
    assert.equal(sel.snapshot?.regions.get(CRIMEA)?.unknown, undefined);
    assert.equal(sel.lastOkAt, clock.t);
  });

  test('fails over after 3 Siren failures and back after 3 successes, keeping since', async () => {
    siren.set([red(KYIV_CITY), red(CRIMEA)]);
    tryvoha.set([red(KYIV_CITY)]);
    await step(0, siren.feed, tryvoha.feed);
    const since = sel.snapshot?.regions.get(KYIV_CITY)?.since;

    siren.set(new Error('HTTP 502'));
    await step(5000, siren.feed);
    await step(5000, siren.feed);
    assert.equal(sel.mode, 'primary', 'two failures are not enough');
    await step(5000, siren.feed);
    assert.equal(sel.mode, 'fallback');
    assert.equal(sel.source, 'tryvoha');
    assert.ok(warnings.includes('switching to fallback source'));

    await step(1000, tryvoha.feed);
    const kyiv = sel.snapshot?.regions.get(KYIV_CITY);
    assert.equal(kyiv?.level, Level.Red);
    assert.equal(kyiv?.since, since, 'since survives the switch while the level holds');
    assert.equal(sel.lastOkAt, clock.t, 'age follows the serving source');

    const crimea = sel.snapshot?.regions.get(CRIMEA);
    assert.equal(crimea?.unknown, true, 'Tryvoha has no Crimea');
    assert.equal(crimea?.level, Level.Red, 'last known level kept, never green');

    siren.set([red(KYIV_CITY), red(CRIMEA)]);
    await step(5000, siren.feed);
    await step(5000, siren.feed);
    assert.equal(sel.mode, 'fallback');
    await step(5000, siren.feed);
    assert.equal(sel.mode, 'primary');
    assert.equal(sel.snapshot?.regions.get(CRIMEA)?.unknown, undefined);
  });

  test('fails over when Siren has not answered for 30 s', async () => {
    siren.set([]);
    await step(0, siren.feed);
    await step(31_000, tryvoha.feed);
    assert.equal(sel.mode, 'fallback');
  });

  test('both down: the last snapshot is kept and ages', async () => {
    siren.set([red(KYIV_CITY)]);
    await step(0, siren.feed);
    const okAt = sel.lastOkAt;
    siren.set(new Error('down'));
    tryvoha.set(new Error('down'));
    for (let i = 0; i < 5; i++) await step(5000, siren.feed, tryvoha.feed);
    assert.equal(sel.mode, 'fallback');
    assert.equal(sel.snapshot?.regions.get(KYIV_CITY)?.level, Level.Red);
    assert.equal(sel.lastOkAt, okAt);
  });

  /** Siren every 5 s, Tryvoha every 60 s, like production. */
  async function run(seconds: number) {
    for (let i = 0; i < seconds / 5; i++) {
      clock.t += 5000;
      await siren.feed.tick();
      if ((clock.t / 1000) % 60 === 0) await tryvoha.feed.tick();
    }
  }

  test('reports a disagreement only after it lasts 3 minutes', async () => {
    siren.set([red(KYIV_CITY)]);
    tryvoha.set([]);
    await step(0, siren.feed, tryvoha.feed);
    await run(175);
    assert.equal(sel.divergent.length, 0);
    await run(5);
    assert.deepEqual(
      sel.divergent.map((d) => [d.id, d.levels]),
      [[KYIV_CITY, { siren: Level.Red, tryvoha: Level.Green }]],
    );
    assert.ok(warnings.includes('sources disagree'));

    tryvoha.set([red(KYIV_CITY)]);
    await step(0, tryvoha.feed);
    assert.equal(sel.divergent.length, 0);
  });

  test('stale cross-check data is not compared', async () => {
    siren.set([red(KYIV_CITY)]);
    tryvoha.set([]);
    await step(0, siren.feed, tryvoha.feed);
    tryvoha.set(new Error('timeout'));
    await run(300);
    assert.equal(sel.divergent.length, 0);
    assert.ok(!warnings.includes('sources disagree'));
  });

  test('regions Tryvoha lacks are not compared', async () => {
    siren.set([red(CRIMEA)]);
    tryvoha.set([]);
    await step(0, siren.feed, tryvoha.feed);
    for (let i = 0; i < 40; i++) await step(5000, siren.feed);
    assert.equal(sel.divergent.length, 0);
  });

  test('without a fallback, Siren failures never switch', async () => {
    const only = new SourceSelector({
      primary: siren.feed,
      fallback: null,
      log,
      now: () => clock.t,
      primaryFreshMs: 30_000,
      fallbackFreshMs: 0,
    });
    siren.feed.onTick = () => only.evaluate();
    siren.set([red(LVIVSKA)]);
    await step(0, siren.feed);
    siren.set(new Error('down'));
    for (let i = 0; i < 10; i++) await step(5000, siren.feed);
    assert.equal(only.mode, 'primary');
    assert.equal(only.snapshot?.regions.get(LVIVSKA)?.level, Level.Red);
  });
});
