import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { channel, type ChannelId } from './calendar.ts';
import { browser } from './chrome.ts';
import { withDirLock } from './filelock.ts';
import { home, rootHome } from './paths.ts';
import { writePptx, type PptxItem, type PptxSlide } from './pptx.ts';
import { kpiChange, kpiValue, reportCardHtml, reportHtml } from './report-html.ts';
import { num, times, type Report } from './report.ts';
import { readableAsset } from './service.ts';

/**
 * Where a report goes outside the app: share links, PDF, PowerPoint, CSV,
 * and the week card image.
 *
 * Share links are install-wide (the link carries no workspace): a 32-byte
 * random token, of which only the SHA-256 is stored, mapped to one report in
 * one workspace. A link opens that report and its top-post images — nothing
 * else — until it expires or is revoked.
 */

// ── share links ────────────────────────────────────────────────────────

export interface Share {
  id: string;
  hash: string;
  workspace: string;
  report: string;
  createdAt: string;
  expiresAt?: string;
  by?: string;
  views: number;
  lastViewedAt?: string;
}

const sharesFile = () => join(rootHome(), 'shares', 'shares.json');
const sha = (t: string) => createHash('sha256').update(t).digest('hex');

let chain: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = async () => {
    await mkdir(join(rootHome(), 'shares'), { recursive: true, mode: 0o700 });
    return withDirLock(join(rootHome(), 'shares'), fn);
  };
  const next = chain.then(run, run);
  chain = next.catch(() => {});
  return next;
};
async function readShares(): Promise<Share[]> {
  try {
    return JSON.parse(await readFile(sharesFile(), 'utf8'));
  } catch {
    return [];
  }
}
async function writeShares(all: Share[]) {
  const tmp = `${sharesFile()}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(all), { mode: 0o600 });
  await rename(tmp, sharesFile());
  await chmod(sharesFile(), 0o600).catch(() => {});
}

export const publicShare = ({ id, createdAt, expiresAt, views, lastViewedAt }: Share) => ({ id, createdAt, views, ...(expiresAt ? { expiresAt } : {}), ...(lastViewedAt ? { lastViewedAt } : {}) });

export function createShare(workspace: string, report: string, o: { expiresDays?: number; by?: string; now?: Date } = {}): Promise<{ share: ReturnType<typeof publicShare>; token: string }> {
  const now = o.now ?? new Date();
  const token = randomBytes(32).toString('base64url');
  const days = Number(o.expiresDays);
  const share: Share = { id: `sh${randomBytes(5).toString('hex')}`, hash: sha(token), workspace, report, createdAt: now.toISOString(), ...(Number.isFinite(days) && days > 0 ? { expiresAt: new Date(now.getTime() + Math.min(days, 365) * 86_400_000).toISOString() } : {}), ...(o.by ? { by: o.by } : {}), views: 0 };
  return serial(async () => {
    const all = (await readShares()).filter((s) => !s.expiresAt || Date.parse(s.expiresAt) > now.getTime());
    if (all.filter((s) => s.workspace === workspace && s.report === report).length >= 20) throw Object.assign(new Error('This report already has 20 links — revoke some first.'), { status: 409 });
    await writeShares([...all, share]);
    return { share: publicShare(share), token };
  });
}

export async function listShares(workspace: string, report: string): Promise<ReturnType<typeof publicShare>[]> {
  await flushViews();
  const now = Date.now();
  return (await readShares()).filter((s) => s.workspace === workspace && s.report === report && (!s.expiresAt || Date.parse(s.expiresAt) > now)).map(publicShare);
}

export function revokeShare(workspace: string, id: string): Promise<boolean> {
  return serial(async () => {
    const all = await readShares();
    const rest = all.filter((s) => !(s.id === id && s.workspace === workspace));
    await writeShares(rest);
    return rest.length !== all.length;
  });
}

/** Links to a report made by one source (e.g. the delivery's own link, replaced on each send). */
export function revokeSharesBy(workspace: string, report: string, by: string): Promise<number> {
  return serial(async () => {
    const all = await readShares();
    const rest = all.filter((s) => !(s.workspace === workspace && s.report === report && s.by === by));
    await writeShares(rest);
    return all.length - rest.length;
  });
}

/** Every link to a report (when the report or its workspace goes). */
export function revokeSharesFor(workspace: string, report?: string): Promise<number> {
  return serial(async () => {
    const all = await readShares();
    const rest = all.filter((s) => !(s.workspace === workspace && (!report || s.report === report)));
    await writeShares(rest);
    return all.length - rest.length;
  });
}

/** The share a token opens, if it is valid now (constant-time compare on the hash). */
export async function resolveShare(token: string, now = new Date()): Promise<Share | null> {
  if (!/^[\w-]{40,50}$/.test(token)) return null;
  const h = Buffer.from(sha(token), 'hex');
  const hit = (await readShares()).find((s) => {
    const b = Buffer.from(s.hash, 'hex');
    return b.length === h.length && timingSafeEqual(b, h);
  });
  if (!hit || (hit.expiresAt && Date.parse(hit.expiresAt) <= now.getTime())) return null;
  return hit;
}

// Views are counted in memory and written at most every few seconds, not on every page load.
const pendingViews = new Map<string, { n: number; at: string }>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;
export function flushViews(): Promise<void> {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = undefined;
  if (!pendingViews.size) return Promise.resolve();
  const batch = new Map(pendingViews);
  pendingViews.clear();
  return serial(async () => {
    const all = await readShares();
    for (const s of all) {
      const v = batch.get(s.id);
      if (v) (s.views += v.n), (s.lastViewedAt = v.at);
    }
    await writeShares(all);
  });
}
export function countView(id: string, now = new Date()): void {
  const cur = pendingViews.get(id);
  pendingViews.set(id, { n: (cur?.n ?? 0) + 1, at: now.toISOString() });
  flushTimer ??= setTimeout(() => void flushViews().catch(() => {}), 5_000);
  flushTimer.unref?.();
}

/** The image of top post `i` in the current workspace, when it is a readable image (for share pages). */
export function topPostImage(r: Report, i: number): string | undefined {
  const p = r.facts.top[i]?.media;
  if (!p || !/\.(png|jpe?g|webp|gif)$/i.test(p)) return undefined;
  const abs = isAbsolute(p) ? p : join(home(), p);
  return readableAsset(abs) ? abs : undefined;
}

// ── rendering through Chrome ───────────────────────────────────────────

let renderChain: Promise<unknown> = Promise.resolve();
let rendersWaiting = 0;
/** One render at a time (the shared browser reuses a single tab), and only a few waiting. */
function render<T>(html: string, size: { width: number; height: number }, fn: (page: Awaited<ReturnType<ReturnType<typeof browser>['open']>>) => Promise<T>): Promise<T> {
  const go = async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shipcast-report-'));
    const file = join(dir, 'report.html');
    await writeFile(file, html);
    const page = await browser().open(pathToFileURL(file).href, { width: size.width, height: size.height });
    try {
      return await fn(page);
    } finally {
      await page.close();
      await rm(dir, { recursive: true, force: true });
    }
  };
  if (rendersWaiting >= 4) return Promise.reject(Object.assign(new Error('Busy making other files — try again in a moment.'), { status: 503 }));
  rendersWaiting++;
  const next = renderChain.then(go, go).finally(() => rendersWaiting--);
  renderChain = next.catch(() => {});
  return next;
}

const fileUrl = (p: string | undefined) => (p ? pathToFileURL(p).href : undefined);

export function reportPdf(r: Report, from?: string): Promise<Buffer> {
  // A4 at 96 dpi; the page's own @page rule sets the paper and margins.
  return render(reportHtml(r, { from, media: (_p, i) => fileUrl(topPostImage(r, i)) }), { width: 794, height: 1123 }, (p) => p.pdf());
}

export function reportCardPng(r: Report): Promise<Buffer> {
  return render(reportCardHtml(r, fileUrl(topPostImage(r, 0))), { width: 1080, height: 1350 }, (p) => p.screenshot('png'));
}

// ── PowerPoint ─────────────────────────────────────────────────────────

const INK = '111827', MUTED = '5B6474', ACCENT = '2F6BFF', UP = '0F8A4C', DOWN = 'C62828', PANEL = 'F6F7FA';

export async function reportPptx(r: Report, outFile: string): Promise<void> {
  const W = 13.333;
  const title = (t: string, sub?: string): PptxItem[] => [
    { type: 'text', text: t, x: 0.7, y: 0.5, w: W - 1.4, h: 0.9, size: 30, bold: true, color: INK },
    ...(sub ? [{ type: 'text' as const, text: sub, x: 0.7, y: 1.3, w: W - 1.4, h: 0.5, size: 14, color: MUTED }] : []),
  ];
  const slides: PptxSlide[] = [];
  // 1. Headline and numbers.
  const kpis = r.facts.kpis.slice(0, 4);
  const tileW = (W - 1.4 - 0.3 * (kpis.length - 1)) / Math.max(1, kpis.length);
  slides.push({
    items: [
      { type: 'text', text: r.title.toUpperCase(), x: 0.7, y: 0.5, w: W - 1.4, h: 0.4, size: 12, bold: true, color: MUTED },
      { type: 'text', text: r.headline, x: 0.7, y: 0.95, w: W - 1.4, h: 1.6, size: 34, bold: true, color: INK },
      { type: 'text', text: `${r.facts.period.label} · compared with ${r.facts.prevPeriod.label}`, x: 0.7, y: 2.6, w: W - 1.4, h: 0.4, size: 14, color: MUTED },
      ...kpis.flatMap((k, i): PptxItem[] => {
        const x = 0.7 + i * (tileW + 0.3);
        const ch = kpiChange(k);
        return [
          { type: 'shape', kind: 'roundRect', x, y: 3.5, w: tileW, h: 2.2, fill: PANEL },
          { type: 'text', text: k.label, x: x + 0.25, y: 3.65, w: tileW - 0.5, h: 0.4, size: 13, color: MUTED },
          { type: 'text', text: kpiValue(k), x: x + 0.25, y: 4.1, w: tileW - 0.5, h: 0.8, size: 34, bold: true, color: INK },
          { type: 'text', text: ch ? `${ch.text}${k.prev !== undefined ? `  (was ${kpiValue({ value: k.prev, unit: k.unit })})` : ''}` : '', x: x + 0.25, y: 4.95, w: tileW - 0.5, h: 0.5, size: 14, bold: true, color: ch?.dir === 'up' ? UP : ch?.dir === 'down' ? DOWN : MUTED },
        ];
      }),
    ],
    notes: r.sections.find((s) => s.id === 'summary')?.lines.join('\n'),
  });
  // 2. Best posts and change by channel.
  if (r.facts.top.length || r.facts.waterfall.length) {
    const items: PptxItem[] = [...title('What worked', r.sections.find((s) => s.id === 'why')?.lines[0])];
    r.facts.top.slice(0, 3).forEach((p, i) => {
      const y = 2.2 + i * 1.5;
      const img = topPostImage(r, i);
      if (img && /\.(png|jpe?g)$/i.test(img)) items.push({ type: 'image', path: img, x: 0.7, y, w: 1.2, h: 1.2 });
      else items.push({ type: 'shape', kind: 'roundRect', x: 0.7, y, w: 1.2, h: 1.2, fill: PANEL });
      items.push({ type: 'text', text: p.title.replace(/^Sample · /, ''), x: 2.1, y, w: 5.2, h: 0.6, size: 16, bold: true, color: INK });
      items.push({ type: 'text', text: [channel(p.channel)?.name ?? p.channel, p.lift !== undefined ? `${times(p.lift)} your usual` : '', p.audience !== undefined ? `${num(p.audience)} reached` : ''].filter(Boolean).join(' · '), x: 2.1, y: y + 0.6, w: 5.2, h: 0.5, size: 13, color: MUTED });
    });
    const w = r.facts.waterfall.slice(0, 6);
    const max = Math.max(1, ...w.map((x) => Math.abs(x.delta)));
    if (w.length && r.facts.prev.posts) {
      items.push({ type: 'text', text: 'Change in reach by channel', x: 7.8, y: 2.0, w: 4.8, h: 0.4, size: 13, bold: true, color: MUTED });
      w.forEach((x, i) => {
        const y = 2.6 + i * 0.6;
        const len = Math.max(0.05, (Math.abs(x.delta) / max) * 2.2);
        items.push({ type: 'text', text: x.name, x: 7.8, y, w: 1.4, h: 0.4, size: 12, color: INK });
        items.push({ type: 'shape', kind: 'roundRect', x: x.delta >= 0 ? 10.3 : 10.3 - len, y: y + 0.08, w: len, h: 0.26, fill: x.delta >= 0 ? UP : DOWN });
        items.push({ type: 'text', text: `${x.delta >= 0 ? '+' : '−'}${num(Math.abs(x.delta))}`, x: 12.0, y, w: 1.1, h: 0.4, size: 12, bold: true, color: x.delta >= 0 ? UP : DOWN, align: 'right' });
      });
    }
    slides.push({ items });
  }
  // 3+. Sections as text slides.
  for (const s of r.sections.filter((x) => !x.hidden && x.lines.length && !['summary', 'coverage', 'next'].includes(x.id))) slides.push({ items: [...title(s.title), { type: 'text', text: s.lines.join('\n'), x: 0.7, y: 1.9, w: W - 1.4, h: 5, size: 18, color: INK, bullets: true, lineSpacing: 1.2 }] });
  // Last: next steps.
  if (r.recommendations.length) slides.push({ items: [...title('Next steps'), ...r.recommendations.flatMap((x, i): PptxItem[] => [{ type: 'shape', kind: 'roundRect', x: 0.7, y: 1.9 + i * 1.6, w: W - 1.4, h: 1.4, fill: PANEL }, { type: 'text', text: `${i + 1}. ${x.text}`, x: 1.0, y: 2.0 + i * 1.6, w: W - 2, h: 0.6, size: 18, bold: true, color: INK }, { type: 'text', text: x.why, x: 1.0, y: 2.6 + i * 1.6, w: W - 2, h: 0.6, size: 14, color: MUTED }])] });
  await writePptx({ title: r.title, author: 'Shipcast', slides, fonts: { heading: 'Helvetica Neue', body: 'Helvetica Neue' } }, outFile);
}

// ── CSV ────────────────────────────────────────────────────────────────

const cell = (v: unknown) => {
  const s = String(v ?? '');
  // A leading = + - @ would be a formula in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** The report's numbers as rows: KPIs, channels, and every post in the period. */
export function reportCsv(r: Report): string {
  const rows: unknown[][] = [['section', 'name', 'channel', 'value', 'previous', 'change', 'reached', 'engagement', 'times_usual', 'site_visits', 'key_events', 'date', 'url']];
  for (const k of r.facts.kpis) rows.push(['kpi', k.label, '', k.value, k.prev ?? '', k.change ?? '', '', '', '', '', '', '', '']);
  for (const c of r.facts.channels) rows.push(['channel', c.name, c.channel, c.posts, c.prev.posts, '', c.audience, c.engagement, '', '', '', '', '']);
  for (const p of r.facts.work.posts) rows.push(['post', p.title, p.channel, '', '', '', p.audience ?? '', p.engagement ?? '', p.lift ?? '', p.visits ?? '', p.keyEvents ?? '', p.at, p.url ?? '']);
  for (const g of r.facts.goals) rows.push(['goal', g.label, g.channel ?? '', g.actual, g.target, '', '', '', '', '', '', g.window.label, '']);
  return rows.map((r) => r.map(cell).join(',')).join('\n') + '\n';
}

export const channelLabel = (ch: ChannelId) => channel(ch)?.name ?? ch;
