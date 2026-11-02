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
function snapEdge(g: Uint8Array, W: number, H: number, page: number, vertical: boolean, edge: number, dir: 1 | -1, a: number, b: number, panelReach: number): number {
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
  const reach = Math.round(here.std < UNIFORM ? panelReach : size * 0.08);
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
  const ox0 = Math.round(box.x * W);
  const ox1 = Math.min(W - 1, Math.round((box.x + box.w) * W));
  const oy0 = Math.round(box.y * H);
  const oy1 = Math.min(H - 1, Math.round((box.y + box.h) * H));
  if (ox1 - ox0 < 8 || oy1 - oy0 < 8) return box;
  const page = pageGrey(g);
  // One axis: first nudge each edge a short way (a border a few pixels off, a gap in content). Then, if
  // one side now sits in clear space, the panel is only partly in frame: let the other side reach its far
  // border, up to doubling the crop. A crop wholly inside a panel is a deliberate zoom and stays.
  const axis = (vertical: boolean, e0: number, e1: number, a: number, b: number): [number, number] => {
    const size = vertical ? W : H;
    const near = size * 0.03;
    let n0 = snapEdge(g, W, H, page, vertical, e0, -1, a, b, near);
    let n1 = snapEdge(g, W, H, page, vertical, e1, 1, a, b, near);
    const clear = (p: number) => isClear(g, W, page, vertical, p, a, b);
    const room = Math.min(size * 0.4, e1 - e0);
    if (clear(n0) && !clear(n1)) n1 = snapEdge(g, W, H, page, vertical, n1, 1, a, b, room);
    else if (clear(n1) && !clear(n0)) n0 = snapEdge(g, W, H, page, vertical, n0, -1, a, b, room);
    return [n0, n1];
  };
  const [x0, x1] = axis(true, ox0, ox1, oy0, oy1);
  const [y0, y1] = axis(false, oy0, oy1, x0, x1);
  if (x0 === ox0 && x1 === ox1 && y0 === oy0 && y1 === oy1) return box;
  return { x: x0 / W, y: y0 / H, w: (x1 - x0 + 1) / W, h: (y1 - y0 + 1) / H };
}

/** Is this line plain page background (or the edge of the image)? */
function isClear(g: Uint8Array, W: number, page: number, vertical: boolean, p: number, a: number, b: number): boolean {
  const size = vertical ? W : g.length / W;
  if (p <= 0 || p >= size - 1) return true;
  const trim = Math.floor((b - a) * 0.15);
  const l = line(g, W, vertical, p, a + trim, b - trim);
  return l.std < UNIFORM && Math.abs(l.mean - page) <= 4;
}

/** Decode an image to grey at most 1200px wide and snap the crop; returns the box unchanged if decoding fails. */
export async function snapCropFile(file: string, box: Box, scratch: string): Promise<Box & { srcW?: number }> {
  const probe = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]);
  const [iw, ih] = probe.stdout.trim().split(',').map(Number);
  if (!iw || !ih) return box;
  const W = Math.min(1200, iw);
  const H = Math.max(1, Math.round((ih * W) / iw));
  const r = await run('ffmpeg', ['-y', '-v', 'error', '-i', file, '-vf', `scale=${W}:${H}:flags=area,format=gray`, '-f', 'rawvideo', scratch]);
  if (r.code !== 0) return { ...box, srcW: iw };
  const buf = await readFile(scratch).catch(() => null);
  await rm(scratch, { force: true });
  if (!buf || buf.length < W * H) return { ...box, srcW: iw };
  return { ...snapCrop(new Uint8Array(buf.buffer, buf.byteOffset, W * H), W, H, box), srcW: iw };
}
