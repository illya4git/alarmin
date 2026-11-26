/**
 * Generates the watch minimap (plan §3.5, Phase 7) from Natural Earth admin-1 boundaries.
 *
 *   pnpm --filter @alarmin/shared gen-map
 *
 * Source: Natural Earth 1:10m "Admin 1 – States, Provinces" v5.1.2 (public domain), downloaded once
 * into packages/shared/.cache/ (git-ignored, ~40 MB). Regions are matched by ISO 3166-2 code.
 *
 * Output, in apps/watch/:
 * - resources/generated/map.fnt + map.png: a bitmap font (BMFont text format). Glyph 'A'+k is
 *   region k's fill, 'a'+k its 1-px outline. A glyph is drawn in the current colour, so the watch
 *   paints any region in any colour with one drawText call and no per-point work (drawing 1,254
 *   points with fillPolygon/drawLine took seconds on the FR55).
 * - source/generated/MapData.mc: which region each glyph is, where it goes, and the city dots.
 * Shapes are simplified on the 208-px grid (<= 60 points each, the detail of the first
 * fillPolygon map), then rasterized (scripts/lib/raster.ts, shared with gen-zoom).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGIONS } from '../src/regions.ts';
import { area, bitmapFont, fitToScreen, glyphOf, type Pt, simplifyRing } from './lib/raster.ts';

const SOURCE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_1_states_provinces.geojson';

const MAX_POINTS = 60; // detail level of the first map (fillPolygon's 64-point limit)
const MIN_AREA_PX = 6; // drop islands smaller than this

/** ISO 3166-2 → Siren region id. Sevastopol is drawn as part of Crimea (no source covers it). */
const ISO_TO_ID: Record<string, number> = {
  'UA-05': 4, // Vinnytska
  'UA-07': 8, // Volynska
  'UA-12': 9, // Dnipropetrovska
  'UA-14': 28, // Donetska
  'UA-18': 10, // Zhytomyrska
  'UA-21': 11, // Zakarpatska
  'UA-23': 12, // Zaporizka
  'UA-26': 13, // Ivano-Frankivska
  'UA-32': 14, // Kyivska
  'UA-35': 15, // Kirovohradska
  'UA-09': 16, // Luhanska
  'UA-46': 27, // Lvivska
  'UA-48': 17, // Mykolaivska
  'UA-51': 18, // Odeska
  'UA-53': 19, // Poltavska
  'UA-56': 5, // Rivnenska
  'UA-59': 20, // Sumska
  'UA-61': 21, // Ternopilska
  'UA-63': 22, // Kharkivska
  'UA-65': 23, // Khersonska
  'UA-68': 3, // Khmelnytska
  'UA-71': 24, // Cherkaska
  'UA-77': 26, // Chernivetska
  'UA-74': 25, // Chernihivska
  'UA-43': 9999, // Crimea
  'UA-40': 9999, // Sevastopol → Crimea
};

/** Cities drawn as dots: [lon, lat]. Kyiv city's polygon (UA-30) is only a few pixels wide. */
const DOTS: Record<number, [number, number]> = {
  31: [30.52, 50.45], // Kyiv city
  1293: [36.23, 49.99], // Kharkiv city
  564: [35.14, 47.84], // Zaporizhzhia city
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const cacheFile = resolve(root, 'packages/shared/.cache/ne_10m_admin_1_v5.1.2.geojson');
const outDir = resolve(root, 'apps/watch/resources/generated');
const mcFile = resolve(root, 'apps/watch/source/generated/MapData.mc');

if (!existsSync(cacheFile)) {
  console.log(`downloading ${SOURCE_URL}`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  mkdirSync(dirname(cacheFile), { recursive: true });
  writeFileSync(cacheFile, Buffer.from(await res.arrayBuffer()));
}

interface Feature {
  properties: { iso_3166_2?: string };
  geometry: { type: 'Polygon'; coordinates: Pt[][] } | { type: 'MultiPolygon'; coordinates: Pt[][][] };
}
const features = (JSON.parse(readFileSync(cacheFile, 'utf8')) as { features: Feature[] }).features;

// Outer rings per region id, in lon/lat.
const rings: { id: number; ring: Pt[] }[] = [];
for (const f of features) {
  const id = ISO_TO_ID[f.properties.iso_3166_2 ?? ''];
  if (id === undefined) continue;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) if (poly[0]) rings.push({ id, ring: poly[0] });
}
const missingIso = Object.keys(ISO_TO_ID).filter((iso) => !features.some((f) => f.properties.iso_3166_2 === iso));
if (missingIso.length) throw new Error(`missing in source: ${missingIso.join(', ')}`);

const { scale, cy, toScreen } = fitToScreen(rings.flatMap((r) => r.ring));

const idxOf = new Map<number, number>(REGIONS.map((r) => [r.id, r.idx]));

/** Simplified screen-space rings per region map index. */
const shapes = new Map<number, Pt[][]>();
let totalPoints = 0;
let dropped = 0;
for (const { id, ring } of rings) {
  const screen = ring.map(toScreen);
  let tol = 0.5;
  let pts = simplifyRing(screen, tol);
  while (pts.length > MAX_POINTS) {
    tol *= 1.2;
    pts = simplifyRing(screen, tol);
  }
  if (pts.length < 3 || area(pts) < MIN_AREA_PX) {
    dropped++;
    continue;
  }
  const idx = idxOf.get(id) as number;
  shapes.set(idx, [...(shapes.get(idx) ?? []), pts]);
  totalPoints += pts.length;
}

const dots = Object.entries(DOTS).map(([id, ll]) => {
  const [x, y] = toScreen(ll);
  return [idxOf.get(Number(id)) as number, Math.round(x), Math.round(y)];
});

const covered = new Set([...shapes.keys(), ...dots.map((d) => d[0])]);
const uncovered = REGIONS.filter((r) => !covered.has(r.idx));
if (uncovered.length) throw new Error(`regions without geometry: ${uncovered.map((r) => r.nameLatin).join(', ')}`);

const glyphs = [...shapes.entries()].sort((p, q) => p[0] - q[0]).map(([idx, rs]) => ({ idx, ...glyphOf(rs) }));
const font = bitmapFont(glyphs, 'map.png');

const mc = `// GENERATED by packages/shared/scripts/gen-map.ts. Do not edit; run \`pnpm --filter @alarmin/shared gen-map\`.
import Toybox.Lang;

// Minimap glyphs (font Rez.Fonts.Map): glyph k is char 'A'+k (fill) and 'a'+k (outline),
// drawn with its top-left at (X[k], Y[k]).
module MapData {
    const COUNT = ${glyphs.length};
    // Region map index (digit position in /v1/all) per glyph.
    const IDX = [${glyphs.map((g) => g.idx).join(', ')}] as Array<Number>;
    const X = [${glyphs.map((g) => g.x).join(', ')}] as Array<Number>;
    const Y = [${glyphs.map((g) => g.y).join(', ')}] as Array<Number>;
    // Cities too small to fill, drawn as dots: [region idx, x, y].
    const DOTS = [${dots.map((d) => `[${d.join(', ')}]`).join(', ')}] as Array<Array<Number>>;
}
`;

mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'map.png'), font.png);
writeFileSync(resolve(outDir, 'map.fnt'), font.fnt);
writeFileSync(
  resolve(outDir, 'map.xml'),
  `<!-- GENERATED by packages/shared/scripts/gen-map.ts. Do not edit; run the gen-map script of packages/shared. -->
<resources>
    <fonts>
        <font id="Map" filename="map.fnt" antialias="false"/>
    </fonts>
</resources>
`,
);
mkdirSync(dirname(mcFile), { recursive: true });
writeFileSync(mcFile, mc);
console.log(
  `map: scale ${scale.toFixed(2)} px/unit, centre y ${cy}, ${glyphs.length} regions (${dropped} islands dropped), ` +
    `${totalPoints} points, atlas ${font.w}x${font.h} (${font.png.length} bytes PNG)`,
);
