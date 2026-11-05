import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findChrome } from './doctor.ts';
import type { SafeZone } from './presets.ts';

/**
 * Minimal Chrome DevTools Protocol client on Node's built-in WebSocket.
 * One warm browser serves many captures; each capture gets a fresh target
 * sized exactly to the canvas, waits for fonts and images, then screenshots
 * or prints. No puppeteer/playwright dependency.
 */

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

class Session {
  private ws: WebSocket;
  private id = 0;
  private pending = new Map<number, Pending>();
  private ready: Promise<void>;
  private listeners = new Set<(method: string, params: any, sessionId?: string) => void>();
  closed = false;
  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ready = new Promise((res, rej) => {
      this.ws.onopen = () => res();
      this.ws.onerror = () => rej(new Error('DevTools connection failed'));
    });
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.method) for (const f of this.listeners) f(msg.method, msg.params, msg.sessionId);
      const p = msg.id && this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (process.env.SHIPCAST_DEBUG) process.stderr.write(`[cdp] ← ${msg.id}${msg.error ? ' ERR ' + msg.error.message : ''}\n`);
      if (msg.error) p.reject(new Error(`${msg.error.message}`));
      else p.resolve(msg.result);
    };
    this.ws.onclose = () => {
      this.closed = true;
      for (const p of this.pending.values()) p.reject(new Error('DevTools connection closed'));
      this.pending.clear();
    };
  }
  async send<T = any>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    await this.ready;
    const id = ++this.id;
    const t0 = Date.now();
    if (process.env.SHIPCAST_DEBUG) process.stderr.write(`[cdp] → ${id} ${method}\n`);
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => {
      // Cleared on reply: a pending timer would keep the process alive for up to 90 s after the last capture.
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`));
      }, method === 'Page.printToPDF' || method === 'Page.captureScreenshot' ? 90_000 : 30_000);
      const done = <F extends (x: any) => void>(f: F) => ((x: any) => (clearTimeout(timer), f(x))) as F;
      this.pending.set(id, { resolve: done(resolve), reject: done(reject) });
    });
  }
  /** Listen to protocol events; returns the unsubscribe. */
  onEvent(fn: (method: string, params: any, sessionId?: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  close() {
    this.ws.close();
  }
}

/** Spawn Chrome with remote debugging on and wait for its DevTools endpoint. */
async function spawnChrome(bin: string, args: string[]): Promise<{ proc: ChildProcess; wsUrl: string }> {
  const proc = spawn(bin, ['--remote-debugging-port=0', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise<string>((resolve, reject) => {
    let buf = '';
    // Busy CI machines can take well over 20 s to bring Chrome up.
    const t = setTimeout(() => reject(new Error('Chrome did not start')), 45_000);
    proc.stderr!.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) {
        clearTimeout(t);
        resolve(m[1]);
      }
    });
    proc.on('error', (e) => reject(new Error(`Chrome failed to start: ${e.message}`)));
    proc.on('exit', () => reject(new Error(`Chrome exited: ${buf.slice(-300)}`)));
  }).catch((e) => {
    proc.kill('SIGKILL');
    throw e;
  });
  if (process.env.SHIPCAST_DEBUG) {
    proc.stderr!.on('data', (d) => process.stderr.write(`[chrome] ${d}`));
    proc.on('exit', (code, sig) => process.stderr.write(`[chrome] exited code=${code} signal=${sig}\n`));
  }
  return { proc, wsUrl };
}

export interface ChromeOptions {
  /** Persistent profile (signed-in sessions); a throwaway one when omitted. */
  profileDir?: string;
  /** A visible window instead of headless. */
  headful?: boolean;
  bin?: string;
  windowSize?: { width: number; height: number };
  /** What the first tab opens. */
  startUrl?: string;
}

/** A dedicated Chrome process with raw protocol access (screencasts, sign-in windows). */
export interface Chrome {
  send<T = any>(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<T>;
  onEvent(fn: (method: string, params: any, sessionId?: string) => void): () => void;
  /** Settles when the browser process exits. */
  exited: Promise<void>;
  close(): Promise<void>;
}

export async function launchChrome(opts: ChromeOptions = {}): Promise<Chrome> {
  const bin = opts.bin ?? process.env.CHROME_PATH ?? findChrome();
  if (!bin) throw new Error('No Chrome found. Run `npx hyperframes browser ensure` or install Google Chrome.');
  const temp = opts.profileDir ? undefined : await mkdtemp(join(tmpdir(), 'shipcast-chrome-'));
  const args = [`--user-data-dir=${opts.profileDir ?? temp}`, '--no-first-run', '--no-default-browser-check', '--force-color-profile=srgb', '--disable-dev-shm-usage', '--password-store=basic'];
  // A fixed key, so cookies saved in a visible window decrypt in a headless run (and macOS never asks for the keychain).
  if (process.platform === 'darwin') args.push('--use-mock-keychain');
  if (!opts.headful) args.push('--headless', '--hide-scrollbars', '--disable-gpu', '--no-sandbox', '--font-render-hinting=none');
  if (opts.windowSize) args.push(`--window-size=${opts.windowSize.width},${opts.windowSize.height}`);
  args.push(opts.startUrl ?? 'about:blank');
  const { proc, wsUrl } = await spawnChrome(bin, args).catch(async (e) => {
    if (temp) await rm(temp, { recursive: true, force: true }).catch(() => {});
    throw e;
  });
  const exited = new Promise<void>((r) => (proc.exitCode !== null ? r() : proc.once('exit', () => r())));
  const session = new Session(wsUrl);
  let closing: Promise<void> | undefined;
  return {
    send: (m, p = {}, sid) => session.send(m, p, sid),
    onEvent: (fn) => session.onEvent(fn),
    exited,
    close: () =>
      (closing ??= (async () => {
        // A graceful close flushes the profile's cookies to disk.
        await Promise.race([session.send('Browser.close').catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
        const gone = await Promise.race([exited.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 5000))]);
        if (!gone) proc.kill('SIGKILL');
        session.close();
        if (temp) await rm(temp, { recursive: true, force: true }).catch(() => {});
      })()),
  };
}

export interface CaptureOptions {
  width: number;
  height: number;
  /** Device pixel ratio (2 for crisp phone captures). */
  scale?: number;
  /** Emulate a touch phone (mobile layout, touch events, mobile UA). */
  mobile?: boolean;
  /** Extra settle time after fonts/images are ready (ms). */
  settleMs?: number;
}

export interface PageHandle {
  eval<T = any>(expression: string): Promise<T>;
  screenshot(format?: 'png' | 'jpeg', quality?: number): Promise<Buffer>;
  /** Whole page, up to maxHeight CSS px. */
  fullPage(maxHeight?: number): Promise<Buffer>;
  pdf(): Promise<Buffer>;
  close(): Promise<void>;
}

export class Browser {
  private proc?: ChildProcess;
  private session?: Session;
  private profile?: string;
  private starting?: Promise<void>;
  private pages = 0;
  /** Pages per browser before a preventive restart (long runs accumulate renderer state). */
  recycleAfter = 12;

  private async start() {
    const bin = process.env.CHROME_PATH ?? findChrome();
    if (!bin) throw new Error('No Chrome found. Run `npx hyperframes browser ensure` or install Google Chrome.');
    this.profile = await mkdtemp(join(tmpdir(), 'shipcast-chrome-'));
    const { proc, wsUrl } = await spawnChrome(bin, ['--headless', `--user-data-dir=${this.profile}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-color-profile=srgb', '--font-render-hinting=none', '--disable-gpu', '--disable-dev-shm-usage', '--no-sandbox', 'about:blank']);
    this.proc = proc;
    this.session = new Session(wsUrl);
    proc.on('exit', () => {
      this.session = undefined;
      this.proc = undefined;
      this.starting = undefined;
    });
  }

  private async ensure(): Promise<Session> {
    if (this.session?.closed) await this.restart();
    if (!this.session) {
      this.starting ??= this.start();
      await this.starting;
    }
    return this.session!;
  }

  /** Kill a wedged browser so the next call starts a fresh one. */
  async restart() {
    this.tab = undefined;
    this.session?.close();
    this.proc?.kill('SIGKILL');
    this.session = undefined;
    this.proc = undefined;
    this.starting = undefined;
    if (this.profile) await rm(this.profile, { recursive: true, force: true }).catch(() => {});
  }

  /** Open a page at an exact viewport; on a dead or hung browser, relaunch once and retry. */
  async open(url: string, opts: CaptureOptions): Promise<PageHandle> {
    try {
      return await this.openOnce(url, opts);
    } catch (e) {
      if (!/DevTools|timed out|Target|closed|exited/i.test(String((e as Error).message))) throw e;
      await this.restart();
      return this.openOnce(url, opts);
    }
  }

  /** One persistent tab, reused for every capture (target churn is what wedges headless Chrome). */
  private tab?: { targetId: string; sessionId: string };
  private lock: Promise<unknown> = Promise.resolve();

  private async openOnce(url: string, opts: CaptureOptions): Promise<PageHandle> {
    if (++this.pages > this.recycleAfter * 4) {
      this.pages = 1;
      await this.restart();
    }
    const s = await this.ensure();
    if (!this.tab) {
      const { targetId } = await s.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await s.send('Target.attachToTarget', { targetId, flatten: true });
      this.tab = { targetId, sessionId };
      await s.send('Page.enable', {}, sessionId);
    }
    const { sessionId } = this.tab;
    const send = (m: string, p: Record<string, unknown> = {}) => s.send(m, p, sessionId);
    await send('Emulation.setDeviceMetricsOverride', { width: opts.width, height: opts.height, deviceScaleFactor: opts.scale ?? 1, mobile: !!opts.mobile });
    await send('Emulation.setTouchEmulationEnabled', { enabled: !!opts.mobile }).catch(() => {});
    await send('Emulation.setUserAgentOverride', { userAgent: opts.mobile ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' }).catch(() => {});
    await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    await send('Page.navigate', { url });
    const evalIn = async <T>(expression: string): Promise<T> => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value as T;
    };
    // Wait for the new document, fonts and every <img>, then let one more frame paint.
    await evalIn(`new Promise(r => { const href = ${JSON.stringify(url)}; const go = () => r(true); const ok = () => location.href === href && document.readyState === 'complete'; if (ok()) go(); else { const t = setInterval(() => { if (ok()) { clearInterval(t); go(); } }, 25); setTimeout(() => { clearInterval(t); go(); }, 15000); } })`);
    await evalIn(`Promise.race([Promise.all([document.fonts.ready, ...[...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))]), new Promise(r => setTimeout(r, 10000))]).then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))`);
    if (opts.settleMs) await new Promise((r) => setTimeout(r, opts.settleMs));
    return {
      eval: evalIn,
      screenshot: async (format = 'png', quality = 92) => {
        const r = await send('Page.captureScreenshot', { format, ...(format === 'jpeg' ? { quality } : {}), clip: { x: 0, y: 0, width: opts.width, height: opts.height, scale: 1 }, captureBeyondViewport: false });
        return Buffer.from(r.data, 'base64');
      },
      fullPage: async (maxHeight = 9000) => {
        const m = await send('Page.getLayoutMetrics');
        const h = Math.min(Math.ceil((m.cssContentSize ?? m.contentSize).height), maxHeight);
        await send('Emulation.setDeviceMetricsOverride', { width: opts.width, height: h, deviceScaleFactor: opts.scale ?? 1, mobile: !!opts.mobile });
        await new Promise((r) => setTimeout(r, 400));
        const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: opts.width, height: h, scale: 1 }, captureBeyondViewport: true });
        await send('Emulation.setDeviceMetricsOverride', { width: opts.width, height: opts.height, deviceScaleFactor: opts.scale ?? 1, mobile: !!opts.mobile });
        return Buffer.from(r.data, 'base64');
      },
      pdf: async () => {
        // Stream the PDF back in chunks: a multi-page deck can exceed a single WebSocket message.
        const r = await send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true, paperWidth: opts.width / 96, paperHeight: opts.height / 96, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, transferMode: 'ReturnAsStream' });
        if (r.data) return Buffer.from(r.data, 'base64');
        const parts: Buffer[] = [];
        for (;;) {
          const c = await send('IO.read', { handle: r.stream, size: 4 * 1024 * 1024 });
          parts.push(Buffer.from(c.data, c.base64Encoded ? 'base64' : 'utf8'));
          if (c.eof) break;
        }
        await send('IO.close', { handle: r.stream }).catch(() => {});
        return Buffer.concat(parts);
      },
      // The tab is reused; "closing" just blanks it so the next page starts clean.
      close: async () => {
        await send('Page.navigate', { url: 'about:blank' }).catch(() => {});
      },
    };
  }

  async close() {
    this.tab = undefined;
    this.session?.close();
    this.proc?.kill('SIGTERM');
    if (this.profile) await rm(this.profile, { recursive: true, force: true }).catch(() => {});
  }
}

let shared: Browser | null = null;
/** Process-wide warm browser. */
export function browser(): Browser {
  shared ??= new Browser();
  return shared;
}

/**
 * Layout audit run inside the page: text that overflows its box, text that
 * leaves the canvas or enters the platform safe-zone margins, and the
 * smallest rendered type size.
 */
/** uiShare: smallest readable UI text as a share of canvas width — 2.2% for phone feeds, ~1.2% for screens. */
export function layoutAuditScript(safe: SafeZone, width: number, height: number, uiShare = 0.022, notUi: string[] = []): string {
  return `(() => {
    const W = ${width}, H = ${height}, S = ${JSON.stringify(safe)};
    const out = { overflow: [], offCanvas: [], unsafe: [], minFont: 999, textCount: 0 };
    // Avatars crop to the inscribed circle; profile photos and page logos sit over fixed corners.
    const R = Math.min(W, H) / 2;
    const cover = (r) => {
      if (S.circle && [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]].some(([x, y]) => Math.hypot(x - W / 2, y - H / 2) > R + 1)) return 'outside the round crop';
      const a = (S.avoid || []).find((a) => r.right > a.x && r.left < a.x + a.w && r.bottom > a.y && r.top < a.y + a.h);
      return a ? 'under ' + a.what : '';
    };
    const label = (el) => (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/)[0] : '')) + ' "' + (el.textContent || '').trim().slice(0, 40) + '"';
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
      const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (!hasText) continue;
      out.textCount++;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      out.minFont = Math.min(out.minFont, parseFloat(cs.fontSize));
      const block = cs.display !== 'inline';
      if (block && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 3 || el.scrollHeight > el.clientHeight + 2 && /hidden|clip/.test(cs.overflowY)) out.overflow.push(label(el));
      if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) out.offCanvas.push(label(el));
      else if (!el.closest('[data-safe-ignore]')) {
        // Crops and overlays are judged on the glyphs themselves (a block heading is often wider than its words).
        const rg = document.createRange(); rg.selectNodeContents(el);
        const w = cover(rg.getBoundingClientRect());
        if (w) out.unsafe.push(label(el) + ' — ' + w);
        else if (r.left < S.left || r.top < S.top || r.right > W - S.right || r.bottom > H - S.bottom) out.unsafe.push(label(el));
      }
    }
    // Banners and avatars are cropped whole: a logo or picture outside the safe area is lost like text is.
    if (S.images) for (const el of document.querySelectorAll('img, [data-key]')) {
      if (el.closest('[data-safe-ignore]')) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
      let r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (el.tagName === 'IMG' && cs.objectFit === 'contain' && el.naturalWidth && el.naturalHeight) {
        const k = Math.min(r.width / el.naturalWidth, r.height / el.naturalHeight), cw = el.naturalWidth * k, ch = el.naturalHeight * k;
        r = { left: r.left + (r.width - cw) / 2, top: r.top + (r.height - ch) / 2, right: r.left + (r.width + cw) / 2, bottom: r.top + (r.height + ch) / 2 };
      }
      const name = el.tagName === 'IMG' ? 'image ' + decodeURIComponent((el.getAttribute('src') || '').split('/').pop() || '').slice(0, 40) : label(el);
      const w = cover(r) || (r.left < S.left - 1 || r.top < S.top - 1 || r.right > W - S.right + 1 || r.bottom > H - S.bottom + 1 ? 'outside the safe area' : '');
      if (w) out.unsafe.push(name + ' — ' + w);
    }
    // Screenshots whose UI text lands too small to read. UI body text is ~13 CSS px; a crop's file name
    // carries the CSS width of screen it covers (-ui620), otherwise 2x captures are assumed past 2400px.
    const minUi = Math.round(W * ${uiShare});
    const NOT_UI = ${JSON.stringify(notUi)};
    out.tinyShots = [...document.querySelectorAll('img')].filter((im) => !im.closest('.logo, .tag, .ic, .who, .lchip, .run') && !im.classList.contains('logo') && im.getBoundingClientRect().width > 160).map((im) => {
      const src = im.getAttribute('src') || '';
      // Crops of the brief's marketing graphics (-img) and the graphics themselves carry their own large type.
      if (/-img\\.png$/.test(src) || NOT_UI.includes(decodeURIComponent(src.split('/').pop() || ''))) return null;
      const tag = src.match(/-ui(\\d+)\\.(?:png|jpe?g|webp)/);
      if (!tag && im.naturalWidth < 1000) return null;
      const css = tag ? Number(tag[1]) : im.naturalWidth / (im.naturalWidth >= 2400 ? 2 : 1);
      const shown = im.getBoundingClientRect().width;
      const ui = 13 * shown / css;
      if (ui >= minUi) return null;
      const name = tag ? 'the cropped screenshot' : decodeURIComponent(src.split('/').pop() || '').slice(0, 60);
      const keep = Math.max(5, Math.min(95, Math.round((100 * ui) / minUi)));
      return name + ': its UI text lands at about ' + Math.floor(ui) + 'px on the canvas (needs ' + minUi + 'px). Crop to roughly ' + keep + '% of the width it shows now (the button, chart or result that proves the point) with #crop=x,y,w,h.';
    }).filter(Boolean);
    // Templates mark text that must stay big (data-min-font); auto-fit shrinking it below that means the copy is too long.
    out.small = [...document.querySelectorAll('[data-min-font]')].filter((el) => parseFloat(getComputedStyle(el).fontSize) < Number(el.dataset.minFont)).map((el) => label(el) + ' ' + Math.round(parseFloat(getComputedStyle(el).fontSize)) + 'px');
    out.broken = [...document.images].filter((im) => !im.complete || !im.naturalWidth).map((im) => (im.getAttribute('src') || '').split('/').pop().slice(0, 60));
    if (out.minFont === 999) out.minFont = 0;
    out.overflow = out.overflow.slice(0, 20); out.offCanvas = out.offCanvas.slice(0, 20); out.unsafe = out.unsafe.slice(0, 20);
    return out;
  })()`;
}

export interface LayoutAudit {
  overflow: string[];
  offCanvas: string[];
  unsafe: string[];
  minFont: number;
  textCount: number;
  /** Screenshots whose UI text lands below ~2.2% of the canvas width, each with the crop that would fix it. */
  tinyShots?: string[];
  /** Text marked data-min-font that auto-fit had to shrink below its floor. */
  small?: string[];
  /** Images that failed to load (file names). */
  broken?: string[];
}

/**
 * Shrink headlines until they fit their box: no word may stick out sideways
 * and (with data-fit-lines) the block may not exceed N lines. Runs in-page
 * after fonts load, so it measures the real typeface.
 */
export const FIT_SCRIPT = `(() => {
  const els = document.querySelectorAll('[data-fit], h1, h2, .title, .hl, .big, .num, .quote');
  let changed = 0;
  for (const el of els) {
    const cs = getComputedStyle(el);
    if (cs.display === 'inline' || !el.clientWidth) continue;
    let size = parseFloat(cs.fontSize);
    const min = Math.max(size * 0.45, 28);
    // Shrink-wrapped boxes (absolute, flex items) are measured against the room their parent leaves.
    const room = () => { const p = el.parentElement.getBoundingClientRect(); const r = el.getBoundingClientRect(); return Math.min(el.clientWidth, p.right - r.left, window.innerWidth - r.left); };
    const maxLines = Number(el.dataset.fitLines || 0);
    const lh = () => parseFloat(getComputedStyle(el).lineHeight) || size * 1.1;
    for (let i = 0; i < 30 && size > min; i++) {
      const tooWide = el.scrollWidth > room() + 1;
      const tooTall = maxLines && el.scrollHeight > lh() * maxLines + 2;
      if (!tooWide && !tooTall) break;
      size *= 0.94;
      el.style.fontSize = size + 'px';
      changed++;
    }
  }
  return changed;
})()`;

/**
 * Make a live website screenshot-ready: dismiss cookie/consent banners and
 * overlays, stop animations at their end state, and scroll the page once so
 * lazy content loads, then return to the top.
 */
export const TIDY_PAGE_SCRIPT = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const words = /^(accept|accept all|allow all|agree|i agree|got it|ok|okay|close|dismiss|no thanks|reject all|only necessary)$/i;
  for (const b of document.querySelectorAll('button, [role=button], a')) {
    const t = (b.innerText || b.getAttribute('aria-label') || '').trim();
    if (t.length < 24 && words.test(t)) { try { b.click(); } catch {} }
  }
  const css = document.createElement('style');
  css.textContent = '[id*=cookie i],[class*=cookie i],[id*=consent i],[class*=consent i],[class*=gdpr i],[id*=onetrust i],[class*=intercom i],[id*=intercom i],[class*=crisp i],iframe[title*=chat i]{display:none!important} *{animation-play-state:paused!important;caret-color:transparent!important}';
  document.head.appendChild(css);
  const H = Math.min(document.documentElement.scrollHeight, 12000);
  for (let y = 0; y < H; y += innerHeight * 0.8) { scrollTo(0, y); await sleep(120); }
  scrollTo(0, 0);
  await sleep(500);
  return H;
})()`;
