/**
 * Analyses a recorder run: replays Siren snapshots through the proxy's normaliser,
 * applies the same colour rule (plan D3) to Tryvoha, and compares the two.
 *
 *   node spikes/upstream-recorder/analyze.ts spikes/upstream-recorder/data/<run>
 *
 * Snapshot file names are UTC times (yyyyMMdd-HHmmss-fff). Siren snapshots are only
 * saved when the body changed; Tryvoha is saved on every poll.
 */
// biome-ignore-all lint/style/noNonNullAssertion: one-off analysis over known, non-empty recordings
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectDeclared, computeStates, type RegionState } from '../../apps/proxy/src/normalize.ts';
import { RegionTree } from '../../apps/proxy/src/regionTree.ts';
import { SirenAlertsSchema } from '../../apps/proxy/src/upstream/siren.ts';
import {
  BUNDLED_SIREN_PARENTS,
  Flag,
  Level,
  REGION_BY_ID,
  REGION_BY_TRYVOHA_SLUG,
  REGIONS,
} from '../../packages/shared/src/index.ts';

const dir = process.argv[2];
if (!dir) throw new Error('usage: analyze.ts <run dir>');

const tree = new RegionTree(BUNDLED_SIREN_PARENTS);
const LEVEL_NAME = ['green', 'yellow', 'red'] as const;

/** Reads UTF-8 text, dropping the BOM Windows PowerShell writes. */
const readText = (path: string) => readFileSync(path, 'utf8').replace(/^﻿/, '');

function fileTime(name: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(\d{3})/.exec(name);
  if (!m) throw new Error(`bad snapshot name ${name}`);
  const [, y, mo, d, h, mi, s, ms] = m.map(Number) as number[];
  return Date.UTC(y!, mo! - 1, d!, h!, mi!, s!, ms!);
}

function snapshots(feed: string): { t: number; body: unknown }[] {
  const d = join(dir!, feed);
  return readdirSync(d)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ t: fileTime(f), body: JSON.parse(readText(join(d, f))) }));
}

type Levels = Map<number, Level>;
interface Series {
  points: { t: number; levels: Levels; flags: Map<number, number> }[];
  /** First-seen lag of alerts that started during the run: observation time âˆ’ upstream start, seconds. */
  lags: number[];
}

// ---------------------------------------------------------------- Siren
function sirenSeries(): Series & { noopChanges: number; unknownIds: Set<number> } {
  const points: Series['points'] = [];
  const lags: number[] = [];
  const seen = new Set<string>();
  const unknownIds = new Set<number>();
  let previous: Map<number, RegionState> | null = null;
  let prevDeclKey = '';
  let noopChanges = 0;
  const snaps = snapshots('siren');
  const runStart = snaps[0]!.t;
  for (const { t, body } of snaps) {
    const entries = SirenAlertsSchema.parse(body);
    const declared = collectDeclared(entries);
    const declKey = declared
      .map((d) => `${d.regionId}|${d.type}|${d.level}|${d.createdAt}`)
      .sort()
      .join(',');
    if (declKey === prevDeclKey) noopChanges++;
    prevDeclKey = declKey;
    for (const d of declared) {
      const key = `${d.regionId}|${d.type}|${d.level}|${d.createdAt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (points.length > 0 && d.createdAt > runStart) lags.push((t - d.createdAt) / 1000);
    }
    const result = computeStates(declared, tree, previous, t);
    for (const id of result.unknownRegionIds) unknownIds.add(id);
    previous = result.regions;
    points.push({
      t,
      levels: new Map([...result.regions].map(([id, s]) => [id, s.level])),
      flags: new Map([...result.regions].map(([id, s]) => [id, s.flags])),
    });
  }
  return { points, lags, noopChanges, unknownIds };
}

// ---------------------------------------------------------------- Tryvoha
interface TryvohaAlert {
  slug: string;
  type: string;
  oblast_slug: string;
  level: string;
  started_at: string;
}

function tryvohaSeries(): Series & { unmappedSlugs: Set<string> } {
  const points: Series['points'] = [];
  const lags: number[] = [];
  const seen = new Set<string>();
  const unmappedSlugs = new Set<string>();
  const snaps = snapshots('tryvoha');
  const runStart = snaps[0]!.t;
  for (const { t, body } of snaps) {
    const alerts = (body as { alerts: TryvohaAlert[] }).alerts;
    const ownRed = new Set<number>();
    const ownYellow = new Set<number>();
    const partial = new Set<number>();
    const redDistricts = new Map<number, Set<string>>();
    for (const a of alerts) {
      const key = `${a.slug}|${a.level}|${a.started_at}`;
      if (!seen.has(key)) {
        seen.add(key);
        const started = Date.parse(a.started_at);
        if (points.length > 0 && started > runStart) lags.push((t - started) / 1000);
      }
      const region = REGION_BY_TRYVOHA_SLUG.get(a.type === 'state' ? a.slug : a.oblast_slug);
      if (!region) {
        unmappedSlugs.add(a.type === 'state' ? a.slug : a.oblast_slug);
        continue;
      }
      const red = a.level !== 'yellow';
      if (a.type === 'state') {
        (red ? ownRed : ownYellow).add(region.id);
      } else {
        partial.add(region.id);
        if (red && a.type === 'district') {
          const set = redDistricts.get(region.id) ?? new Set();
          set.add(a.slug);
          redDistricts.set(region.id, set);
        }
      }
    }
    const levels: Levels = new Map();
    const flags = new Map<number, number>();
    for (const r of REGIONS) {
      // City alerts make the parent oblast partial (same as the Siren rule).
      if (r.parentId !== null && (ownRed.has(r.id) || ownYellow.has(r.id) || partial.has(r.id))) {
        partial.add(r.parentId);
      }
    }
    for (const r of REGIONS) {
      const raions = tree.childrenOf(r.id).length;
      const allRed = raions > 0 && (redDistricts.get(r.id)?.size ?? 0) >= raions;
      const level =
        ownRed.has(r.id) || allRed ? Level.Red : ownYellow.has(r.id) || partial.has(r.id) ? Level.Yellow : Level.Green;
      levels.set(r.id, level);
      flags.set(r.id, (ownYellow.has(r.id) ? Flag.OwnYellow : 0) | (partial.has(r.id) ? Flag.Partial : 0));
    }
    points.push({ t, levels, flags });
  }
  return { points, lags, unmappedSlugs };
}

// ---------------------------------------------------------------- helpers
interface Transition {
  id: number;
  t: number;
  from: Level;
  to: Level;
}

function transitions(points: Series['points']): Transition[] {
  const out: Transition[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    for (const [id, to] of cur.levels) {
      const from = prev.levels.get(id)!;
      if (from !== to) out.push({ id, t: cur.t, from, to });
    }
  }
  return out;
}

/** Level at time t (last point at or before t), or undefined before the first point. */
function levelAt(points: Series['points'], id: number, t: number): Level | undefined {
  let lo = 0;
  let hi = points.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.t <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found < 0 ? undefined : points[found]!.levels.get(id);
}

function quantile(xs: number[], q: number): number {
  if (!xs.length) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
}

const fmtS = (x: number) => (Number.isNaN(x) ? 'â€“' : `${Math.round(x)} s`);
const hhmm = (t: number) => new Date(t).toISOString().slice(11, 19);
const name = (id: number) => REGION_BY_ID.get(id)?.nameLatin ?? String(id);
const stats = (xs: number[]) =>
  `n=${xs.length}, min ${fmtS(Math.min(...xs))}, median ${fmtS(quantile(xs, 0.5))}, p90 ${fmtS(quantile(xs, 0.9))}, max ${fmtS(Math.max(...xs))}`;

// ---------------------------------------------------------------- report
const siren = sirenSeries();
const tryvoha = tryvohaSeries();
const polls = readText(join(dir, 'polls.jsonl'))
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as { feed: string; status?: number; changed?: boolean; ms?: number });

const start = Math.max(siren.points[0]!.t, tryvoha.points[0]!.t);
const end = Math.min(siren.points.at(-1)!.t, tryvoha.points.at(-1)!.t, Date.parse('9999-01-01'));
const runEnd = Math.max(...polls.map((p) => Date.parse((p as unknown as { ts: string }).ts)).filter(Number.isFinite));

console.log(`# Recorder run ${dir}`);
console.log(`window ${hhmm(start)}â€“${hhmm(runEnd)} UTC\n`);

console.log('## Polling');
for (const feed of ['siren', 'tryvoha']) {
  const p = polls.filter((x) => x.feed === feed);
  const ok200 = p.filter((x) => x.status === 200);
  const ms = p.map((x) => x.ms ?? 0).filter((x) => x > 0);
  console.log(
    `${feed}: ${p.length} polls, ${ok200.length}Ã—200 (${ok200.filter((x) => x.changed).length} new bodies), ` +
      `${p.filter((x) => x.status === 304).length}Ã—304, ${p.filter((x) => !x.status).length} failed; ` +
      `latency median ${quantile(ms, 0.5)} ms, p99 ${quantile(ms, 0.99)} ms`,
  );
}
console.log(
  `siren: ${siren.points.length} distinct bodies, ${siren.noopChanges} of them with no change in declared alerts`,
);
if (siren.unknownIds.size) console.log(`siren: unknown region ids ${[...siren.unknownIds].join(', ')}`);
if (tryvoha.unmappedSlugs.size) console.log(`tryvoha: unmapped slugs ${[...tryvoha.unmappedSlugs].join(', ')}`);

console.log('\n## Upstream lag (first seen âˆ’ alert start, alerts started during the run)');
console.log(`siren:   ${stats(siren.lags)}  (resolution 5 s)`);
console.log(`tryvoha: ${stats(tryvoha.lags)}  (resolution 30 s)`);

const sT = transitions(siren.points);
const tT = transitions(tryvoha.points);
console.log('\n## Region colour changes');
console.log(`siren ${sT.length}, tryvoha ${tT.length}`);

const flapWindow = 120_000;
for (const [label, ts] of [
  ['siren', sT],
  ['tryvoha', tT],
] as const) {
  const flaps = ts.filter((x) =>
    ts.some((y) => y.id === x.id && y.t > x.t && y.t - x.t <= flapWindow && y.to === x.from),
  );
  console.log(`${label}: ${flaps.length} changes reverted within ${flapWindow / 1000} s`);
  for (const f of flaps) console.log(`  ${hhmm(f.t)} ${name(f.id)} ${LEVEL_NAME[f.from]}â†’${LEVEL_NAME[f.to]}`);
}

console.log('\n## Tryvoha delay vs Siren (matched changes, same region and new colour, Â±15 min)');
const matchWindow = 15 * 60_000;
const used = new Set<Transition>();
const matched: { s: Transition; delay: number }[] = [];
const unmatchedSiren: Transition[] = [];
for (const s of sT) {
  let best: Transition | undefined;
  for (const t of tT) {
    if (used.has(t) || t.id !== s.id || t.to !== s.to || Math.abs(t.t - s.t) > matchWindow) continue;
    if (!best || Math.abs(t.t - s.t) < Math.abs(best.t - s.t)) best = t;
  }
  if (best) {
    used.add(best);
    matched.push({ s, delay: (best.t - s.t) / 1000 });
  } else unmatchedSiren.push(s);
}
const unmatchedTryvoha = tT.filter((t) => !used.has(t));
console.log(`delay (positive = Tryvoha later): ${stats(matched.map((m) => m.delay))}`);
for (const lvl of [Level.Red, Level.Yellow, Level.Green]) {
  console.log(`  â†’${LEVEL_NAME[lvl]}: ${stats(matched.filter((m) => m.s.to === lvl).map((m) => m.delay))}`);
}
console.log(`siren-only changes: ${unmatchedSiren.length}`);
for (const s of unmatchedSiren) console.log(`  ${hhmm(s.t)} ${name(s.id)} ${LEVEL_NAME[s.from]}â†’${LEVEL_NAME[s.to]}`);
console.log(`tryvoha-only changes: ${unmatchedTryvoha.length}`);
for (const s of unmatchedTryvoha)
  console.log(`  ${hhmm(s.t)} ${name(s.id)} ${LEVEL_NAME[s.from]}â†’${LEVEL_NAME[s.to]}`);

console.log('\n## Agreement (sampled every 5 s; a 30 s Tryvoha poll gap counts as disagreement)');
const step = 5000;
let total = 0;
let agree = 0;
const perRegion = new Map<number, { total: number; agree: number; pairs: Map<string, number> }>();
for (let t = start; t <= end; t += step) {
  for (const r of REGIONS) {
    const a = levelAt(siren.points, r.id, t);
    const b = levelAt(tryvoha.points, r.id, t);
    if (a === undefined || b === undefined) continue;
    const pr = perRegion.get(r.id) ?? { total: 0, agree: 0, pairs: new Map() };
    pr.total++;
    total++;
    if (a === b) {
      pr.agree++;
      agree++;
    } else {
      const k = `siren ${LEVEL_NAME[a]} / tryvoha ${LEVEL_NAME[b]}`;
      pr.pairs.set(k, (pr.pairs.get(k) ?? 0) + 1);
    }
    perRegion.set(r.id, pr);
  }
}
console.log(`overall ${((100 * agree) / total).toFixed(2)}% of region-samples agree`);
for (const [id, pr] of [...perRegion].sort((a, b) => a[1].agree / a[1].total - b[1].agree / b[1].total)) {
  if (pr.agree === pr.total) continue;
  const pairs = [...pr.pairs].map(([k, n]) => `${k}: ${Math.round((n * step) / 60_000)} min`).join('; ');
  console.log(`  ${name(id)} ${((100 * pr.agree) / pr.total).toFixed(1)}% â€” ${pairs}`);
}

console.log('\n## Time per colour (Siren)');
const colourTime = new Map<number, number[]>();
for (let i = 0; i < siren.points.length; i++) {
  const p = siren.points[i]!;
  const until = siren.points[i + 1]?.t ?? runEnd;
  for (const [id, l] of p.levels) {
    const arr = colourTime.get(id) ?? [0, 0, 0];
    arr[l]! += until - p.t;
    colourTime.set(id, arr);
  }
}
for (const r of REGIONS) {
  const [g, y, red] = (colourTime.get(r.id) ?? [0, 0, 0]).map((ms) => Math.round(ms / 60_000));
  const changes = sT.filter((x) => x.id === r.id).length;
  console.log(
    `  ${r.nameLatin.padEnd(18)} green ${String(g).padStart(3)} min, yellow ${String(y).padStart(3)}, red ${String(red).padStart(3)}, changes ${changes}`,
  );
}
