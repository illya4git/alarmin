/**
 * Turns raw Siren alerts into one state per top-level region (plan §3.1, D3):
 *
 * - RED    = the region itself has a Red air-raid alert, or every one of its raions does
 *            (upstream usually declares oblast-wide alerts raion by raion).
 * - YELLOW = the region itself is at Yellow, or any raion/hromada inside it (or a
 *            separately announcing city with `parentId`) has an air-raid alert.
 * - GREEN  = otherwise.
 * Artillery and urban-fight alerts only set flags.
 */
import { Flag, Level, REGION_BY_ID, REGIONS } from '@alarmin/shared';
import type { RegionTree } from './regionTree.ts';
import type { SirenAlertEntry } from './upstream/siren.ts';

export interface RegionState {
  level: Level;
  flags: number;
  /** Epoch seconds when the current level began; 0 if unknown. */
  since: number;
}

export interface DeclaredAlert {
  regionId: number;
  type: string;
  level: 'Red' | 'Yellow';
  /** Epoch ms. */
  createdAt: number;
}

/** De-duplicates alerts by the region that declared them (drops inherited copies). */
export function collectDeclared(entries: readonly SirenAlertEntry[]): DeclaredAlert[] {
  const byKey = new Map<string, DeclaredAlert>();
  for (const entry of entries) {
    for (const alert of entry.activeAlerts) {
      const levels = alert.activeAlertLevels?.length
        ? alert.activeAlertLevels
        : [{ alertLevel: 'Red', createdAt: alert.lastUpdate ?? '' }];
      for (const lvl of levels) {
        // Unknown level strings are treated as Red: over-warning beats missing an alert.
        const level = lvl.alertLevel === 'Yellow' ? 'Yellow' : 'Red';
        const createdAt = Date.parse(lvl.createdAt);
        const declared: DeclaredAlert = {
          regionId: Number(alert.regionId),
          type: alert.type,
          level,
          createdAt: Number.isFinite(createdAt) ? createdAt : 0,
        };
        const key = `${declared.regionId}|${declared.type}|${level}`;
        const existing = byKey.get(key);
        if (!existing || (declared.createdAt && declared.createdAt < existing.createdAt)) byKey.set(key, declared);
      }
    }
  }
  return [...byKey.values()];
}

interface Acc {
  ownRed: number | null; // earliest createdAt (ms) of the region's own Red AIR alert
  ownYellow: number | null;
  partial: number | null; // earliest AIR alert anywhere below the region
  redRaions: Map<number, number>; // raion id → createdAt of its own Red AIR alert
  flags: number;
}

const minTime = (a: number | null, b: number): number => (a === null ? b : Math.min(a, b));

export interface NormalizeResult {
  regions: Map<number, RegionState>;
  /** Declared region IDs that don't map to any known top-level region. */
  unknownRegionIds: number[];
}

export function computeStates(
  declared: readonly DeclaredAlert[],
  tree: RegionTree,
  previous: ReadonlyMap<number, RegionState> | null,
  nowMs: number,
): NormalizeResult {
  const acc = new Map<number, Acc>(
    REGIONS.map((r) => [r.id, { ownRed: null, ownYellow: null, partial: null, redRaions: new Map(), flags: 0 }]),
  );
  const unknown = new Set<number>();

  for (const alert of declared) {
    const top = tree.topOf(alert.regionId);
    const a = acc.get(top);
    if (!a) {
      unknown.add(alert.regionId);
      continue;
    }
    if (alert.type === 'ARTILLERY') {
      a.flags |= Flag.Artillery;
      continue;
    }
    if (alert.type === 'URBAN_FIGHTS') {
      a.flags |= Flag.UrbanFights;
      continue;
    }
    if (alert.type !== 'AIR') continue;

    if (alert.regionId === top) {
      if (alert.level === 'Red') a.ownRed = minTime(a.ownRed, alert.createdAt);
      else a.ownYellow = minTime(a.ownYellow, alert.createdAt);
    } else {
      a.partial = minTime(a.partial, alert.createdAt);
      if (alert.level === 'Red' && tree.parentOf(alert.regionId) === top) {
        a.redRaions.set(alert.regionId, alert.createdAt);
      }
    }
  }

  // Separately announcing cities make their parent oblast partial.
  for (const region of REGIONS) {
    if (region.parentId === null) continue;
    const city = acc.get(region.id);
    const parent = acc.get(region.parentId);
    if (!city || !parent) continue;
    const cityAir = [city.ownRed, city.ownYellow, city.partial].filter((t): t is number => t !== null);
    if (cityAir.length) parent.partial = minTime(parent.partial, Math.min(...cityAir));
  }

  const nowS = Math.floor(nowMs / 1000);
  const regions = new Map<number, RegionState>();
  for (const [id, a] of acc) {
    const raions = tree.childrenOf(id);
    const allRaionsRed = raions.length > 0 && raions.every((r) => a.redRaions.has(r));
    const red = a.ownRed !== null || allRaionsRed;

    let flags = a.flags;
    if (a.ownYellow !== null) flags |= Flag.OwnYellow;
    if (a.partial !== null) flags |= Flag.Partial;

    const level: Level = red ? Level.Red : a.ownYellow !== null || a.partial !== null ? Level.Yellow : Level.Green;

    const prev = previous?.get(id);
    let since: number;
    if (prev && prev.level === level) {
      since = prev.since;
    } else if (previous) {
      since = nowS; // transition observed live
    } else {
      // Cold start: best guess from upstream timestamps.
      let startMs = 0;
      if (level === Level.Red) {
        startMs = a.ownRed ?? Math.max(...raions.map((r) => a.redRaions.get(r) ?? 0));
      } else if (level === Level.Yellow) {
        startMs = Math.min(a.ownYellow ?? Number.POSITIVE_INFINITY, a.partial ?? Number.POSITIVE_INFINITY);
      }
      since = Number.isFinite(startMs) && startMs > 0 ? Math.floor(startMs / 1000) : 0;
    }

    regions.set(id, { level, flags, since });
  }

  return { regions, unknownRegionIds: [...unknown].filter((id) => !REGION_BY_ID.has(id)) };
}
