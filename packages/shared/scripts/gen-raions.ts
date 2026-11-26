/**
 * Regenerates src/raions.ts (the raion table) from the upstream region lists.
 *
 *   pnpm --filter @alarmin/shared gen-raions [-- --siren regions.json --tryvoha regions.json]
 *
 * - Raions are Siren `District` regions; IDs are Siren `regionId`s. Tryvoha uses the same IDs for its
 *   districts and communities (checked here by ID and name), which gives each raion its Tryvoha slug.
 * - `idx` is the raion's position within its oblast (digit position in `/v1/o/:oblastId`).
 *   APPEND ONLY: existing raions keep their idx; new ones are appended; removed ones are kept and
 *   reported, so deployed watches never decode a digit as the wrong raion.
 * - Latin names use the official Ukrainian transliteration (KMU 2010, `transliterate`).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { REGION_BY_ID } from '../src/regions.ts';
import { transliterate } from '../src/translit.ts';

interface SirenNode {
  regionId: string;
  regionName: string;
  regionType?: string;
  regionChildIds?: SirenNode[] | null;
}
interface TryvohaRegion {
  id: number;
  slug: string;
  type: string;
  name_uk: string;
  name_en?: string | null;
}

/** Separately announcing cities (top-level in both sources) and the raion each lies in. */
const CITY_RAION_NAMES: Record<number, string> = {
  1293: 'Харківський район',
  564: 'Запорізький район',
};

const { values } = parseArgs({ options: { siren: { type: 'string' }, tryvoha: { type: 'string' } } });
const load = async <T>(path: string | undefined, url: string): Promise<T> =>
  (path ? JSON.parse(readFileSync(path, 'utf8')) : await (await fetch(url)).json()) as T;
const siren = await load<{ states: SirenNode[] }>(values.siren, 'https://siren.pp.ua/api/v3/regions');
const tryvoha = await load<{ regions: TryvohaRegion[] }>(values.tryvoha, 'https://tryvoha.online/api/v1/regions');

const outFile = resolve(dirname(fileURLToPath(import.meta.url)), '../src/raions.ts');

interface Row {
  id: number;
  oblastId: number;
  idx: number;
  nameLatin: string;
  nameUk: string;
  tryvohaSlug: string | null;
}

// Existing table, for the append-only idx.
const previous: Row[] = existsSync(outFile) ? [...(await import('../src/raions.ts')).RAIONS] : [];
const prevById = new Map(previous.map((r) => [r.id, r]));

const problems: string[] = [];
const notes: string[] = [];

// Siren: raions and the raion of every hromada.
const fresh = new Map<number, { oblastId: number; nameUk: string }>();
const hromadaRaion = new Map<number, number>();
for (const state of siren.states) {
  const oblastId = Number(state.regionId);
  if (!REGION_BY_ID.has(oblastId)) continue;
  for (const d of state.regionChildIds ?? []) {
    if (d.regionType !== 'District') continue;
    const id = Number(d.regionId);
    fresh.set(id, { oblastId, nameUk: d.regionName });
    for (const h of d.regionChildIds ?? []) hromadaRaion.set(Number(h.regionId), id);
  }
}

// Tryvoha: districts by Siren ID; communities → raion via the Siren tree.
const tDistricts = new Map(tryvoha.regions.filter((r) => r.type === 'district').map((r) => [r.id, r]));
for (const [id, t] of tDistricts) {
  const s = fresh.get(id);
  if (!s) problems.push(`Tryvoha district ${id} "${t.name_uk}" is not a Siren raion`);
  else if (s.nameUk !== t.name_uk) problems.push(`raion ${id}: Siren "${s.nameUk}" != Tryvoha "${t.name_uk}"`);
}
const communityRaion: [string, number][] = [];
for (const c of tryvoha.regions.filter((r) => r.type === 'community')) {
  const raion = hromadaRaion.get(c.id);
  if (raion === undefined) problems.push(`Tryvoha community ${c.id} "${c.name_uk}" has no Siren raion`);
  else communityRaion.push([c.slug, raion]);
}
communityRaion.sort((a, b) => a[0].localeCompare(b[0]));

// Rows: keep previous idx, append new raions per oblast.
const rows: Row[] = [];
const nextIdx = new Map<number, number>();
for (const p of previous) nextIdx.set(p.oblastId, Math.max(nextIdx.get(p.oblastId) ?? 0, p.idx + 1));
for (const [id, s] of [...fresh].sort((a, b) => a[0] - b[0])) {
  const prev = prevById.get(id);
  if (prev && prev.oblastId !== s.oblastId)
    problems.push(`raion ${id} moved from oblast ${prev.oblastId} to ${s.oblastId}`);
  if (prev && prev.nameUk !== s.nameUk) notes.push(`raion ${id} renamed: "${prev.nameUk}" → "${s.nameUk}"`);
  let idx = prev?.idx;
  if (idx === undefined) {
    idx = nextIdx.get(s.oblastId) ?? 0;
    nextIdx.set(s.oblastId, idx + 1);
    if (previous.length) notes.push(`new raion ${id} "${s.nameUk}" (idx ${idx})`);
  }
  const nameLatin = transliterate(s.nameUk.replace(/ район$/, ''));
  const t = tDistricts.get(id);
  const tLatin = t?.name_en?.replace(/ district$/, '');
  if (tLatin && tLatin !== nameLatin) notes.push(`raion ${id}: "${nameLatin}" (KMU) vs Tryvoha "${tLatin}"`);
  rows.push({ id, oblastId: s.oblastId, idx, nameLatin, nameUk: s.nameUk, tryvohaSlug: t?.slug ?? null });
}
for (const p of previous) {
  if (!fresh.has(p.id)) {
    notes.push(`raion ${p.id} "${p.nameUk}" no longer in Siren; kept`);
    rows.push(p);
  }
}
rows.sort((a, b) => a.oblastId - b.oblastId || a.idx - b.idx);

const cityRaion: [number, number][] = [];
for (const [city, name] of Object.entries(CITY_RAION_NAMES)) {
  const parent = REGION_BY_ID.get(Number(city))?.parentId;
  const raion = rows.find((r) => r.oblastId === parent && r.nameUk === name);
  if (!raion) problems.push(`city ${city}: no raion "${name}" in oblast ${parent}`);
  else cityRaion.push([Number(city), raion.id]);
}

if (problems.length) {
  console.error(`gen-raions: ${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

const row = (r: Row) =>
  `  { id: ${r.id}, oblastId: ${r.oblastId}, idx: ${r.idx}, nameLatin: ${JSON.stringify(r.nameLatin)}, nameUk: ${JSON.stringify(r.nameUk)}, tryvohaSlug: ${JSON.stringify(r.tryvohaSlug)} },`;

const out = `// GENERATED by packages/shared/scripts/gen-raions.ts from Siren and Tryvoha region lists. Do not edit by
// hand; rerun \`pnpm --filter @alarmin/shared gen-raions\`. idx is append-only (see the script).

/** A raion (district): the level below an oblast. IDs are Siren \`regionId\`s, as for \`REGIONS\`. */
export interface Raion {
  id: number;
  /** Top-level region (\`REGIONS\` id) the raion belongs to. */
  oblastId: number;
  /** Position within its oblast: the digit position in \`/v1/o/:oblastId\`. Append-only. */
  idx: number;
  /** KMU 2010 transliteration without "raion". */
  nameLatin: string;
  /** Name as returned by Siren. */
  nameUk: string;
  /** Tryvoha district slug; null where Tryvoha has no such raion. */
  tryvohaSlug: string | null;
}

// biome-ignore format: one row per raion
export const RAIONS: readonly Raion[] = [
${rows.map(row).join('\n')}
];

export const RAION_BY_ID: ReadonlyMap<number, Raion> = new Map(RAIONS.map((r) => [r.id, r]));
export const RAION_BY_TRYVOHA_SLUG: ReadonlyMap<string, Raion> = new Map(
  RAIONS.flatMap((r) => (r.tryvohaSlug ? [[r.tryvohaSlug, r] as const] : [])),
);
/** Raions of each oblast, in idx order. */
export const RAIONS_BY_OBLAST: ReadonlyMap<number, readonly Raion[]> = RAIONS.reduce(
  (m, r) => m.set(r.oblastId, [...(m.get(r.oblastId) ?? []), r]),
  new Map<number, Raion[]>(),
);

/** Separately announcing city (top-level region ID) → the raion it lies in. */
export const CITY_RAION: ReadonlyMap<number, number> = new Map([
${cityRaion.map(([c, r]) => `  [${c}, ${r}],`).join('\n')}
]);

/** Tryvoha community slug → raion ID (Tryvoha alerts carry slugs only). */
// biome-ignore format: one entry per line
export const TRYVOHA_COMMUNITY_RAION: ReadonlyMap<string, number> = new Map([
${communityRaion.map(([s, r]) => `  [${JSON.stringify(s)}, ${r}],`).join('\n')}
]);
`;
writeFileSync(outFile, out, 'utf8');
const missing = rows.filter((r) => !r.tryvohaSlug);
console.log(
  `wrote ${outFile}: ${rows.length} raions in ${new Set(rows.map((r) => r.oblastId)).size} oblasts, ` +
    `${communityRaion.length} Tryvoha communities; without a Tryvoha slug: ${missing.map((r) => r.nameLatin).join(', ') || 'none'}`,
);
if (notes.length) console.log(`notes:\n- ${notes.join('\n- ')}`);
