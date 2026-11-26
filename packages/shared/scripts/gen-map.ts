/**
 * Generates the watch minimap (plan §3.5, Phase 7) from Natural Earth admin-1 boundaries.
 *
 *   pnpm --filter @alarmin/shared gen-map
 *
 * Source: Natural Earth 1:10m "Admin 1 – States, Provinces" v5.1.2 (public domain), downloaded once
 * into packages/shared/.cache/ (git-ignored, ~40 MB). Regions are matched by ISO 3166-2 code.
 *
 * Output: apps/watch/resources/generated/map.json + map.xml (a jsonData resource, loaded only
 * while the map page is shown). Format, all coordinates in screen pixels:
 *   { "w": screen size, "p": [[idx, n, packed...], ...], "d": [[idx, x, y], ...] }
 * - `p`: one entry per polygon (outer ring only). `idx` is the region's map index (the digit
 *   position in /v1/all), `n` the point count (≤ 64, the Dc.fillPolygon limit), then the points
 *   packed two per Number: x1<<24 | y1<<16 | x2<<8 | y2 (written as signed 32-bit).
 * - `d`: cities too small to fill at this scale, drawn as dots.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGIONS } from '../src/regions.ts';

const SOURCE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_1_states_provinces.geojson';

/** Screen size (FR55: 208×208, round). */
const SCREEN = 208;
/** Points must stay inside this circle, and above the footer line. */
const MAX_RADIUS = SCREEN / 2 - 4;
const MAX_Y = 168;
const MAX_POINTS = 60; // fillPolygon allows 64; keep a margin
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

type Pt = [number, number];

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const cacheFile = resolve(root, 'packages/shared/.cache/ne_10m_admin_1_v5.1.2.geojson');
const outDir = resolve(root, 'apps/watch/resources/generated');

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

// Equirectangular projection around Ukraine's middle latitude; y grows downwards.
const K = Math.cos((48.5 * Math.PI) / 180);
const project = ([lon, lat]: Pt): Pt => [lon * K, -lat];

const all = rings.flatMap((r) => r.ring.map(project));
const minX = Math.min(...all.map((p) => p[0]));
const maxX = Math.max(...all.map((p) => p[0]));
const minY = Math.min(...all.map((p) => p[1]));
const maxY = Math.max(...all.map((p) => p[1]));

/** Largest scale (and the vertical centre that allows it) keeping every point on screen. */
function fit(): { scale: number; cy: number } {
  const c = SCREEN / 2;
  const fits = (scale: number, cy: number) =>
    all.every(([x, y]) => {
      const sx = c + (x - (minX + maxX) / 2) * scale;
      const sy = cy + (y - (minY + maxY) / 2) * scale;
      return Math.hypot(sx - c, sy - c) <= MAX_RADIUS && sy <= MAX_Y;
    });
  let best = { scale: 0, cy: c };
  for (let cy = c - 30; cy <= c; cy += 1) {
    let lo = 0;
    let hi = 40;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid, cy)) lo = mid;
      else hi = mid;
    }
    if (lo > best.scale) best = { scale: lo, cy };
  }
  return best;
}
const { scale, cy } = fit();
const toScreen = (p: Pt): Pt => {
  const [x, y] = project(p);
  return [SCREEN / 2 + (x - (minX + maxX) / 2) * scale, cy + (y - (minY + maxY) / 2) * scale];
};

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function douglasPeucker(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  let maxD = 0;
  let idx = 0;
  const first = pts[0] as Pt;
  const last = pts[pts.length - 1] as Pt;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i] as Pt, first, last);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= tol) return [first, last];
  return [...douglasPeucker(pts.slice(0, idx + 1), tol).slice(0, -1), ...douglasPeucker(pts.slice(idx), tol)];
}

/** Closed ring → simplified, rounded, deduplicated ring (no closing point). */
function simplifyRing(ring: Pt[], tol: number): Pt[] {
  const open = ring.slice(0, -1);
  // Split at the point farthest from the first, so both halves are open polylines.
  let far = 0;
  for (let i = 1; i < open.length; i++) {
    if (Math.hypot(...sub(open[i] as Pt, open[0] as Pt)) > Math.hypot(...sub(open[far] as Pt, open[0] as Pt))) far = i;
  }
  const a = douglasPeucker(open.slice(0, far + 1), tol);
  const b = douglasPeucker([...open.slice(far), open[0] as Pt], tol);
  const out: Pt[] = [];
  for (const p of [...a.slice(0, -1), ...b.slice(0, -1)]) {
    const r: Pt = [Math.round(p[0]), Math.round(p[1])];
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== r[0] || prev[1] !== r[1]) out.push(r);
  }
  while (out.length > 1 && out[0]?.[0] === out[out.length - 1]?.[0] && out[0]?.[1] === out[out.length - 1]?.[1])
    out.pop();
  return out;
}

function sub(a: Pt, b: Pt): Pt {
  return [a[0] - b[0], a[1] - b[1]];
}

function area(ring: Pt[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i] as Pt;
    const q = ring[(i + 1) % ring.length] as Pt;
    s += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(s) / 2;
}

const idxOf = new Map<number, number>(REGIONS.map((r) => [r.id, r.idx]));
const polygons: number[][] = [];
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
  const packed: number[] = [];
  for (let i = 0; i < pts.length; i += 2) {
    const [x1, y1] = pts[i] as Pt;
    const [x2, y2] = pts[i + 1] ?? (pts[i] as Pt);
    packed.push((x1 << 24) | (y1 << 16) | (x2 << 8) | y2 | 0);
  }
  polygons.push([idxOf.get(id) as number, pts.length, ...packed]);
  totalPoints += pts.length;
}

const dots = Object.entries(DOTS).map(([id, ll]) => {
  const [x, y] = toScreen(ll);
  return [idxOf.get(Number(id)) as number, Math.round(x), Math.round(y)];
});

const covered = new Set([...polygons.map((p) => p[0]), ...dots.map((d) => d[0])]);
const uncovered = REGIONS.filter((r) => !covered.has(r.idx));
if (uncovered.length) throw new Error(`regions without geometry: ${uncovered.map((r) => r.nameLatin).join(', ')}`);

const json = JSON.stringify({ w: SCREEN, p: polygons, d: dots });
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'map.json'), json);
writeFileSync(
  resolve(outDir, 'map.xml'),
  `<!-- GENERATED by packages/shared/scripts/gen-map.ts. Do not edit; run the gen-map script of packages/shared. -->
<resources>
    <jsonData id="Map" filename="map.json"/>
</resources>
`,
);
console.log(
  `map: scale ${scale.toFixed(2)} px/unit, centre y ${cy}, ${polygons.length} polygons (${dropped} islands dropped), ` +
    `${totalPoints} points, ${json.length} bytes JSON`,
);
