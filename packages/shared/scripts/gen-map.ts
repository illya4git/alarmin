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
 * fillPolygon map), then rasterized here: fill by scanline at pixel centres, outline by Bresenham.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { REGIONS } from '../src/regions.ts';

const SOURCE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_1_states_provinces.geojson';

/** Screen size (FR55: 208×208, round). */
const SCREEN = 208;
/** Points must stay inside this circle, and above the footer line. */
const MAX_RADIUS = SCREEN / 2 - 4;
const MAX_Y = 168;
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

type Pt = [number, number];

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
if (shapes.size > 26) throw new Error(`${shapes.size} shapes; glyphs A-Z / a-z hold 26`);

// ---------------------------------------------------------------- rasterize
type PixelSet = Set<number>; // y * SCREEN + x
const key = (x: number, y: number) => y * SCREEN + x;

/** Bresenham outline of every ring, the pixels drawLine would set. */
function outline(rs: Pt[][]): PixelSet {
  const px: PixelSet = new Set();
  for (const r of rs) {
    for (let i = 0; i < r.length; i++) {
      let [x0, y0] = r[i] as Pt;
      const [x1, y1] = r[(i + 1) % r.length] as Pt;
      const dx = Math.abs(x1 - x0);
      const dy = -Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        px.add(key(x0, y0));
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) {
          err += dy;
          x0 += sx;
        }
        if (e2 <= dx) {
          err += dx;
          y0 += sy;
        }
      }
    }
  }
  return px;
}

/** Scanline fill at pixel centres (even-odd), plus the outline so edges are covered. */
function fill(rs: Pt[][], edge: PixelSet): PixelSet {
  const px: PixelSet = new Set(edge);
  for (const r of rs) {
    const ys = r.map((p) => p[1]);
    for (let y = Math.min(...ys); y <= Math.max(...ys); y++) {
      const xs: number[] = [];
      for (let i = 0; i < r.length; i++) {
        const [ax, ay] = r[i] as Pt;
        const [bx, by] = r[(i + 1) % r.length] as Pt;
        if ((ay <= y && y < by) || (by <= y && y < ay)) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        for (let x = Math.ceil(xs[i] as number); x <= Math.floor(xs[i + 1] as number); x++) px.add(key(x, y));
      }
    }
  }
  return px;
}

interface Glyph {
  idx: number;
  /** Screen position of the glyph's top-left. */
  x: number;
  y: number;
  w: number;
  h: number;
  fill: PixelSet;
  edge: PixelSet;
}
const glyphs: Glyph[] = [...shapes.entries()]
  .sort((p, q) => p[0] - q[0])
  .map(([idx, rs]) => {
    const edge = outline(rs);
    const f = fill(rs, edge);
    const xs = [...f].map((k) => k % SCREEN);
    const ys = [...f].map((k) => Math.floor(k / SCREEN));
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { idx, x, y, w: Math.max(...xs) - x + 1, h: Math.max(...ys) - y + 1, fill: f, edge };
  });

// ---------------------------------------------------------------- atlas, PNG, BMFont
const ATLAS_W = 256;
const PAD = 1;
const items = glyphs.flatMap((g, k) => [
  { ch: 65 + k, g, px: g.fill },
  { ch: 97 + k, g, px: g.edge },
]);
const placed: ((typeof items)[number] & { ax: number; ay: number })[] = [];
let ax = 0;
let ay = 0;
let rowH = 0;
for (const it of [...items].sort((p, q) => q.g.h - p.g.h)) {
  if (ax + it.g.w > ATLAS_W) {
    ax = 0;
    ay += rowH + PAD;
    rowH = 0;
  }
  placed.push({ ...it, ax, ay });
  ax += it.g.w + PAD;
  rowH = Math.max(rowH, it.g.h);
}
const ATLAS_H = ay + rowH;

const rgba = Buffer.alloc(ATLAS_W * ATLAS_H * 4); // transparent black
for (const p of placed) {
  for (const k of p.px) {
    const o = ((p.ay + Math.floor(k / SCREEN) - p.g.y) * ATLAS_W + (p.ax + (k % SCREEN) - p.g.x)) * 4;
    rgba.writeUInt32BE(0xffffffff, o); // white, opaque
  }
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const v of b) c = (CRC[(c ^ v) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(ATLAS_W, 0);
ihdr.writeUInt32BE(ATLAS_H, 4);
ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
const raw = Buffer.alloc((ATLAS_W * 4 + 1) * ATLAS_H); // filter byte 0 per row
for (let y = 0; y < ATLAS_H; y++) rgba.copy(raw, y * (ATLAS_W * 4 + 1) + 1, y * ATLAS_W * 4, (y + 1) * ATLAS_W * 4);
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);

const lineH = Math.max(...glyphs.map((g) => g.h));
const fnt = [
  `info face="AlarminMap" size=${lineH} bold=0 italic=0 charset="" unicode=1 stretchH=100 smooth=0 aa=1 padding=0,0,0,0 spacing=${PAD},${PAD} outline=0`,
  `common lineHeight=${lineH} base=${lineH} scaleW=${ATLAS_W} scaleH=${ATLAS_H} pages=1 packed=0 alphaChnl=0 redChnl=0 greenChnl=0 blueChnl=0`,
  'page id=0 file="map.png"',
  `chars count=${placed.length}`,
  ...[...placed]
    .sort((p, q) => p.ch - q.ch)
    .map(
      (p) =>
        `char id=${p.ch} x=${p.ax} y=${p.ay} width=${p.g.w} height=${p.g.h} xoffset=0 yoffset=0 xadvance=${p.g.w} page=0 chnl=15`,
    ),
  '',
].join('\n');

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
writeFileSync(resolve(outDir, 'map.png'), png);
writeFileSync(resolve(outDir, 'map.fnt'), fnt);
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
    `${totalPoints} points, atlas ${ATLAS_W}x${ATLAS_H} (${png.length} bytes PNG)`,
);
