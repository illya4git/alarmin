/**
 * Checks the shared region table against the live upstream region lists.
 * Exits non-zero on drift (renamed/removed regions or raions, changed slugs, new regions or raions);
 * fix raion drift with `gen-raions`.
 * Usage: pnpm --filter @alarmin/shared verify-upstream
 */
import { RAION_BY_ID, RAIONS } from '../src/raions.ts';
import { REGION_BY_ID, REGION_BY_TRYVOHA_SLUG, REGIONS } from '../src/regions.ts';

interface SirenState {
  regionId: string;
  regionName: string;
  regionType: string;
  regionChildIds?: SirenState[] | null;
}
interface TryvohaRegion {
  id: number;
  slug: string;
  type: string;
  name_uk: string;
}

const IGNORED_SIREN_IDS = new Set([0]); // "Тестовий регіон"

const problems: string[] = [];

const siren = (await (await fetch('https://siren.pp.ua/api/v3/regions')).json()) as { states: SirenState[] };
const sirenIds = new Set<number>();
for (const s of siren.states) {
  const id = Number(s.regionId);
  sirenIds.add(id);
  if (IGNORED_SIREN_IDS.has(id)) continue;
  const known = REGION_BY_ID.get(id);
  if (!known) problems.push(`Siren has a new top-level region ${id} "${s.regionName}"`);
  else if (known.nameUk !== s.regionName)
    problems.push(`Siren ${id}: name "${s.regionName}" != table "${known.nameUk}"`);
}
for (const r of REGIONS) {
  if (!sirenIds.has(r.id)) problems.push(`Table region ${r.id} (${r.nameLatin}) missing in Siren`);
}

const sirenRaions = new Set<number>();
for (const s of siren.states) {
  for (const d of s.regionChildIds ?? []) {
    if (d.regionType !== 'District') continue;
    const id = Number(d.regionId);
    sirenRaions.add(id);
    const known = RAION_BY_ID.get(id);
    if (!known) problems.push(`Siren has a new raion ${id} "${d.regionName}"`);
    else if (known.nameUk !== d.regionName)
      problems.push(`raion ${id}: name "${d.regionName}" != table "${known.nameUk}"`);
    else if (known.oblastId !== Number(s.regionId)) problems.push(`raion ${id} moved to oblast ${s.regionId}`);
  }
}
for (const r of RAIONS) {
  if (!sirenRaions.has(r.id)) problems.push(`Table raion ${r.id} (${r.nameLatin}) missing in Siren`);
}

const tryvoha = (await (await fetch('https://tryvoha.online/api/v1/regions')).json()) as { regions: TryvohaRegion[] };
const tryvohaStates = tryvoha.regions.filter((r) => r.type === 'state');
for (const t of tryvohaStates) {
  if (!REGION_BY_TRYVOHA_SLUG.has(t.slug)) problems.push(`Tryvoha has an unmapped state "${t.slug}" (${t.name_uk})`);
}
const tryvohaSlugs = new Set(tryvohaStates.map((t) => t.slug));
for (const r of REGIONS) {
  if (r.tryvohaSlug && !tryvohaSlugs.has(r.tryvohaSlug))
    problems.push(`Table slug "${r.tryvohaSlug}" missing in Tryvoha`);
}

const tryvohaDistricts = new Map(tryvoha.regions.filter((r) => r.type === 'district').map((r) => [r.id, r.slug]));
for (const r of RAIONS) {
  const slug = tryvohaDistricts.get(r.id) ?? null;
  if (slug !== r.tryvohaSlug)
    problems.push(`raion ${r.id} (${r.nameLatin}): Tryvoha slug "${slug}" != table "${r.tryvohaSlug}"`);
}
for (const id of tryvohaDistricts.keys()) {
  if (!RAION_BY_ID.has(id)) problems.push(`Tryvoha has an unmapped district ${id}`);
}

if (problems.length) {
  console.error(`Region table drift (${problems.length}):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(
  `Region and raion tables match Siren (${siren.states.length} states, ${sirenRaions.size} raions) and Tryvoha (${tryvohaStates.length} states, ${tryvohaDistricts.size} districts).`,
);
