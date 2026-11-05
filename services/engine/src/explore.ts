import { launchChrome } from './chrome.ts';
import { fullChrome } from './capture-session.ts';
import { openTab, type Tab, type TakeViewport } from './takes.ts';

/**
 * Product explorer (opt-in per URL): opens each view, reads its headings and
 * controls, and presses every control that can't change anything, noting what
 * each one shows (a dialog, a message, another page). The notes become a
 * product-understanding draft written in the product's own words.
 */

/** Controls never pressed: anything that could submit, spend, send, delete or sign out. */
export const DESTRUCTIVE = /submit|confirm|delete|remove|send|pay|save|publish|approve|decline|revoke|sign ?out|log ?out|cancel subscription/i;

export interface ExploreControl {
  label: string;
  kind: string;
  result: string;
}

export interface ExploreView {
  url: string;
  title: string;
  headings: string[];
  controls: ExploreControl[];
}

export interface ExploreResult {
  url: string;
  viewport: TakeViewport;
  views: ExploreView[];
}

export interface ExploreOptions {
  url: string;
  /** View URLs (absolute or relative to `url`); just `url` when omitted. */
  views?: string[];
  viewport: TakeViewport;
  profileDir?: string;
  /** Controls pressed per view at most. */
  maxControls?: number;
}

type Found = { label: string; kind: string; n: number; href?: string; external?: boolean; newTab?: boolean; submits?: boolean; options?: string[] };

const COLLECT_JS = `(() => {
  const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
  const headings = [...document.querySelectorAll('h1, h2')].map((h) => norm(h.innerText)).filter(Boolean);
  const seen = new Map();
  const controls = [];
  for (const el of document.querySelectorAll('a[href], button, [role=button], [role=link], [role=tab], [role=menuitem], input[type=button], input[type=submit], summary, select')) {
    if (el.closest('[aria-hidden=true]')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'select' ? 'select' : 'button');
    let label = '';
    if (el.getAttribute('aria-label')) label = norm(el.getAttribute('aria-label'));
    else if (tag === 'select') label = norm(el.labels && el.labels[0] ? el.labels[0].innerText : el.getAttribute('name'));
    else if (tag === 'input') label = norm(el.value);
    else label = norm(el.innerText || el.title || el.querySelector('img[alt]')?.alt);
    if (!label) continue;
    label = label.slice(0, 80);
    const key = role + '|' + label;
    const n = seen.get(key) || 0;
    seen.set(key, n + 1);
    if (n) continue;
    const c = { label, kind: role, n };
    if (tag === 'a') {
      const u = new URL(el.href, location.href);
      c.href = u.href;
      c.external = !/^https?:$/.test(u.protocol) || u.origin !== location.origin;
      c.newTab = el.target === '_blank';
    }
    if ((tag === 'button' || tag === 'input') && el.form && el.type === 'submit') c.submits = true;
    if (tag === 'select') c.options = [...el.options].map((o) => norm(o.text)).filter(Boolean).slice(0, 12);
    controls.push(c);
  }
  return { title: document.title, headings, controls };
})()`;

/** Notes on overlays and status messages that show up after a press. */
const WATCH_JS = `(() => {
  const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
  const sel = '[role=status], [role=alert], [aria-live]:not([aria-live=off]), [class*=toast i], [class*=snackbar i]';
  const before = new Set([...document.querySelectorAll(sel)].map((e) => norm(e.innerText)));
  window.__scSeen = [];
  window.__scBody = norm(document.body.innerText).length + ':' + norm(document.body.innerText).slice(0, 4000);
  const scan = () => { for (const e of document.querySelectorAll(sel)) { const t = norm(e.innerText); if (t && !before.has(t) && !window.__scSeen.includes(t)) window.__scSeen.push(t); } };
  window.__scObs?.disconnect();
  window.__scObs = new MutationObserver(scan);
  window.__scObs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  return true;
})()`;

const DIALOG_JS = `(() => {
  const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
  const d = [...document.querySelectorAll('[role=dialog], [role=alertdialog], dialog[open], [aria-modal=true]')].find((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width && r.height && cs.visibility !== 'hidden' && cs.display !== 'none'; });
  return d ? norm(d.innerText).slice(0, 400) : '';
})()`;

const clip = (s: string, n = 160) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

async function pressControl(tab: Tab, c: Found): Promise<boolean> {
  return tab.eval<boolean>(`(() => {
      const want = ${JSON.stringify(c)};
    const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
    const all = [...document.querySelectorAll('a[href], button, [role=button], [role=link], [role=tab], [role=menuitem], input[type=button], input[type=submit], summary')].filter((el) => {
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute('role') || (tag === 'a' ? 'link' : 'button');
      const label = (el.getAttribute('aria-label') ? norm(el.getAttribute('aria-label')) : tag === 'input' ? norm(el.value) : norm(el.innerText || el.title || el.querySelector('img[alt]')?.alt)).slice(0, 80);
      return role === want.kind && label === want.label;
    });
    const el = all[want.n];
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    el.click();
    return true;
  })()`);
}

async function closeOverlay(tab: Tab): Promise<boolean> {
  for (const key of ['keyDown', 'keyUp']) await tab.send('Input.dispatchKeyEvent', { type: key, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 300));
  if (!(await tab.eval<string>(DIALOG_JS))) return true;
  await tab.eval(`(() => {
    const d = [...document.querySelectorAll('[role=dialog], [role=alertdialog], dialog[open], [aria-modal=true]')].pop();
    const b = d && [...d.querySelectorAll('button, [role=button], a')].find((b) => /^(close|dismiss|done|got it|ok|okay|cancel|×|✕|x)$/i.test((b.getAttribute('aria-label') || b.innerText || '').trim()));
    if (b) b.click();
  })()`).catch(() => {});
  await new Promise((r) => setTimeout(r, 300));
  return !(await tab.eval<string>(DIALOG_JS));
}

async function exploreView(tab: Tab, url: string, max: number): Promise<ExploreView> {
  await tab.goto(url);
  const info = await tab.eval<{ title: string; headings: string[]; controls: Found[] }>(COLLECT_JS);
  const view: ExploreView = { url, title: info.title, headings: info.headings, controls: [] };
  let pressed = 0;
  for (const c of info.controls) {
    const out = (result: string) => view.controls.push({ label: c.label, kind: c.kind, result });
    if (DESTRUCTIVE.test(c.label)) out('skipped: could change data');
    else if (c.submits) out('skipped: submits a form');
    else if (c.options) out(`choices: ${c.options.join(', ')}`);
    else if (c.external) out(`skipped: leaves the site (${c.href})`);
    else if (c.newTab) out(`opens ${c.href} in a new tab`);
    else if (pressed >= max) out('not pressed (limit reached)');
    else {
      pressed++;
      await tab.eval(WATCH_JS).catch(() => {});
      tab.takeDialogs();
      if (!(await pressControl(tab, c).catch(() => false))) {
        out('could not be pressed');
        continue;
      }
      await new Promise((r) => setTimeout(r, 800));
      await tab.settle();
      const href = await tab.eval<string>('location.href').catch(() => url);
      const native = tab.takeDialogs();
      const dialog = await tab.eval<string>(DIALOG_JS).catch(() => '');
      const seen = await tab.eval<string[]>('window.__scSeen || []').catch(() => [] as string[]);
      const changed = await tab.eval<boolean>(`(() => { const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim(); return window.__scBody !== norm(document.body.innerText).length + ':' + norm(document.body.innerText).slice(0, 4000); })()`).catch(() => false);
      if (href.split('#')[0] !== url.split('#')[0]) {
        out(`opens ${href}`);
        await tab.goto(url);
      } else if (native.length) out(`asks: "${clip(native.join(' / '))}"`);
      else if (dialog) {
        out(`opens a dialog: "${clip(dialog, 400)}"`);
        if (!(await closeOverlay(tab))) await tab.goto(url);
      } else if (seen.length) out(`shows "${clip(seen.join(' / '))}"`);
      else if (href !== url) out(`jumps to ${new URL(href).hash}`);
      else out(changed ? 'changes the page' : 'no visible change');
    }
  }
  return view;
}

/** Explore a product's views. Only call it for a URL the user turned exploring on for. */
export async function exploreProduct(opts: ExploreOptions): Promise<ExploreResult> {
  const views = (opts.views?.length ? opts.views : [opts.url]).map((v) => new URL(v, opts.url).href);
  const chrome = await launchChrome({ profileDir: opts.profileDir, bin: opts.profileDir ? fullChrome() ?? undefined : undefined });
  try {
    const tab = await openTab(chrome, opts.viewport);
    const out: ExploreView[] = [];
    for (const v of views) out.push(await exploreView(tab, v, opts.maxControls ?? 40));
    return { url: opts.url, viewport: opts.viewport, views: out };
  } finally {
    await chrome.close();
  }
}

/** A readable product-understanding draft from an exploration. */
export function productMarkdown(r: ExploreResult): string {
  const lines = [`# Product notes: ${new URL(r.url).host}`, '', `Explored ${r.views.length} view${r.views.length === 1 ? '' : 's'} at ${r.viewport} size. Draft: check it against the product before writing from it.`, ''];
  for (const v of r.views) {
    lines.push(`## ${v.title || v.headings[0] || v.url}`, '', `URL: ${v.url}`, '');
    if (v.headings.length) lines.push('Headings:', ...v.headings.map((h) => `- ${h}`), '');
    const shown = v.controls.filter((c) => !c.result.startsWith('skipped'));
    const skipped = v.controls.filter((c) => c.result.startsWith('skipped'));
    if (shown.length) lines.push('What the controls do:', ...shown.map((c) => `- **${c.label}** (${c.kind}): ${c.result}`), '');
    if (skipped.length) lines.push('Not pressed:', ...skipped.map((c) => `- ${c.label} (${c.result.replace(/^skipped: /, '')})`), '');
  }
  return lines.join('\n');
}
