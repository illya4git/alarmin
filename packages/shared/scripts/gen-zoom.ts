/**
 * Generates the zoomed oblast maps (plan §3.5, Phase 8): one per oblast, its raions filling the screen.
 *
 *   pnpm --filter @alarmin/shared gen-zoom
 *
 * Source: OCHA Ukraine subnational administrative boundaries (COD-AB) v05, valid 2025-09-01,
 * CC BY-IGO (attribution required: credited in README and About). Downloaded once into
 * packages/shared/.cache/ocha/ (git-ignored, ~84 MB zip). Raions are matched to the Siren raion
 * table by oblast and Ukrainian name; OCHA raions Siren doesn't track (occupied Luhansk raions) are
 * drawn as "no data". Regions in ZOOM_EXTRAS (Kyiv city inside Kyivska) get their own colour.
 *
 * Output, in apps/watch/ (foreground only, loaded one oblast at a time):
 * - resources/generated/zoom/<oblastId>.fnt + .png: glyph 'A'+k is shape k's fill, 'a'+k its outline.
 * - resources/generated/zoom/<oblastId>.json: per glyph [raionId, digit idx in /v1/o, x, y, name],
 *   raions alphabetically, then "no data" shapes (raionId 0, idx -1, name ""). The raion picker
 *   reads the same file, so one resource per oblast serves both.
 * - resources/generated/zoom.xml, source/generated/RaionData.mc (resource lookup per oblast).
 * Lookups are arrays, not if-chains: generated if-chains cost ~2 KB of memory on every page.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { CITY_RAION, RAIONS_BY_OBLAST } from '../src/raions.ts';
import { REGION_BY_ID, REGIONS } from '../src/regions.ts';
import { ZOOM_EXTRAS } from '../src/zoom.ts';
import { area, bitmapFont, fitToScreen, glyphOf, type Pt, simplifyRing } from './lib/raster.ts';

const SOURCE_URL =
  'https://data.humdata.org/dataset/d23f529f-31e4-4021-a65b-13987e5cfb42/resource/681beb86-391b-4a08-8140-ca52e80fcdce/download/ukr_admin_boundaries.geojson.zip';
const ENTRY = 'ukr_admin2.geojson';
const MIN_AREA_PX = 4; // drop islets smaller than this

/** Raions renamed since 2020 under their Siren (old) name → OCHA (current) name. */
const RENAMED: Record<string, string> = {
  'Володимир-Волинський': 'Володимирський',
  Сєвєродонецький: 'Сіверськодонецький',
  Красноградський: 'Берестинський',
};
/** OCHA areas that aren't raions, drawn as part of the raion they lie in (alerts come for that raion). */
const MERGED: Record<string, string> = {
  'Чорнобильська зона відчуження': 'Вишгородський',
};
/** OCHA adm1 name of each region in ZOOM_EXTRAS (drawn in its oblast's zoom with its own colour). */
const EXTRA_OCHA: Record<number, string> = { 31: 'Київ' };

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const cacheDir = resolve(root, 'packages/shared/.cache/ocha');
const zipFile = resolve(cacheDir, 'ukr_admin_boundaries.geojson.zip');
const genDir = resolve(root, 'apps/watch/resources/generated');
const zoomDir = resolve(genDir, 'zoom');
const mcFile = resolve(root, 'apps/watch/source/generated/RaionData.mc');

/** Extracts one file from a zip (stored or deflated entries). */
function unzipOne(zip: Buffer, name: string): Buffer {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = zip.readUInt32LE(eocd + 16);
  const count = zip.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    if (zip.toString('utf8', p + 46, p + 46 + nameLen) === name) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      return method === 0 ? Buffer.from(data) : inflateRawSync(data);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${name} not in ${zipFile}`);
}

const geoFile = resolve(cacheDir, ENTRY);
if (!existsSync(geoFile)) {
  if (!existsSync(zipFile)) {
    console.log(`downloading ${SOURCE_URL}`);
    const res = await fetch(SOURCE_URL);
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(zipFile, Buffer.from(await res.arrayBuffer()));
  }
  writeFileSync(geoFile, unzipOne(readFileSync(zipFile), ENTRY));
}

interface Feature {
  properties: { adm1_name1: string; adm2_name1: string; version?: string };
  geometry: { type: 'Polygon'; coordinates: Pt[][] } | { type: 'MultiPolygon'; coordinates: Pt[][][] };
}
const features = (JSON.parse(readFileSync(geoFile, 'utf8')) as { features: Feature[] }).features;
const norm = (s: string) => s.replace(/[’ʼ]/g, "'");
const outerRings = (f: Feature): Pt[][] =>
  (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).flatMap((poly) =>
    poly[0] ? [poly[0]] : [],
  );

rmSync(zoomDir, { recursive: true, force: true });
mkdirSync(zoomDir, { recursive: true });

const problems: string[] = [];
const oblastIds = [...RAIONS_BY_OBLAST.keys()].sort((a, b) => a - b);
const report: string[] = [];
for (const oblastId of oblastIds) {
  const oblastUk = (REGION_BY_ID.get(oblastId)?.nameUk ?? '').replace(/ область$/, '');
  const raions = RAIONS_BY_OBLAST.get(oblastId) ?? [];
  const inOblast = features.filter((f) => f.properties.adm1_name1 === oblastUk);
  const extras = ZOOM_EXTRAS.get(oblastId) ?? [];

  // Shapes in glyph order: raions alphabetically, extra regions (digits after the raions in
  // /v1/o), then "no data" (OCHA raions Siren lacks).
  const shapes: { raionId: number; idx: number; name: string; lonLat: Pt[][] }[] = [];
  const used = new Set<Feature>();
  for (const r of [...raions].sort((a, b) => a.nameLatin.localeCompare(b.nameLatin, 'en'))) {
    const want = norm(RENAMED[r.nameUk.replace(/ район$/, '')] ?? r.nameUk.replace(/ район$/, ''));
    const f = inOblast.find((x) => norm(x.properties.adm2_name1) === want);
    if (!f) {
      problems.push(`${oblastUk}: no OCHA raion for ${r.id} "${r.nameUk}"`);
      continue;
    }
    used.add(f);
    const merged = inOblast.filter((x) => MERGED[x.properties.adm2_name1] === want);
    for (const m of merged) used.add(m);
    shapes.push({ raionId: r.id, idx: r.idx, name: r.nameLatin, lonLat: [f, ...merged].flatMap(outerRings) });
  }
  for (const [j, regionId] of extras.entries()) {
    const found = features.filter((f) => f.properties.adm1_name1 === EXTRA_OCHA[regionId]);
    if (!found.length) problems.push(`${oblastUk}: no OCHA shape for extra region ${regionId}`);
    const name = REGION_BY_ID.get(regionId)?.nameLatin ?? '';
    shapes.push({ raionId: regionId, idx: raions.length + j, name, lonLat: found.flatMap(outerRings) });
  }
  for (const f of inOblast.filter((x) => !used.has(x))) {
    shapes.push({ raionId: 0, idx: -1, name: '', lonLat: outerRings(f) });
  }

  const { toScreen } = fitToScreen(
    shapes.flatMap((s) => s.lonLat.flat()),
    400,
  );
  const glyphs = shapes.map((s) => {
    const rings = s.lonLat
      .map((ring) => simplifyRing(ring.map(toScreen), 0.5))
      .filter((r) => r.length >= 3 && area(r) >= MIN_AREA_PX);
    return { ...s, ...glyphOf(rings) };
  });
  const font = bitmapFont(glyphs, `${oblastId}.png`);
  writeFileSync(resolve(zoomDir, `${oblastId}.png`), font.png);
  writeFileSync(resolve(zoomDir, `${oblastId}.fnt`), font.fnt);
  writeFileSync(
    resolve(zoomDir, `${oblastId}.json`),
    `${JSON.stringify(glyphs.map((g) => [g.raionId, g.idx, g.x, g.y, g.name]))}\n`,
  );
  const noData = glyphs.filter((g) => g.idx < 0).length;
  report.push(
    `${REGION_BY_ID.get(oblastId)?.nameLatin}: ${raions.length} raions` +
      `${extras.length ? ` + ${extras.map((id) => REGION_BY_ID.get(id)?.nameLatin).join(', ')}` : ''}` +
      `${noData ? ` + ${noData} no-data` : ''}, atlas ${font.w}x${font.h}, ${font.png.length} B`,
  );
}
if (problems.length) {
  console.error(`gen-zoom: ${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

writeFileSync(
  resolve(genDir, 'zoom.xml'),
  `<!-- GENERATED by packages/shared/scripts/gen-zoom.ts. Do not edit; run the gen-zoom script of packages/shared. -->
<resources>
    <fonts>
${oblastIds.map((id) => `        <font id="Zoom${id}" filename="zoom/${id}.fnt" antialias="false"/>`).join('\n')}
    </fonts>
${oblastIds.map((id) => `    <jsonData id="ZoomData${id}" filename="zoom/${id}.json"/>`).join('\n')}
</resources>
`,
);

// Regions without raions that zoom into an oblast: cities inside one (outlining their raion), and
// ZOOM_EXTRAS regions (outlining themselves).
const cities = [
  ...REGIONS.filter((r) => r.parentId !== null).map((r) => ({
    id: r.id,
    oblast: r.parentId ?? -1,
    raion: CITY_RAION.get(r.id) ?? -1,
  })),
  ...[...ZOOM_EXTRAS].flatMap(([oblast, ids]) => ids.map((id) => ({ id, oblast, raion: id }))),
];
const list = (xs: readonly (string | number)[]) => `[${xs.join(', ')}]`;
writeFileSync(
  mcFile,
  `// GENERATED by packages/shared/scripts/gen-zoom.ts. Do not edit; run \`pnpm --filter @alarmin/shared gen-zoom\`.
import Toybox.Lang;
import Toybox.WatchUi;

// Per-oblast raion resources (foreground only): FONTS[i] draws oblast OBLASTS[i] zoomed (glyph k is
// 'A'+k fill, 'a'+k outline); DATA[i] lists [raionId, digit idx in /v1/o, x, y, name] per glyph,
// raions alphabetically, then "no data" shapes (idx -1). Used by the raion picker and ZoomView.
module RaionData {
    const OBLASTS = ${list(oblastIds)} as Array<Number>;
    const FONTS = ${list(oblastIds.map((id) => `Rez.Fonts.Zoom${id}`))} as Array<ResourceId>;
    const DATA = ${list(oblastIds.map((id) => `Rez.JsonData.ZoomData${id}`))} as Array<ResourceId>;

    // Regions without raions that zoom into an oblast: the oblast, and the shape to outline.
    const CITIES = ${list(cities.map((c) => c.id))} as Array<Number>;
    const CITY_OBLASTS = ${list(cities.map((c) => c.oblast))} as Array<Number>;
    const CITY_RAIONS = ${list(cities.map((c) => c.raion))} as Array<Number>;
}
`,
);
console.log(`zoom maps (OCHA COD-AB ${features[0]?.properties.version ?? '?'}):\n- ${report.join('\n- ')}`);
