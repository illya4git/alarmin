import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { BUNDLED_SIREN_PARENTS, Flag, Level, REGIONS } from '@alarmin/shared';
import { collectDeclared, computeStates, type DeclaredAlert, type RegionState } from '../src/normalize.ts';
import { RegionTree } from '../src/regionTree.ts';
import { type SirenAlertEntry, SirenAlertsSchema } from '../src/upstream/siren.ts';

const tree = new RegionTree(BUNDLED_SIREN_PARENTS);
const NOW = Date.parse('2026-11-24T20:30:00Z');
const NOW_S = NOW / 1000;

/** Recorded siren.pp.ua /api/v3/alerts at 2026-11-24 20:25 UTC. */
const fixture: SirenAlertEntry[] = SirenAlertsSchema.parse(
  JSON.parse(readFileSync(new URL('./fixtures/siren-alerts-20261124.json', import.meta.url), 'utf8')),
);

const ID = {
  donetska: 28,
  zaporizka: 12,
  dnipropetrovska: 9,
  kharkivska: 22,
  odeska: 18,
  sumska: 20,
  luhanska: 16,
  crimea: 9999,
  zaporizhzhiaCity: 564,
  kharkivCity: 1293,
  kyivCity: 31,
  lvivska: 27,
  kyivska: 14,
};

describe('recorded snapshot', () => {
  const { regions, unknownRegionIds } = computeStates(collectDeclared(fixture), tree, null, NOW);
  const level = (id: number) => regions.get(id)?.level;
  const flags = (id: number) => regions.get(id)?.flags ?? 0;

  test('every region gets a state', () => {
    assert.equal(regions.size, REGIONS.length);
    assert.deepEqual(unknownRegionIds, []);
  });

  test('oblasts with every raion under Red alert are red', () => {
    assert.equal(level(ID.donetska), Level.Red);
    assert.equal(level(ID.zaporizka), Level.Red);
  });

  test('region-level Red alerts are red', () => {
    assert.equal(level(ID.luhanska), Level.Red);
    assert.equal(level(ID.crimea), Level.Red);
    assert.equal(level(ID.zaporizhzhiaCity), Level.Red);
  });

  test('some raions under alert → yellow, partial', () => {
    for (const id of [ID.dnipropetrovska, ID.odeska, ID.sumska, ID.kharkivska]) {
      assert.equal(level(id), Level.Yellow, `region ${id}`);
      assert.ok(flags(id) & Flag.Partial, `region ${id} partial flag`);
    }
  });

  test('artillery sets a flag without changing the colour on its own', () => {
    assert.ok(flags(ID.kharkivska) & Flag.Artillery);
  });

  test('a city alert marks its parent oblast partial', () => {
    assert.ok(flags(ID.zaporizka) & Flag.Partial);
  });

  test('quiet regions are green', () => {
    for (const id of [ID.kyivCity, ID.lvivska, ID.kyivska, ID.kharkivCity]) {
      assert.equal(level(id), Level.Green, `region ${id}`);
      assert.equal(regions.get(id)?.since, 0);
    }
  });

  test('cold-start since comes from upstream timestamps', () => {
    const since = regions.get(ID.crimea)?.since ?? 0;
    assert.ok(since > 0 && since < NOW_S);
  });
});

describe('collectDeclared', () => {
  test('drops alerts inherited from ancestors', () => {
    const raion = (type: string) => ({
      regionId: '122',
      regionType: 'District',
      type,
      activeAlertLevels: [{ alertLevel: 'Red', createdAt: '2026-11-24T10:00:00Z' }],
    });
    const declared = collectDeclared([
      { regionId: '122', regionType: 'District', activeAlerts: [raion('AIR')] },
      { regionId: '1313', regionType: 'Community', activeAlerts: [raion('AIR')] },
    ]);
    assert.equal(declared.length, 1);
    assert.equal(declared[0]?.regionId, 122);
  });

  test('missing levels and unknown level strings count as Red', () => {
    const declared = collectDeclared([
      {
        regionId: '14',
        regionType: 'State',
        activeAlerts: [
          { regionId: '14', regionType: 'State', type: 'AIR', lastUpdate: '2026-11-24T10:00:00Z' },
          {
            regionId: '14',
            regionType: 'State',
            type: 'AIR',
            activeAlertLevels: [{ alertLevel: 'Purple', createdAt: '2026-11-24T09:00:00Z' }],
          },
        ],
      },
    ]);
    assert.deepEqual(
      declared.map((d) => d.level),
      ['Red'],
    );
    assert.equal(declared[0]?.createdAt, Date.parse('2026-11-24T09:00:00Z'));
  });
});

describe('computeStates', () => {
  const air = (regionId: number, level: 'Red' | 'Yellow' = 'Red'): DeclaredAlert => ({
    regionId,
    type: 'AIR',
    level,
    createdAt: NOW - 60_000,
  });

  test('region-level Yellow → yellow with own-yellow flag', () => {
    const { regions } = computeStates([air(ID.kyivska, 'Yellow')], tree, null, NOW);
    assert.equal(regions.get(ID.kyivska)?.level, Level.Yellow);
    assert.equal(regions.get(ID.kyivska)?.flags, Flag.OwnYellow);
  });

  test('all raions Yellow is still yellow, not red', () => {
    const raions = tree.childrenOf(ID.kyivska);
    const { regions } = computeStates(
      raions.map((r) => air(r, 'Yellow')),
      tree,
      null,
      NOW,
    );
    assert.equal(regions.get(ID.kyivska)?.level, Level.Yellow);
  });

  test('a community alert alone makes the oblast yellow', () => {
    const raion = tree.childrenOf(ID.lvivska)[0] ?? -1;
    const community = tree.childrenOf(raion)[0] ?? -1;
    const { regions } = computeStates([air(community)], tree, null, NOW);
    assert.equal(regions.get(ID.lvivska)?.level, Level.Yellow);
  });

  test('since is kept while the level holds and reset on a transition', () => {
    const previous = new Map<number, RegionState>([
      [ID.kyivCity, { level: Level.Red, flags: 0, since: 1000 }],
      [ID.lvivska, { level: Level.Green, flags: 0, since: 0 }],
    ]);
    const { regions } = computeStates([air(ID.kyivCity), air(ID.lvivska)], tree, previous, NOW);
    assert.equal(regions.get(ID.kyivCity)?.since, 1000);
    assert.equal(regions.get(ID.lvivska)?.since, NOW_S);
  });

  test('alerts outside the tree are reported, not applied', () => {
    const { unknownRegionIds } = computeStates([air(123456)], tree, null, NOW);
    assert.deepEqual(unknownRegionIds, [123456]);
  });
});
