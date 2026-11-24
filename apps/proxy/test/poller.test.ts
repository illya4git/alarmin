import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUNDLED_SIREN_PARENTS, Level } from '@alarmin/shared';
import type { FastifyBaseLogger } from 'fastify';
import { Poller } from '../src/poller.ts';
import { RegionTree } from '../src/regionTree.ts';
import type { AlertsResult } from '../src/upstream/siren.ts';

const silent = {
  info() {},
  warn() {},
  debug() {},
  error() {},
} as unknown as FastifyBaseLogger;

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

test('applies data, sends the ETag back, treats 304 as fresh, counts failures', async () => {
  let t = 1_000_000;
  const seenEtags: (string | null)[] = [];
  const responses: (AlertsResult | Error)[] = [kyivRed, { kind: 'not-modified' }, new Error('timeout')];
  const poller = new Poller({
    fetchAlerts: async (etag) => {
      seenEtags.push(etag);
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next ?? { kind: 'not-modified' };
    },
    tree: new RegionTree(BUNDLED_SIREN_PARENTS),
    intervalMs: 5000,
    log: silent,
    now: () => t,
  });

  await poller.tick();
  assert.equal(poller.snapshot?.regions.get(31)?.level, Level.Red);
  assert.equal(poller.lastOkAt, 1_000_000);

  t += 5000;
  await poller.tick();
  assert.equal(poller.lastOkAt, 1_005_000, '304 refreshes lastOkAt');
  assert.equal(poller.snapshot?.computedAt, 1_000_000, '304 keeps the snapshot');

  t += 5000;
  await poller.tick();
  assert.equal(poller.consecutiveFailures, 1);
  assert.equal(poller.lastError, 'timeout');
  assert.equal(poller.lastOkAt, 1_005_000);

  assert.deepEqual(seenEtags, [null, '"v1"', '"v1"']);
});
