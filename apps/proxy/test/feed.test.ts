import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUNDLED_SIREN_PARENTS, Level } from '@alarmin/shared';
import type { FastifyBaseLogger } from 'fastify';
import { Feed, sirenFetcher, tryvohaFetcher } from '../src/feed.ts';
import { RegionTree } from '../src/regionTree.ts';
import type { AlertsResult } from '../src/upstream/siren.ts';

const silent = { info() {}, warn() {}, debug() {}, error() {} } as unknown as FastifyBaseLogger;
const tree = new RegionTree(BUNDLED_SIREN_PARENTS);

const kyivRed: AlertsResult = {
  kind: 'ok',
  etag: '"v1"',
  entries: [
    {
      regionId: '31',
      regionType: 'State',
      activeAlerts: [
        {
          regionId: '31',
          regionType: 'State',
          type: 'AIR',
          activeAlertLevels: [{ alertLevel: 'Red', createdAt: '2026-11-24T20:00:00Z' }],
        },
      ],
    },
  ],
};

test('siren feed applies data, sends the ETag back, treats 304 as fresh, counts failures', async () => {
  let t = 1_000_000;
  const seenEtags: (string | null)[] = [];
  const responses: (AlertsResult | Error)[] = [kyivRed, { kind: 'not-modified' }, new Error('timeout')];
  const client = {
    alerts: async (etag: string | null) => {
      seenEtags.push(etag);
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next ?? ({ kind: 'not-modified' } as const);
    },
  };
  let ticks = 0;
  const feed = new Feed({
    name: 'siren',
    fetch: sirenFetcher(client, tree),
    tree,
    intervalMs: () => 5000,
    log: silent,
    now: () => t,
  });
  feed.onTick = () => ticks++;

  await feed.tick();
  assert.equal(feed.regions?.get(31)?.level, Level.Red);
  assert.equal(feed.lastOkAt, 1_000_000);

  t += 5000;
  await feed.tick();
  assert.equal(feed.lastOkAt, 1_005_000, '304 refreshes lastOkAt');
  assert.equal(feed.computedAt, 1_000_000, '304 keeps the regions');
  assert.equal(feed.consecutiveSuccesses, 2);

  t += 5000;
  await feed.tick();
  assert.equal(feed.consecutiveFailures, 1);
  assert.equal(feed.consecutiveSuccesses, 0);
  assert.equal(feed.lastError, 'timeout');
  assert.equal(feed.lastOkAt, 1_005_000);

  assert.deepEqual(seenEtags, [null, '"v1"', '"v1"']);
  assert.equal(ticks, 3, 'onTick runs after every poll');
});

test('tryvoha feed maps slugs and reports unmapped ones', async () => {
  const client = {
    alerts: async () => [
      { slug: 'kyiv', type: 'state', oblast_slug: 'kyiv', level: 'red', started_at: '2026-11-24T20:00:00Z' },
      { slug: 'nowhere', type: 'state', oblast_slug: 'nowhere', level: 'red', started_at: null },
    ],
  };
  const feed = new Feed({
    name: 'tryvoha',
    fetch: tryvohaFetcher(client),
    tree,
    intervalMs: () => 60_000,
    log: silent,
  });
  await feed.tick();
  assert.equal(feed.regions?.get(31)?.level, Level.Red);
  assert.equal(feed.regions?.get(31)?.since, Date.parse('2026-11-24T20:00:00Z') / 1000);
  assert.deepEqual(feed.unknown, ['nowhere']);
});
