import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Flag, Level, REGIONS } from '@alarmin/shared';
import type { FastifyInstance } from 'fastify';
import type { RegionState } from '../src/normalize.ts';
import type { StatusSource } from '../src/poller.ts';
import { buildServer } from '../src/server.ts';

const KEY = 'test-key-0123456789abcdef';
const NOW = Date.parse('2026-11-24T20:30:00Z');

function makeStatus(overrides: Partial<StatusSource> = {}): StatusSource {
  const regions = new Map<number, RegionState>(REGIONS.map((r) => [r.id, { level: Level.Green, flags: 0, since: 0 }]));
  regions.set(31, { level: Level.Red, flags: 0, since: 1_764_000_000 });
  regions.set(14, { level: Level.Yellow, flags: Flag.Partial, since: 1_764_000_100 });
  return {
    snapshot: { regions, computedAt: NOW - 2000, unknownRegionIds: [] },
    lastOkAt: NOW - 3000,
    consecutiveFailures: 0,
    lastError: null,
    source: 'siren',
    ...overrides,
  };
}

async function makeApp(status: StatusSource): Promise<FastifyInstance> {
  return buildServer({
    status,
    appKeys: [KEY],
    staleAfterMs: 30_000,
    rateLimitPerMin: 1000,
    trustProxy: false,
    now: () => NOW,
  });
}

const auth = { 'x-alarmin-key': KEY };

describe('with fresh data', () => {
  let app: FastifyInstance;
  before(async () => {
    app = await makeApp(makeStatus());
  });
  after(() => app.close());

  test('rejects missing or wrong keys', async () => {
    assert.equal((await app.inject({ url: '/v1/s/31' })).statusCode, 401);
    const wrong = await app.inject({ url: '/v1/s/31', headers: { 'x-alarmin-key': 'nope' } });
    assert.equal(wrong.statusCode, 401);
  });

  test('/v1/s/:id returns the compact state', async () => {
    const res = await app.inject({ url: '/v1/s/31', headers: auth });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { l: 2, f: 0, t: 1_764_000_000, a: 3, x: 0 });
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.ok(res.body.length < 64, `payload ${res.body.length} bytes`);
  });

  test('/v1/s/:id rejects unknown regions', async () => {
    assert.equal((await app.inject({ url: '/v1/s/123456', headers: auth })).statusCode, 404);
    assert.equal((await app.inject({ url: '/v1/s/abc', headers: auth })).statusCode, 404);
  });

  test('/v1/all returns one digit per region in idx order', async () => {
    const res = await app.inject({ url: '/v1/all', headers: auth });
    const body = res.json() as { m: string; a: number; x: number };
    assert.equal(body.m.length, REGIONS.length);
    const kyivCity = REGIONS.find((r) => r.id === 31);
    const kyivska = REGIONS.find((r) => r.id === 14);
    assert.equal(body.m[kyivCity?.idx ?? -1], '2');
    assert.equal(body.m[kyivska?.idx ?? -1], '1');
  });

  test('/v1/meta', async () => {
    const res = await app.inject({ url: '/v1/meta', headers: auth });
    assert.deepEqual(res.json(), { v: 1, src: 'siren', n: REGIONS.length, min: '0.1.0' });
  });

  test('/healthz needs no key and reports ok', async () => {
    const res = await app.inject({ url: '/healthz' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().ok, true);
  });
});

describe('degraded states', () => {
  test('warming up → 503', async () => {
    const app = await makeApp(makeStatus({ snapshot: null, lastOkAt: 0 }));
    assert.equal((await app.inject({ url: '/v1/s/31', headers: auth })).statusCode, 503);
    assert.equal((await app.inject({ url: '/v1/all', headers: auth })).statusCode, 503);
    assert.equal((await app.inject({ url: '/healthz' })).statusCode, 503);
    await app.close();
  });

  test('stale data is still served, flagged x=1', async () => {
    const app = await makeApp(makeStatus({ lastOkAt: NOW - 120_000, consecutiveFailures: 24, lastError: 'boom' }));
    const res = await app.inject({ url: '/v1/s/31', headers: auth });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().x, 1);
    assert.equal(res.json().a, 120);
    assert.equal((await app.inject({ url: '/healthz' })).statusCode, 503);
    await app.close();
  });
});
