/**
 * Map rasterizing shared by gen-map (country map) and gen-zoom (one map per oblast).
 *
 * Shapes are projected (equirectangular around Ukraine's middle latitude), fitted to the round
 * 208-px screen, simplified on the pixel grid and rasterized here: fill by scanline at pixel
 * centres, outline by Bresenham. Each shape becomes glyphs of a bitmap font (BMFont text format,
 * white on transparent), which the watch tints with setColor: one drawText per shape and no
 * per-point work on the device.
 */
import { deflateSync } from 'node:zlib';

/** Screen size (FR55: 208×208, round). */
export const SCREEN = 208;
/** Points must stay inside this circle, and above the footer line. */
export const MAX_RADIUS = SCREEN / 2 - 4;
export const MAX_Y = 168;

export type Pt = [number, number];
/** Pixels as y * SCREEN + x. */
export type PixelSet = Set<number>;

// Equirectangular projection around Ukraine's middle latitude; y grows downwards.
const K = Math.cos((48.5 * Math.PI) / 180);
export const project = ([lon, lat]: Pt): Pt => [lon * K, -lat];

/**
 * Largest scale (and the vertical centre that allows it) keeping every projected point inside the
 * screen circle and above the footer; returns a lon/lat → screen function.
 */
export function fitToScreen(
  lonLat: readonly Pt[],
  maxScale = 40,
): { scale: number; cy: number; toScreen: (p: Pt) => Pt } {
  const all = lonLat.map(project);
  const minX = Math.min(...all.map((p) => p[0]));
  const maxX = Math.max(...all.map((p) => p[0]));
  const minY = Math.min(...all.map((p) => p[1]));
  const maxY = Math.max(...all.map((p) => p[1]));
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
    let hi = maxScale;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid, cy)) lo = mid;
      else hi = mid;
    }
    if (lo > best.scale) best = { scale: lo, cy };
  }
  const { scale, cy } = best;
  const toScreen = (p: Pt): Pt => {
    const [x, y] = project(p);
    return [c + (x - (minX + maxX) / 2) * scale, cy + (y - (minY + maxY) / 2) * scale];
  };
  return { scale, cy, toScreen };
}

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

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];

/** Closed ring → simplified, rounded, deduplicated ring (no closing point). */
export function simplifyRing(ring: Pt[], tol: number): Pt[] {
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

export function area(ring: Pt[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i] as Pt;
    const q = ring[(i + 1) % ring.length] as Pt;
    s += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(s) / 2;
}

const key = (x: number, y: number) => y * SCREEN + x;

/** Bresenham outline of every ring, the pixels drawLine would set. */
export function outline(rs: Pt[][]): PixelSet {
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
export function fill(rs: Pt[][], edge: PixelSet): PixelSet {
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

/** One shape's fill and outline pixels, and the bounding box they're drawn at. */
export interface Glyph {
  /** Screen position of the glyph's top-left. */
  x: number;
  y: number;
  w: number;
  h: number;
  fill: PixelSet;
  edge: PixelSet;
}

export function glyphOf(rings: Pt[][]): Glyph {
  const edge = outline(rings);
  const f = fill(rings, edge);
  const xs = [...f].map((k) => k % SCREEN);
  const ys = [...f].map((k) => Math.floor(k / SCREEN));
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x + 1, h: Math.max(...ys) - y + 1, fill: f, edge };
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

/**
 * Packs glyphs into one atlas: glyph k becomes char 'A'+k (fill) and 'a'+k (outline).
 * Returns the PNG and the BMFont text, which names the PNG `pngName`.
 */
export function bitmapFont(
  glyphs: readonly Glyph[],
  pngName: string,
): { png: Buffer; fnt: string; w: number; h: number } {
  if (glyphs.length > 26) throw new Error(`${glyphs.length} shapes; glyphs A-Z / a-z hold 26`);
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
    `page id=0 file="${pngName}"`,
    `chars count=${placed.length}`,
    ...[...placed]
      .sort((p, q) => p.ch - q.ch)
      .map(
        (p) =>
          `char id=${p.ch} x=${p.ax} y=${p.ay} width=${p.g.w} height=${p.g.h} xoffset=0 yoffset=0 xadvance=${p.g.w} page=0 chnl=15`,
      ),
    '',
  ].join('\n');
  return { png, fnt, w: ATLAS_W, h: ATLAS_H };
}
