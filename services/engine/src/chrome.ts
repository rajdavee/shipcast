import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findChrome } from './doctor.ts';

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
  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ready = new Promise((res, rej) => {
      this.ws.onopen = () => res();
      this.ws.onerror = () => rej(new Error('DevTools connection failed'));
    });
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data));
      const p = msg.id && this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${msg.error.message}`));
      else p.resolve(msg.result);
    };
    this.ws.onclose = () => {
      for (const p of this.pending.values()) p.reject(new Error('DevTools connection closed'));
      this.pending.clear();
    };
  }
  async send<T = any>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    await this.ready;
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`));
      }, 120_000);
    });
  }
  close() {
    this.ws.close();
  }
}

export interface CaptureOptions {
  width: number;
  height: number;
  /** Extra settle time after fonts/images are ready (ms). */
  settleMs?: number;
}

export interface PageHandle {
  eval<T = any>(expression: string): Promise<T>;
  screenshot(format?: 'png' | 'jpeg', quality?: number): Promise<Buffer>;
  pdf(): Promise<Buffer>;
  close(): Promise<void>;
}

export class Browser {
  private proc?: ChildProcess;
  private session?: Session;
  private profile?: string;
  private starting?: Promise<void>;

  private async start() {
    const bin = process.env.CHROME_PATH ?? findChrome();
    if (!bin) throw new Error('No Chrome found. Run `npx hyperframes browser ensure` or install Google Chrome.');
    this.profile = await mkdtemp(join(tmpdir(), 'shipcast-chrome-'));
    const proc = spawn(bin, ['--headless', '--remote-debugging-port=0', `--user-data-dir=${this.profile}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-color-profile=srgb', '--font-render-hinting=none', '--disable-gpu', '--no-sandbox', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    this.proc = proc;
    const wsUrl = await new Promise<string>((resolve, reject) => {
      let buf = '';
      const t = setTimeout(() => reject(new Error('Chrome did not start')), 20_000);
      proc.stderr!.on('data', (d) => {
        buf += d;
        const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
        if (m) {
          clearTimeout(t);
          resolve(m[1]);
        }
      });
      proc.on('exit', () => reject(new Error(`Chrome exited: ${buf.slice(-300)}`)));
    });
    this.session = new Session(wsUrl);
    proc.on('exit', () => {
      this.session = undefined;
      this.proc = undefined;
      this.starting = undefined;
    });
  }

  private async ensure(): Promise<Session> {
    if (!this.session) {
      this.starting ??= this.start();
      await this.starting;
    }
    return this.session!;
  }

  /** Open a page at an exact viewport and wait until it's fully painted. */
  async open(url: string, opts: CaptureOptions): Promise<PageHandle> {
    const s = await this.ensure();
    const { targetId } = await s.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await s.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (m: string, p: Record<string, unknown> = {}) => s.send(m, p, sessionId);
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: opts.width, height: opts.height, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    await send('Page.navigate', { url });
    const evalIn = async <T>(expression: string): Promise<T> => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value as T;
    };
    // Wait for load, fonts and every <img>, then let one more frame paint.
    await evalIn(`new Promise(r => { const go = () => r(true); if (document.readyState === 'complete') go(); else addEventListener('load', go, { once: true }); setTimeout(go, 15000); })`);
    await evalIn(`Promise.race([Promise.all([document.fonts.ready, ...[...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))]), new Promise(r => setTimeout(r, 10000))]).then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))`);
    if (opts.settleMs) await new Promise((r) => setTimeout(r, opts.settleMs));
    return {
      eval: evalIn,
      screenshot: async (format = 'png', quality = 92) => {
        const r = await send('Page.captureScreenshot', { format, ...(format === 'jpeg' ? { quality } : {}), clip: { x: 0, y: 0, width: opts.width, height: opts.height, scale: 1 }, captureBeyondViewport: false });
        return Buffer.from(r.data, 'base64');
      },
      pdf: async () => {
        const r = await send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true, paperWidth: opts.width / 96, paperHeight: opts.height / 96, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 });
        return Buffer.from(r.data, 'base64');
      },
      close: async () => {
        await s.send('Target.closeTarget', { targetId }).catch(() => {});
      },
    };
  }

  async close() {
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
export function layoutAuditScript(safe: { top: number; right: number; bottom: number; left: number }, width: number, height: number): string {
  return `(() => {
    const W = ${width}, H = ${height}, S = ${JSON.stringify(safe)};
    const out = { overflow: [], offCanvas: [], unsafe: [], minFont: 999, textCount: 0 };
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
      if (el.scrollWidth > el.clientWidth + 2 && cs.overflow !== 'visible' || el.scrollHeight > el.clientHeight + 2 && /hidden|clip/.test(cs.overflowY)) out.overflow.push(label(el));
      if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) out.offCanvas.push(label(el));
      else if (!el.closest('[data-safe-ignore]') && (r.left < S.left || r.top < S.top || r.right > W - S.right || r.bottom > H - S.bottom)) out.unsafe.push(label(el));
    }
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
}
