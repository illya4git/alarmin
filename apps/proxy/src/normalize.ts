/**
 * Turns raw upstream alerts into one state per top-level region (plan §3.1, D3):
 *
 * - RED    = the region itself has a Red air-raid alert, or every one of its raions does
 *            (upstream usually declares oblast-wide alerts raion by raion).
 * - YELLOW = the region itself is at Yellow, or any raion/hromada inside it (or a
 *            separately announcing city with `parentId`) has an air-raid alert.
 * - GREEN  = otherwise.
 * Artillery and urban-fight alerts only set flags.
 *
 * Each source is first mapped to `Observed` alerts (`observeSiren`, `observeTryvoha`);
 * `statesFrom` applies the rule above to either.
 */
import { Flag, Level, REGION_BY_ID, REGION_BY_TRYVOHA_SLUG, REGIONS } from '@alarmin/shared';
import type { RegionTree } from './regionTree.ts';
import type { SirenAlertEntry } from './upstream/siren.ts';
import type { TryvohaAlert } from './upstream/tryvoha.ts';

export interface RegionState {
  level: Level;
  flags: number;
  /** Epoch seconds when the current level began; 0 if unknown. */
  since: number;
  /** The serving source doesn't cover this region; the level is the last known one (or green if none). */
  unknown?: boolean;
}

export interface DeclaredAlert {
  regionId: number;
  type: string;
  level: 'Red' | 'Yellow';
  /** Epoch ms. */
  createdAt: number;
}

/** One alert, placed relative to the top-level region it falls in. Source-neutral. */
export interface Observed {
  /** Top-level region (Siren ID, a key of `REGIONS`). */
  top: number;
  /** Declared on the region itself, on one of its raions, or deeper (hromada). */
  scope: 'own' | 'raion' | 'sub';
  /** Identifies the raion when `scope` is `raion` (counted against the tree's raion count). */
  raion: string;
  type: string;
  level: 'Red' | 'Yellow';
  /** Epoch ms; 0 if unknown. */
  createdAt: number;
}

export interface Observation {
  observed: Observed[];
  /** Upstream region IDs or slugs that don't map to any known top-level region. */
  unknown: (number | string)[];
}

// Unknown level strings are treated as Red: over-warning beats missing an alert.
const toLevel = (s: string): 'Red' | 'Yellow' => (s === 'Yellow' || s === 'yellow' ? 'Yellow' : 'Red');

const parseTime = (s: string | null | undefined): number => {
  const t = Date.parse(s ?? '');
  return Number.isFinite(t) ? t : 0;
};

/** De-duplicates Siren alerts by the region that declared them (drops inherited copies). */
export function collectDeclared(entries: readonly SirenAlertEntry[]): DeclaredAlert[] {
  const byKey = new Map<string, DeclaredAlert>();
  for (const entry of entries) {
    for (const alert of entry.activeAlerts) {
      const levels = alert.activeAlertLevels?.length
        ? alert.activeAlertLevels
        : [{ alertLevel: 'Red', createdAt: alert.lastUpdate ?? '' }];
      for (const lvl of levels) {
        const level = toLevel(lvl.alertLevel);
        const declared: DeclaredAlert = {
          regionId: Number(alert.regionId),
          type: alert.type,
          level,
          createdAt: parseTime(lvl.createdAt),
        };
        const key = `${declared.regionId}|${declared.type}|${level}`;
        const existing = byKey.get(key);
        if (!existing || (declared.createdAt && declared.createdAt < existing.createdAt)) byKey.set(key, declared);
      }
    }
  }
  return [...byKey.values()];
}

export function observeSiren(declared: readonly DeclaredAlert[], tree: RegionTree): Observation {
  const observed: Observed[] = [];
  const unknown = new Set<number>();
  for (const d of declared) {
    const top = tree.topOf(d.regionId);
    if (!REGION_BY_ID.has(top)) {
      unknown.add(d.regionId);
      continue;
    }
    const scope = d.regionId === top ? 'own' : tree.parentOf(d.regionId) === top ? 'raion' : 'sub';
    observed.push({ top, scope, raion: String(d.regionId), type: d.type, level: d.level, createdAt: d.createdAt });
  }
  return { observed, unknown: [...unknown] };
}

/** Tryvoha publishes air-raid alerts only. Its slugs map to Siren IDs via `packages/shared`. */
export function observeTryvoha(alerts: readonly TryvohaAlert[]): Observation {
  const observed: Observed[] = [];
  const unknown = new Set<string>();
  for (const a of alerts) {
    const isState = a.type === 'state';
    const slug = isState ? a.slug : (a.oblast_slug ?? '');
    const region = REGION_BY_TRYVOHA_SLUG.get(slug);
    if (!region) {
      unknown.add(slug || a.slug);
      continue;
    }
    observed.push({
      top: region.id,
      scope: isState ? 'own' : a.type === 'district' ? 'raion' : 'sub',
      raion: a.slug,
      type: 'AIR',
      level: toLevel(a.level),
      createdAt: parseTime(a.started_at),
    });
  }
  return { observed, unknown: [...unknown] };
}

interface Acc {
  ownRed: number | null; // earliest createdAt (ms) of the region's own Red AIR alert
  ownYellow: number | null;
  partial: number | null; // earliest AIR alert anywhere below the region
  redRaions: Map<string, number>; // raion → createdAt of its own Red AIR alert
  flags: number;
}

const minTime = (a: number | null, b: number): number => (a === null ? b : Math.min(a, b));

/**
 * Applies the D3 rule. `since` is kept from `previous` while a level holds, set to now on a
 * transition, and estimated from upstream timestamps on cold start (`previous` null).
 */
export function statesFrom(
  observed: readonly Observed[],
  tree: RegionTree,
  previous: ReadonlyMap<number, RegionState> | null,
  nowMs: number,
): Map<number, RegionState> {
  const acc = new Map<number, Acc>(
    REGIONS.map((r) => [r.id, { ownRed: null, ownYellow: null, partial: null, redRaions: new Map(), flags: 0 }]),
  );

  for (const o of observed) {
    const a = acc.get(o.top);
    if (!a) continue;
    if (o.type === 'ARTILLERY') {
      a.flags |= Flag.Artillery;
      continue;
    }
    if (o.type === 'URBAN_FIGHTS') {
      a.flags |= Flag.UrbanFights;
      continue;
    }
    if (o.type !== 'AIR') continue;

    if (o.scope === 'own') {
      if (o.level === 'Red') a.ownRed = minTime(a.ownRed, o.createdAt);
      else a.ownYellow = minTime(a.ownYellow, o.createdAt);
    } else {
      a.partial = minTime(a.partial, o.createdAt);
      if (o.level === 'Red' && o.scope === 'raion') {
        a.redRaions.set(o.raion, Math.min(a.redRaions.get(o.raion) ?? o.createdAt, o.createdAt));
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
    // Raions come from the Siren tree for both sources; Tryvoha uses its own raion slugs,
    // so the check compares counts (the 2026-11-25 recording matched 1:1 this way).
    const raionCount = tree.childrenOf(id).length;
    const allRaionsRed = raionCount > 0 && a.redRaions.size >= raionCount;
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
        startMs = a.ownRed ?? Math.max(0, ...a.redRaions.values());
      } else if (level === Level.Yellow) {
        startMs = Math.min(a.ownYellow ?? Number.POSITIVE_INFINITY, a.partial ?? Number.POSITIVE_INFINITY);
      }
      since = Number.isFinite(startMs) && startMs > 0 ? Math.floor(startMs / 1000) : 0;
    }

    regions.set(id, { level, flags, since });
  }
  return regions;
}

export interface NormalizeResult {
  regions: Map<number, RegionState>;
  /** Declared region IDs that don't map to any known top-level region. */
  unknownRegionIds: number[];
}

/** Siren alerts → states (kept as one call for callers and tests that only deal with Siren). */
export function computeStates(
  declared: readonly DeclaredAlert[],
  tree: RegionTree,
  previous: ReadonlyMap<number, RegionState> | null,
  nowMs: number,
): NormalizeResult {
  const { observed, unknown } = observeSiren(declared, tree);
  return {
    regions: statesFrom(observed, tree, previous, nowMs),
    unknownRegionIds: unknown.filter((id): id is number => typeof id === 'number'),
  };
}
