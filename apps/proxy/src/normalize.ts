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
 * Raions (Phase 8) get the same rule one level down, plus what applies to their whole oblast:
 * - RED    = the raion's own Red alert, every one of its hromadas Red, or the oblast's own Red.
 * - YELLOW = the raion's own Yellow, the oblast's own Yellow, or any hromada (or separately
 *            announcing city, `CITY_RAION`) inside it under alert.
 * Raion states share the map with the top-level regions; Siren IDs don't overlap.
 *
 * Each source is first mapped to `Observed` alerts (`observeSiren`, `observeTryvoha`);
 * `statesFrom` applies the rule above to either.
 */
import {
  CITY_RAION,
  Flag,
  Level,
  RAION_BY_ID,
  RAION_BY_TRYVOHA_SLUG,
  RAIONS,
  REGION_BY_ID,
  REGION_BY_TRYVOHA_SLUG,
  REGIONS,
  TRYVOHA_COMMUNITY_RAION,
} from '@alarmin/shared';
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
  /** The declaring region (Siren ID or Tryvoha slug): counted as a raion of the oblast when `scope` is `raion`, as a hromada of the raion when `sub`. */
  raion: string;
  /** Siren ID of the raion the alert falls in (`raion` and `sub` scope); null for own scope or when not known. */
  raionId: number | null;
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
    // The raion is the declaring region's ancestor just below the top-level region.
    let raionId: number | null = null;
    if (scope !== 'own') {
      raionId = d.regionId;
      for (let p = tree.parentOf(raionId); p !== undefined && p !== top; p = tree.parentOf(raionId)) raionId = p;
    }
    observed.push({
      top,
      scope,
      raion: String(d.regionId),
      raionId,
      type: d.type,
      level: d.level,
      createdAt: d.createdAt,
    });
  }
  return { observed, unknown: [...unknown] };
}

/** Tryvoha publishes air-raid alerts only. Its slugs map to Siren IDs via `packages/shared`. */
export function observeTryvoha(alerts: readonly TryvohaAlert[]): Observation {
  const observed: Observed[] = [];
  const unknown = new Set<string>();
  for (const a of alerts) {
    const isState = a.type === 'state';
    let raionId: number | null = null;
    if (a.type === 'district') raionId = RAION_BY_TRYVOHA_SLUG.get(a.slug)?.id ?? null;
    else if (!isState) raionId = TRYVOHA_COMMUNITY_RAION.get(a.slug) ?? null;
    // Some communities come without `oblast_slug`; their raion still places them.
    const slug = isState ? a.slug : (a.oblast_slug ?? '');
    const raionOblast = raionId === null ? undefined : RAION_BY_ID.get(raionId)?.oblastId;
    const region =
      REGION_BY_TRYVOHA_SLUG.get(slug) ?? (raionOblast === undefined ? undefined : REGION_BY_ID.get(raionOblast));
    if (!region) {
      unknown.add(slug || a.slug);
      continue;
    }
    observed.push({
      top: region.id,
      scope: isState ? 'own' : a.type === 'district' ? 'raion' : 'sub',
      raion: a.slug,
      raionId,
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
  /** Direct child (raion of an oblast, hromada of a raion) → createdAt of its own Red AIR alert. */
  redChildren: Map<string, number>;
  flags: number;
}

const newAcc = (): Acc => ({ ownRed: null, ownYellow: null, partial: null, redChildren: new Map(), flags: 0 });
const minTime = (a: number | null, b: number): number => (a === null ? b : Math.min(a, b));

/** Adds one alert to a region's accumulator. `child` is the direct child that declared it, if any. */
function add(a: Acc, o: Observed, own: boolean, child: string | null): void {
  if (o.type === 'ARTILLERY') {
    a.flags |= Flag.Artillery;
    return;
  }
  if (o.type === 'URBAN_FIGHTS') {
    a.flags |= Flag.UrbanFights;
    return;
  }
  if (o.type !== 'AIR') return;
  if (own) {
    if (o.level === 'Red') a.ownRed = minTime(a.ownRed, o.createdAt);
    else a.ownYellow = minTime(a.ownYellow, o.createdAt);
    return;
  }
  a.partial = minTime(a.partial, o.createdAt);
  if (o.level === 'Red' && child !== null) {
    a.redChildren.set(child, Math.min(a.redChildren.get(child) ?? o.createdAt, o.createdAt));
  }
}

/** Earliest air-raid alert on or under the region, or null if none. */
function anyAir(a: Acc): number | null {
  const times = [a.ownRed, a.ownYellow, a.partial].filter((t): t is number => t !== null);
  return times.length ? Math.min(...times) : null;
}

/**
 * Level, flags and `since` from an accumulator. `childCount` is the number of direct children in
 * the Siren tree (raions of an oblast, hromadas of a raion), for the all-children-red rule.
 */
function finish(a: Acc, childCount: number, prev: RegionState | undefined, cold: boolean, nowS: number): RegionState {
  // Tryvoha uses its own slugs for children, so the check compares counts
  // (the 2026-11-25 recording matched 1:1 this way for oblasts).
  const allChildrenRed = childCount > 0 && a.redChildren.size >= childCount;
  const red = a.ownRed !== null || allChildrenRed;

  let flags = a.flags;
  if (a.ownYellow !== null) flags |= Flag.OwnYellow;
  if (a.partial !== null) flags |= Flag.Partial;

  const level: Level = red ? Level.Red : a.ownYellow !== null || a.partial !== null ? Level.Yellow : Level.Green;

  let since: number;
  if (prev && prev.level === level) {
    since = prev.since;
  } else if (!cold) {
    since = nowS; // transition observed live
  } else {
    // Cold start: best guess from upstream timestamps.
    let startMs = 0;
    if (level === Level.Red) {
      startMs = a.ownRed ?? Math.max(0, ...a.redChildren.values());
    } else if (level === Level.Yellow) {
      startMs = Math.min(a.ownYellow ?? Number.POSITIVE_INFINITY, a.partial ?? Number.POSITIVE_INFINITY);
    }
    since = Number.isFinite(startMs) && startMs > 0 ? Math.floor(startMs / 1000) : 0;
  }
  return { level, flags, since };
}

/**
 * Applies the D3 rule to top-level regions and raions (one map, keyed by Siren ID). `since` is kept
 * from `previous` while a level holds, set to now on a transition, and estimated from upstream
 * timestamps on cold start (`previous` null).
 */
export function statesFrom(
  observed: readonly Observed[],
  tree: RegionTree,
  previous: ReadonlyMap<number, RegionState> | null,
  nowMs: number,
): Map<number, RegionState> {
  const acc = new Map<number, Acc>(REGIONS.map((r) => [r.id, newAcc()]));
  const raionAcc = new Map<number, Acc>(RAIONS.map((r) => [r.id, newAcc()]));

  for (const o of observed) {
    const a = acc.get(o.top);
    if (!a) continue;
    add(a, o, o.scope === 'own', o.scope === 'raion' ? o.raion : null);
    const r = o.raionId === null ? undefined : raionAcc.get(o.raionId);
    if (r) add(r, o, o.scope === 'raion', o.scope === 'sub' ? o.raion : null);
  }

  // Separately announcing cities make their parent oblast and their raion partial.
  for (const region of REGIONS) {
    if (region.parentId === null) continue;
    const city = acc.get(region.id);
    const start = city ? anyAir(city) : null;
    if (start === null) continue;
    const parent = acc.get(region.parentId);
    if (parent) parent.partial = minTime(parent.partial, start);
    const raionId = CITY_RAION.get(region.id);
    const raion = raionId === undefined ? undefined : raionAcc.get(raionId);
    if (raion) raion.partial = minTime(raion.partial, start);
  }

  // An oblast's own alert covers every raion in it.
  for (const raion of RAIONS) {
    const oblast = acc.get(raion.oblastId);
    const r = raionAcc.get(raion.id);
    if (!oblast || !r) continue;
    if (oblast.ownRed !== null) r.ownRed = minTime(r.ownRed, oblast.ownRed);
    if (oblast.ownYellow !== null) r.ownYellow = minTime(r.ownYellow, oblast.ownYellow);
  }

  const nowS = Math.floor(nowMs / 1000);
  const cold = previous === null;
  const states = new Map<number, RegionState>();
  for (const [id, a] of [...acc, ...raionAcc]) {
    states.set(id, finish(a, tree.childrenOf(id).length, previous?.get(id), cold, nowS));
  }
  return states;
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
