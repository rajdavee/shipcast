import { readFile, rm } from 'node:fs/promises';
import { run } from '@shipcast/engine';

/**
 * Claude picks screenshot crops by eye, and often stops a few pixels short of a
 * card's border, so the card reads as clipped. Before cropping, each edge is
 * nudged outward to clear space: past any border or background change just
 * beyond it, or off content it cuts through. Edges already in clear space stay.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const UNIFORM = 0.1; // a line is "plain" when under 10% of its pixels stray from its typical grey

/**
 * Typical grey (median) along one column (rows a..b) or one row (columns a..b),
 * and the share of pixels more than 8 levels off it. Robust to the odd border
 * crossing the line, which a plain std-dev is not.
 */
function line(g: Uint8Array, W: number, vertical: boolean, at: number, a: number, b: number) {
  const hist = new Uint32Array(256);
  const n = Math.max(0, b - a);
  for (let i = a; i < b; i++) hist[vertical ? g[i * W + at] : g[at * W + i]]++;
  let acc = 0;
  let mean = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc * 2 >= n) {
      mean = v;
      break;
    }
  }
  let near = 0;
  for (let v = Math.max(0, mean - 8); v <= Math.min(255, mean + 8); v++) near += hist[v];
  return { mean, std: n ? 1 - near / n : 0 };
}

/** Move one edge outward (dir ±1) onto plain page background; returns the new pixel position. */
function snapEdge(g: Uint8Array, W: number, H: number, page: number, vertical: boolean, edge: number, dir: 1 | -1, a: number, b: number): number {
  const size = vertical ? W : H;
  // The middle of the span: crops usually carry a strip of page above and below a panel.
  const trim = Math.floor((b - a) * 0.15);
  const at = (p: number) => line(g, W, vertical, p, a + trim, b - trim);
  const onPage = (l: { mean: number; std: number }) => l.std < UNIFORM && Math.abs(l.mean - page) <= 4;
  const here = at(edge);
  if (onPage(here)) return edge;
  // A border or change of tone just inside the edge means this side of the panel is already in frame.
  if (here.std < UNIFORM)
    for (let k = 1; k <= Math.round(size * 0.03); k++) {
      const p = edge - dir * k;
      if (p < 0 || p >= size) break;
      const l = at(p);
      if (l.std < UNIFORM && Math.abs(l.mean - here.mean) > 8) return edge;
    }
  // Cutting content: the nearest gap is close. Inside a plain panel: its border may be far.
  const reach = Math.round(size * (here.std < UNIFORM ? 0.4 : 0.08));
  let found = -1;
  let gap = -1;
  for (let k = 1; k <= reach; k++) {
    const p = edge + dir * k;
    if (p < 0 || p >= size) break;
    const l = at(p);
    if (onPage(l)) {
      found = p;
      break;
    }
    if (gap < 0 && here.std >= UNIFORM && l.std < UNIFORM) gap = p;
  }
  if (found < 0) found = gap;
  if (found < 0) return edge;
  // A little breathing room on the background.
  const margin = Math.max(4, Math.round(size * 0.012));
  let q = found;
  for (let k = 0; k < margin && q + dir >= 0 && q + dir < size && at(q + dir).std < UNIFORM; k++) q += dir;
  return q;
}

/** The page's background grey: the most common value. */
function pageGrey(g: Uint8Array): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < g.length; i += 3) hist[g[i]]++;
  let best = 0;
  for (let v = 1; v < 256; v++) if (hist[v] > hist[best]) best = v;
  return best;
}

/** Snap a fractional crop box to clear space in a grey image (W×H, one byte per pixel). */
export function snapCrop(g: Uint8Array, W: number, H: number, box: Box): Box {
  let x0 = Math.round(box.x * W);
  let x1 = Math.min(W - 1, Math.round((box.x + box.w) * W));
  let y0 = Math.round(box.y * H);
  let y1 = Math.min(H - 1, Math.round((box.y + box.h) * H));
  if (x1 - x0 < 8 || y1 - y0 < 8) return box;
  const page = pageGrey(g);
  const nx1 = snapEdge(g, W, H, page, true, x1, 1, y0, y1);
  const nx0 = snapEdge(g, W, H, page, true, x0, -1, y0, y1);
  x0 = nx0;
  x1 = nx1;
  const ny1 = snapEdge(g, W, H, page, false, y1, 1, x0, x1);
  const ny0 = snapEdge(g, W, H, page, false, y0, -1, x0, x1);
  if (nx0 === Math.round(box.x * W) && nx1 === Math.min(W - 1, Math.round((box.x + box.w) * W)) && ny0 === y0 && ny1 === y1) return box;
  y0 = ny0;
  y1 = ny1;
  return { x: x0 / W, y: y0 / H, w: (x1 - x0 + 1) / W, h: (y1 - y0 + 1) / H };
}

/** Decode an image to grey at most 1200px wide and snap the crop; returns the box unchanged if decoding fails. */
export async function snapCropFile(file: string, box: Box, scratch: string): Promise<Box> {
  const probe = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]);
  const [iw, ih] = probe.stdout.trim().split(',').map(Number);
  if (!iw || !ih) return box;
  const W = Math.min(1200, iw);
  const H = Math.max(1, Math.round((ih * W) / iw));
  const r = await run('ffmpeg', ['-y', '-v', 'error', '-i', file, '-vf', `scale=${W}:${H}:flags=area,format=gray`, '-f', 'rawvideo', scratch]);
  if (r.code !== 0) return box;
  const buf = await readFile(scratch).catch(() => null);
  await rm(scratch, { force: true });
  if (!buf || buf.length < W * H) return box;
  return snapCrop(new Uint8Array(buf.buffer, buf.byteOffset, W * H), W, H, box);
}
