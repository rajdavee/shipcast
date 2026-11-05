import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { launchChrome, type Chrome } from './chrome.ts';
import { run } from './exec.ts';
import { fullChrome } from './capture-session.ts';

/**
 * Scripted takes of a real product: a phone or desktop viewport driven step by
 * step at human speed while the CDP screencast records every painted frame.
 * Frames keep their own timestamps and are laid onto a constant 30 fps
 * timeline, so a take lasts exactly as long as it took. Every tap is drawn
 * (a small ring) and logged with its time and position for later sync.
 */

export type TakeViewport = 'phone' | 'desktop';

/** How a step finds its element. `name` may be a "/regex/flags" string. */
export interface TakeTarget {
  role?: string;
  name?: string;
  text?: string;
  label?: string;
  css?: string;
  nth?: number;
}

export type TakeStep =
  | { goto: string }
  | { tap: TakeTarget }
  | { select: TakeTarget; value: string }
  | { type: TakeTarget; text: string }
  | { scrollTo: TakeTarget; offset?: number; ms?: number }
  | { wait: number }
  | { mark: string }
  | { clear: 'storage' }
  /** Attach local files to a file input (the input itself may be hidden). */
  | { upload: TakeTarget; files: string[] }
  /** Blur every element whose text contains one of these strings, for the rest of the take (names, emails). */
  | { redact: string[] };

export interface TakeOptions {
  url: string;
  viewport: TakeViewport;
  steps: TakeStep[];
  /** The MP4 to write; the log goes next to it as <name>.json. */
  out: string;
  profileDir?: string;
  headful?: boolean;
  userAgent?: string;
  /** Human pause after each step (ms). */
  pauseMs?: number;
  /** Delay between typed characters (ms). */
  typeDelayMs?: number;
  /** Still time held at the start and end of the take (ms). */
  holdMs?: number;
}

export interface TakeLog {
  url: string;
  viewport: TakeViewport;
  seconds: number;
  marks: { label: string; at: number }[];
  /** x and y are 0–1 across the viewport. */
  taps: { label: string; at: number; x: number; y: number }[];
}

export const VIEWPORTS: Record<TakeViewport, { width: number; height: number; scale: number; mobile: boolean }> = {
  phone: { width: 390, height: 844, scale: 3, mobile: true },
  desktop: { width: 1440, height: 900, scale: 2, mobile: false },
};

export const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const FPS = 30;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => (performance.timeOrigin + performance.now()) / 1000;

export class BotCheckError extends Error {}

/** One emulated tab in a launched Chrome. */
export interface Tab {
  chrome: Chrome;
  width: number;
  height: number;
  mobile: boolean;
  send<T = any>(method: string, params?: Record<string, unknown>): Promise<T>;
  eval<T = any>(expression: string): Promise<T>;
  on(method: string, fn: (params: any) => void): () => void;
  goto(url: string): Promise<void>;
  /** Wait for the document to finish loading and paint. */
  settle(): Promise<void>;
  /** Native alert/confirm text seen since the last read (confirms are always declined). */
  takeDialogs(): string[];
  /** True when the page is a bot check ("Just a moment…"). */
  botCheck(): Promise<boolean>;
}

export async function openTab(chrome: Chrome, viewport: TakeViewport, userAgent?: string): Promise<Tab> {
  const vp = VIEWPORTS[viewport];
  const targets = await chrome.send('Target.getTargets');
  const page = targets.targetInfos.find((t: any) => t.type === 'page');
  const targetId = page ? page.targetId : (await chrome.send('Target.createTarget', { url: 'about:blank' })).targetId;
  const { sessionId } = await chrome.send('Target.attachToTarget', { targetId, flatten: true });
  const send = <T = any>(m: string, p: Record<string, unknown> = {}) => chrome.send<T>(m, p, sessionId);
  const on = (method: string, fn: (params: any) => void) => chrome.onEvent((m, p, sid) => sid === sessionId && m === method && fn(p));
  const dialogs: string[] = [];
  on('Page.javascriptDialogOpening', (p) => {
    if (p.type !== 'beforeunload') dialogs.push(String(p.message ?? ''));
    send('Page.handleJavaScriptDialog', { accept: p.type === 'alert' || p.type === 'beforeunload' }).catch(() => {});
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: vp.scale, mobile: vp.mobile, screenWidth: vp.width, screenHeight: vp.height });
  await send('Emulation.setTouchEmulationEnabled', { enabled: vp.mobile, maxTouchPoints: vp.mobile ? 5 : 0 }).catch(() => {});
  // Headless Chrome announces itself in its user agent; sites treat that as a bot.
  const desktopUa = String((await chrome.send('Browser.getVersion')).userAgent ?? '').replace('HeadlessChrome', 'Chrome');
  await send('Emulation.setUserAgentOverride', { userAgent: userAgent ?? (vp.mobile ? IPHONE_UA : desktopUa), ...(vp.mobile && !userAgent ? { platform: 'iPhone' } : {}) });
  const evalIn = async <T>(expression: string): Promise<T> => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as T;
  };
  const settle = async () => {
    const until = Date.now() + 15_000;
    while (Date.now() < until) {
      const ok = await evalIn<boolean>(`document.readyState === 'complete'`).catch(() => false);
      if (ok) break;
      await sleep(50);
    }
    await evalIn(`Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 5000))]).then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))`).catch(() => {});
  };
  return {
    chrome,
    width: vp.width,
    height: vp.height,
    mobile: vp.mobile,
    send,
    eval: evalIn,
    on,
    settle,
    goto: async (url) => {
      let off = () => {};
      const loaded = new Promise<void>((r) => {
        off = on('Page.loadEventFired', () => r());
        setTimeout(r, 30_000);
      });
      const nav = await send('Page.navigate', { url });
      if (nav.errorText) {
        off();
        throw new Error(`Could not open ${url}: ${nav.errorText}`);
      }
      await loaded;
      off();
      await settle();
    },
    takeDialogs: () => dialogs.splice(0),
    botCheck: () => evalIn<boolean>(`/just a moment|performing security verification|verify you are human|checking your browser|attention required/i.test(document.title + ' ' + (document.body ? document.body.innerText.slice(0, 2000) : ''))`).catch(() => false),
  };
}

/** In-page element finder: roles and accessible names the way assistive tech reads them. */
export const FINDER_JS = `function __scFind(t) {
  const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
  const nameOf = (el) => {
    const al = el.getAttribute('aria-label'); if (norm(al)) return norm(al);
    const lb = el.getAttribute('aria-labelledby');
    if (lb) { const s = norm(lb.split(/\\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' ')); if (s) return s; }
    if (el.labels && el.labels.length) { const s = norm([...el.labels].map((l) => l.innerText).join(' ')); if (s) return s; }
    const tag = el.tagName;
    if (tag === 'INPUT' && /^(button|submit|reset)$/i.test(el.type)) return norm(el.value);
    if (tag === 'IMG') return norm(el.alt);
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return norm(el.getAttribute('placeholder') || el.title);
    return norm(el.innerText || el.textContent) || norm(el.title) || norm(el.querySelector('img[alt]')?.alt);
  };
  const roleOf = (el) => {
    const r = el.getAttribute('role'); if (r) return r.split(/\\s+/)[0];
    const tag = el.tagName.toLowerCase();
    if (tag === 'button' || tag === 'summary') return 'button';
    if (tag === 'a' && el.hasAttribute('href')) return 'link';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'select') return el.multiple || el.size > 1 ? 'listbox' : 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      const ty = (el.type || 'text').toLowerCase();
      if (/^(button|submit|reset|image)$/.test(ty)) return 'button';
      if (ty === 'checkbox' || ty === 'radio') return ty;
      if (ty === 'range') return 'slider';
      if (ty === 'search') return 'searchbox';
      if (/^(text|email|tel|url|password|number)$/.test(ty)) return 'textbox';
    }
    if (tag === 'img') return 'img';
    if (tag === 'dialog') return 'dialog';
    if (tag === 'li') return 'listitem';
    if (tag === 'nav') return 'navigation';
    return '';
  };
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) !== 0;
  };
  const matcher = (want) => {
    const m = /^\\/(.*)\\/([a-z]*)$/.exec(want);
    if (m) { const re = new RegExp(m[1], m[2]); return [(s) => re.test(s)]; }
    const w = norm(want).toLowerCase();
    return [(s) => s.toLowerCase() === w, (s) => s.toLowerCase().includes(w)];
  };
  const pick = (els, get, want) => {
    for (const f of matcher(want)) { const hit = els.filter((el) => f(get(el))); if (hit.length) return hit; }
    return [];
  };
  let els = [...document.querySelectorAll(t.css || 'body *')].filter(shown);
  if (t.role) els = els.filter((el) => roleOf(el) === t.role);
  else if (t.name != null) els = els.filter((el) => roleOf(el));
  if (t.name != null) els = pick(els, nameOf, t.name);
  if (t.label != null) els = pick(els.filter((el) => el.matches('input, select, textarea, [role=combobox], [role=textbox], [role=searchbox], [contenteditable=""], [contenteditable=true]')), nameOf, t.label);
  if (t.text != null) {
    els = pick(els, (el) => norm(el.innerText), t.text);
    els = els.filter((el) => !els.some((o) => o !== el && el.contains(o)));
  }
  const el = els[t.nth || 0];
  if (!el) return null;
  return { el, name: nameOf(el), role: roleOf(el) };
}`;

export function describeTarget(t: TakeTarget): string {
  const bits = [t.role, t.name != null && `"${t.name}"`, t.text != null && `text "${t.text}"`, t.label != null && `label "${t.label}"`, t.css && `css ${t.css}`, t.nth && `#${t.nth}`].filter(Boolean);
  return bits.join(' ') || 'element';
}

/** Run `body` in the page with the resolved element bound to `el` (and `hit` to {el, name, role}). */
async function withTarget<T>(tab: Tab, t: TakeTarget, body: string): Promise<T> {
  const r = await tab.eval<{ missing?: true; value?: T }>(`(() => { ${FINDER_JS}; const hit = __scFind(${JSON.stringify(t)}); if (!hit) return { missing: true }; const el = hit.el; return { value: (() => { ${body} })() }; })()`);
  if (r.missing) throw new Error(`Couldn't find ${describeTarget(t)} on ${await tab.eval<string>('location.href').catch(() => 'the page')}`);
  return r.value as T;
}

type Box = { x: number; y: number; w: number; h: number; name: string };
const boxOf = (tab: Tab, t: TakeTarget) => withTarget<Box>(tab, t, `const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, name: hit.name };`);

/** Eased (ease-in-out cubic) scroll of the element's scroll container, so the element's top lands `offset` px below the viewport top. */
async function smoothScroll(tab: Tab, t: TakeTarget, offset: number, ms: number) {
  await withTarget(tab, t, `
    let sc = el.parentElement;
    while (sc && sc !== document.body && !(/(auto|scroll)/.test(getComputedStyle(sc).overflowY) && sc.scrollHeight > sc.clientHeight)) sc = sc.parentElement;
    if (!sc || sc === document.body) sc = document.scrollingElement || document.documentElement;
    const root = sc === document.scrollingElement || sc === document.documentElement;
    const top = root ? 0 : sc.getBoundingClientRect().top;
    const from = sc.scrollTop;
    const to = Math.max(0, Math.min(sc.scrollHeight - sc.clientHeight, from + el.getBoundingClientRect().top - top - ${offset}));
    const ease = (p) => p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    return new Promise((done) => {
      if (Math.abs(to - from) < 1) return done(true);
      const t0 = performance.now();
      const tick = (ts) => {
        const p = Math.min(1, (ts - t0) / ${ms});
        sc.scrollTop = from + (to - from) * ease(p);
        if (p < 1) requestAnimationFrame(tick); else done(true);
      };
      requestAnimationFrame(tick);
    });`);
}

/** Bring the element fully into view (smoothly) and return its box. */
async function inView(tab: Tab, t: TakeTarget): Promise<Box> {
  const b = await boxOf(tab, t);
  if (b.y >= 0 && b.y + b.h <= tab.height && b.x >= 0 && b.x + b.w <= tab.width) return b;
  await smoothScroll(tab, t, Math.max(0, (tab.height - b.h) / 2), 700);
  await sleep(150);
  return boxOf(tab, t);
}

/**
 * Blur text that must not appear on camera. Installed once per document and
 * kept up to date by a MutationObserver, so rows that load later are covered too.
 */
const redactJs = (terms: string[]) => `(() => {
  const terms = ${JSON.stringify(terms.map((t) => t.toLowerCase()))};
  const hide = (root) => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = (n.nodeValue || '').toLowerCase();
      if (t.trim() && terms.some((x) => t.includes(x)) && n.parentElement) n.parentElement.style.filter = 'blur(9px)';
    }
    for (const el of root.querySelectorAll ? root.querySelectorAll('input,textarea') : []) if (terms.some((x) => String(el.value || '').toLowerCase().includes(x))) el.style.filter = 'blur(9px)';
  };
  const start = () => {
    hide(document.body);
    if (window.__scRedact) window.__scRedact.disconnect();
    // Observer callbacks run before the next paint, so new text is blurred before it's ever drawn.
    window.__scRedact = new MutationObserver(() => hide(document.body));
    window.__scRedact.observe(document.body, { subtree: true, childList: true, characterData: true });
  };
  if (document.body) start();
  else new MutationObserver((_, o) => { if (document.body) { o.disconnect(); start(); } }).observe(document.documentElement, { childList: true });
})()`;

/** A discreet tap ring: a 44 px cyan circle that grows and fades over 0.6 s. */
const ringJs = (x: number, y: number) => `(() => {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:${x - 22}px;top:${y - 22}px;width:44px;height:44px;border-radius:50%;box-sizing:border-box;border:3px solid #22d3ee;background:rgba(34,211,238,.18);box-shadow:0 0 0 1px rgba(255,255,255,.55),0 0 14px rgba(34,211,238,.5);pointer-events:none;z-index:2147483647';
  document.documentElement.appendChild(d);
  d.animate([{ transform: 'scale(.6)', opacity: 1 }, { transform: 'scale(1.5)', opacity: 0 }], { duration: 600, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' }).onfinish = () => d.remove();
})()`;

async function press(tab: Tab, x: number, y: number) {
  if (tab.mobile) {
    await tab.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await sleep(70);
    await tab.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await tab.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await tab.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sleep(70);
    await tab.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }
}

/** Screencast to numbered JPEGs on disk, each frame with its paint timestamp (epoch seconds). */
function screencast(tab: Tab, dir: string, scale: number) {
  const frames: { file: string; ts: number }[] = [];
  const writes: Promise<unknown>[] = [];
  let stopped = false;
  let gotFirst: (ts: number) => void = () => {};
  const first = new Promise<number>((r) => (gotFirst = r));
  const off = tab.on('Page.screencastFrame', (p) => {
    tab.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
    if (stopped) return;
    const ts = Number(p.metadata?.timestamp) || now();
    const last = frames.at(-1);
    if (last && ts <= last.ts) return;
    const file = join(dir, `f${String(frames.length).padStart(6, '0')}.jpg`);
    frames.push({ file, ts });
    writes.push(writeFile(file, Buffer.from(p.data, 'base64')));
    if (frames.length === 1) gotFirst(ts);
  });
  return {
    frames,
    first,
    start: () => tab.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: tab.width * scale, maxHeight: tab.height * scale, everyNthFrame: 1 }),
    stop: async () => {
      stopped = true;
      off();
      await tab.send('Page.stopScreencast').catch(() => {});
      await Promise.all(writes);
    },
  };
}

/** Lay timestamped frames onto a constant 30 fps H.264 timeline. */
async function assemble(frames: { file: string; ts: number }[], end: number, dir: string, out: string, width: number, height: number) {
  const t0 = frames[0].ts;
  const seconds = end - t0;
  const lines = ['ffconcat version 1.0'];
  frames.forEach((f, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].ts : end;
    lines.push(`file '${basename(f.file)}'`, `duration ${Math.max(0.001, next - f.ts).toFixed(6)}`);
  });
  // The concat demuxer ignores the last entry's duration unless the file is listed again.
  lines.push(`file '${basename(frames.at(-1)!.file)}'`);
  const list = join(dir, 'frames.ffconcat');
  await writeFile(list, lines.join('\n') + '\n');
  await mkdir(dirname(out), { recursive: true });
  const r = await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', `fps=${FPS},scale=${width}:${height}:flags=lanczos,format=yuv420p`, '-t', seconds.toFixed(3), '-r', String(FPS), '-c:v', 'libx264', '-preset', 'fast', '-crf', '17', '-movflags', '+faststart', out], { timeoutMs: 600_000 });
  if (r.code !== 0) throw new Error(`ffmpeg could not assemble the take: ${r.stderr.trim().slice(-400)}`);
  return seconds;
}

const logPath = (out: string) => out.replace(/\.mp4$/i, '') + '.json';

async function recordOnce(opts: TakeOptions, headful: boolean): Promise<TakeLog> {
  const vp = VIEWPORTS[opts.viewport];
  const pause = opts.pauseMs ?? 600;
  const hold = opts.holdMs ?? 800;
  const work = await mkdtemp(join(tmpdir(), 'shipcast-take-'));
  const chrome = await launchChrome({ profileDir: opts.profileDir, headful, bin: opts.profileDir || headful ? fullChrome() ?? undefined : undefined, windowSize: headful ? { width: vp.width + 40, height: vp.height + 160 } : undefined });
  try {
    const tab = await openTab(chrome, opts.viewport, opts.userAgent);
    const guard = async () => {
      if (!(await tab.botCheck())) return;
      if (!headful) throw new BotCheckError(`${opts.url} shows a bot check`);
      // A visible window: give the check (or the person at the keyboard) time to clear it.
      const until = Date.now() + 60_000;
      while (Date.now() < until && (await tab.botCheck())) await sleep(1000);
      if (await tab.botCheck()) throw new BotCheckError(`${opts.url} kept showing a bot check`);
      await tab.settle();
    };
    await tab.goto(opts.url);
    await guard();
    const cast = screencast(tab, work, vp.scale);
    await cast.start();
    // A static page paints nothing new; nudge one composite so the first frame arrives.
    await tab.eval(`(() => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:.01;pointer-events:none'; document.documentElement.appendChild(d); requestAnimationFrame(() => requestAnimationFrame(() => d.remove())); })()`).catch(() => {});
    const t0 = await Promise.race([cast.first, sleep(15_000).then(() => 0)]);
    if (!t0) throw new Error('The screencast produced no frames');
    const at = () => Math.round((now() - t0) * 1000) / 1000;
    const marks: TakeLog['marks'] = [];
    const taps: TakeLog['taps'] = [];
    const tap = async (t: TakeTarget, act: (b: Box) => Promise<void>) => {
      const b = await inView(tab, t);
      const x = b.x + b.w / 2, y = b.y + b.h / 2;
      await tab.eval(ringJs(x, y));
      await sleep(140);
      taps.push({ label: t.name ?? t.text ?? t.label ?? (b.name || t.css || 'tap'), at: at(), x: Math.round((x / vp.width) * 1e4) / 1e4, y: Math.round((y / vp.height) * 1e4) / 1e4 });
      await act(b);
    };
    // Redactions apply from the moment they're set, including on pages opened later.
    let redact: string[] = [];
    const applyRedact = () => (redact.length ? tab.eval(redactJs(redact)).catch(() => {}) : Promise.resolve());
    await sleep(hold);
    for (const step of opts.steps) {
      if ('goto' in step) {
        await tab.goto(new URL(step.goto, await tab.eval<string>('location.href')).href);
        await guard();
        await applyRedact();
      } else if ('redact' in step) {
        redact = [...new Set([...redact, ...step.redact.filter((t) => typeof t === 'string' && t.trim().length >= 2)])];
        await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: redactJs(redact) });
        await applyRedact();
        continue;
      } else if ('upload' in step) {
        const files = step.files.map((f) => resolve(f));
        for (const f of files) if (!existsSync(f)) throw new Error(`upload: ${f} doesn't exist`);
        const { result } = await tab.send('Runtime.evaluate', { expression: `(() => { ${FINDER_JS}; const t = ${JSON.stringify(step.upload)}; const isFile = (e) => e && e.tagName === 'INPUT' && e.type === 'file';
          const near = (el) => (isFile(el) ? el : el.querySelector('input[type=file]') || el.closest('form,label,div')?.querySelector('input[type=file]'));
          const hit = __scFind(t); if (hit) { const f = near(hit.el); if (f) return f; }
          // File inputs are usually hidden, which the finder skips: try labels, then CSS, then the page's only file input.
          const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
          const want = norm(t.label || t.name || t.text);
          if (want) for (const l of document.querySelectorAll('label')) if (norm(l.innerText).includes(want) && isFile(l.control)) return l.control;
          if (t.css) { const c = document.querySelector(t.css); if (c) return near(c) || null; }
          const all = document.querySelectorAll('input[type=file]'); return all.length === 1 ? all[0] : null; })()` });
        if (!result?.objectId) throw new Error(`Couldn't find a file input at ${describeTarget(step.upload)}`);
        await tab.send('DOM.setFileInputFiles', { files, objectId: result.objectId });
        await tab.settle();
      } else if ('tap' in step) {
        await tap(step.tap, (b) => press(tab, b.x + b.w / 2, b.y + b.h / 2));
        await sleep(250);
        await tab.settle();
        await applyRedact();
      } else if ('select' in step) {
        const value = step.value;
        await tap(step.select, async () => {
          const ok = await withTarget<boolean>(tab, step.select, `const want = ${JSON.stringify(value)}.toLowerCase(); const o = [...(el.options || [])].find((o) => o.value.toLowerCase() === want || o.text.trim().toLowerCase() === want); if (!o) return false; el.value = o.value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true;`);
          if (!ok) throw new Error(`${describeTarget(step.select)} has no option "${value}"`);
        });
      } else if ('type' in step) {
        await tap(step.type, (b) => press(tab, b.x + b.w / 2, b.y + b.h / 2));
        await withTarget(tab, step.type, `el.focus(); return true;`);
        for (const ch of step.text) {
          await tab.send('Input.insertText', { text: ch });
          await sleep(opts.typeDelayMs ?? 70);
        }
      } else if ('scrollTo' in step) {
        await smoothScroll(tab, step.scrollTo, step.offset ?? 80, step.ms ?? 1200);
      } else if ('wait' in step) {
        await sleep(step.wait);
        continue;
      } else if ('mark' in step) {
        marks.push({ label: step.mark, at: at() });
        continue;
      } else if ('clear' in step) {
        const origin = await tab.eval<string>('location.origin');
        await tab.send('Storage.clearDataForOrigin', { origin, storageTypes: 'local_storage,indexeddb,cache_storage,service_workers,websql,file_systems' }).catch(() => {});
        await tab.eval('sessionStorage.clear()').catch(() => {});
        continue;
      } else {
        throw new Error(`Unknown step ${JSON.stringify(step)}`);
      }
      await sleep(pause);
    }
    await sleep(hold);
    const end = now();
    await cast.stop();
    const seconds = await assemble(cast.frames, end, work, opts.out, vp.width * vp.scale, vp.height * vp.scale);
    const log: TakeLog = { url: opts.url, viewport: opts.viewport, seconds: Math.round(seconds * 1000) / 1000, marks, taps };
    await writeFile(logPath(opts.out), JSON.stringify(log, null, 2));
    return log;
  } finally {
    await chrome.close();
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Record a scripted take of `url` to `out` (MP4) plus `<out without .mp4>.json`.
 * A headless take that meets a bot check is retried once in a visible window
 * on the same profile.
 */
export async function recordTake(opts: TakeOptions): Promise<TakeLog> {
  try {
    return await recordOnce(opts, !!opts.headful);
  } catch (e) {
    if (!(e instanceof BotCheckError) || opts.headful) throw e;
    return recordOnce(opts, true);
  }
}
