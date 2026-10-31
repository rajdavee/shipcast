#!/usr/bin/env node
// Shipcast app capture: drive a real browser through a running app from a JSON plan.
//
//   node capture.mjs plan.json
//
// plan.json:
// {
//   "base": "http://localhost:8091",              // or set SHIPCAST_APP_URL
//   "out": "out/screens",                         // folder for screenshots and recordings
//   "viewport": { "width": 1440, "height": 900, "scale": 2 },
//   "steps": [
//     { "goto": "/login" },
//     { "fill": "input[type=email]", "env": "SHIPCAST_LOGIN_EMAIL" },   // value from env, never logged
//     { "fill": "input[type=password]", "env": "SHIPCAST_LOGIN_PASSWORD" },
//     { "click": "button[type=submit]" },
//     { "waitFor": "nav" },                       // CSS selector, up to 15 s
//     { "shot": "dashboard" },                    // viewport screenshot → dashboard.png
//     { "shot": "dashboard-full", "full": true },  // whole page
//     { "click": "a[href*='calls']" }, { "wait": 1200 },
//     { "record": "calls-walkthrough", "seconds": 10, "scroll": true },  // MP4 of a smooth scroll
//     { "mobile": true }, { "goto": "/dashboard" }, { "shot": "dashboard-mobile" },
//     { "eval": "document.querySelector('.cookie-banner')?.remove()" },
//     // Exact boxes for the video's highlights (0–1 fractions of the screenshot) → billing.marks.json
//     { "shot": "billing", "marks": { "buy": "text=Buy credits", "usage": "#usage-card" } },
//     // A real click-through, filmed with a visible cursor and human typing → buy-credits.mp4 (+ .json timeline)
//     { "record": "buy-credits", "actions": [
//         { "move": "text=Buy a custom amount" }, { "click": "input[name=credits]" },
//         { "type": "1200" }, { "wait": 700 }, { "click": "text=Buy" }, { "wait": 1500 },
//         { "scroll": 500 }, { "hover": ".usage-row" }, { "wait": 1200 } ] }
//   ]
// }
// Selectors: any CSS selector, or text=Some label (the smallest visible element containing that text).
// "dark": true at the top level captures the app in dark mode (prefers-color-scheme).
// Prints one JSON line per file written; exits non-zero with the failing step on error.

import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const planPath = process.argv[2];
if (!planPath) {
  console.error('usage: node capture.mjs plan.json');
  process.exit(2);
}
const plan = JSON.parse(readFileSync(planPath, 'utf8'));
const base = (plan.base || process.env.SHIPCAST_APP_URL || '').replace(/\/$/, '');
const out = resolve(plan.out || 'out/screens');
const vp = { width: 1440, height: 900, scale: 2, ...(plan.viewport || {}) };

function findChrome() {
  const c = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const p of c) if (p && existsSync(p)) return p;
  // HyperFrames' managed Chrome.
  const home = process.env.HOME || '';
  const hf = join(home, '.cache', 'hyperframes');
  if (existsSync(hf)) {
    const r = spawn('find', [hf, '-name', 'Google Chrome for Testing', '-type', 'f']);
    return new Promise((res) => {
      let s = '';
      r.stdout.on('data', (d) => (s += d));
      r.on('close', () => res(s.split('\n').find(Boolean) || null));
    });
  }
  return null;
}

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.ready = new Promise((r, j) => {
      this.ws.onopen = r;
      this.ws.onerror = j;
    });
    this.ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      } else if (msg.method) for (const f of this.listeners.get(msg.method) || []) f(msg.params, msg.sessionId);
    };
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      setTimeout(() => this.pending.has(id) && (this.pending.delete(id), rej(new Error(`${method} timed out`))), 60_000);
    });
  }
  on(method, f) {
    this.listeners.set(method, [...(this.listeners.get(method) || []), f]);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const emit = (o) => console.log(JSON.stringify(o));

async function main() {
  const bin = await findChrome();
  if (!bin) throw new Error('No Chrome found (set CHROME_PATH)');
  await mkdir(out, { recursive: true });
  const profile = await mkdtemp(join(tmpdir(), 'shipcast-capture-'));
  const chrome = spawn(bin, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--ignore-certificate-errors', '--force-color-profile=srgb', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((res, rej) => {
    let buf = '';
    const t = setTimeout(() => rej(new Error('Chrome did not start')), 20_000);
    chrome.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) {
        clearTimeout(t);
        res(m[1]);
      }
    });
  });
  const cdp = new CDP(wsUrl);
  await cdp.ready;
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => cdp.send(m, p, sessionId);
  await s('Page.enable');
  await s('Runtime.enable');
  let mobile = false;
  const metrics = async () => {
    const m = mobile ? { width: 390, height: 844, deviceScaleFactor: 3, mobile: true } : { width: vp.width, height: vp.height, deviceScaleFactor: vp.scale, mobile: false };
    await s('Emulation.setDeviceMetricsOverride', m);
    await s('Emulation.setTouchEmulationEnabled', { enabled: mobile }).catch(() => {});
    return m;
  };
  let view = await metrics();
  if (plan.dark) await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  // The filmed cursor: an overlay that glides between targets, then a real click lands under it.
  let cur = { x: vp.width * 0.82, y: vp.height * 0.86 };
  const cursorJs = `(() => { if (document.getElementById('__sc_cursor')) return 1; const d = document.createElement('div'); d.id = '__sc_cursor'; d.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(0px,0px);will-change:transform;filter:drop-shadow(0 4px 8px rgba(0,0,0,.35))'; d.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l16 9.5-7 1.6-3.6 6.9z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg><i style="position:absolute;left:-16px;top:-16px;width:34px;height:34px;border-radius:50%;border:3px solid rgba(80,120,255,.9);opacity:0"></i>'; document.documentElement.appendChild(d); return 1; })()`;
  const glide = async (x, y, ms = 750) => {
    await evaluate(cursorJs);
    await evaluate(`(() => { const d = document.getElementById('__sc_cursor'); const a = ${JSON.stringify(cur)}, b = { x: ${x}, y: ${y} }; d.style.transform = 'translate(' + a.x + 'px,' + a.y + 'px)'; const t0 = performance.now(); const e = (k) => k < .5 ? 4*k*k*k : 1 - Math.pow(-2*k + 2, 3) / 2; return new Promise(r => { const f = (now) => { const k = Math.min(1, (now - t0) / ${ms}); const q = e(k); const arc = Math.sin(Math.PI * k) * Math.min(60, Math.hypot(b.x - a.x, b.y - a.y) * .12); d.style.transform = 'translate(' + (a.x + (b.x - a.x) * q) + 'px,' + (a.y + (b.y - a.y) * q - arc) + 'px)'; k < 1 ? requestAnimationFrame(f) : r(1); }; requestAnimationFrame(f); }); })()`);
    cur = { x, y };
    await s('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  };
  const ripple = () => evaluate(`(() => { const i = document.querySelector('#__sc_cursor i'); if (!i) return; i.animate([{ transform: 'scale(.3)', opacity: .9 }, { transform: 'scale(1.6)', opacity: 0 }], { duration: 550, easing: 'cubic-bezier(.2,.8,.2,1)' }); const v = document.querySelector('#__sc_cursor svg'); v.animate([{ transform: 'scale(1)' }, { transform: 'scale(.8)' }, { transform: 'scale(1)' }], { duration: 180 }); })()`).catch(() => {});
  const evaluate = async (expression) => {
    const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const settle = async () => {
    await evaluate(`new Promise(r => { const ok = () => document.readyState === 'complete'; if (ok()) r(1); else window.addEventListener('load', () => r(1), { once: true }); setTimeout(() => r(1), 15000); })`).catch(() => {});
    await evaluate(`Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 4000))]).then(() => new Promise(r => setTimeout(r, 600)))`).catch(() => {});
  };
  // A selector is CSS, or text=Label for the smallest visible element containing that text.
  const findJs = (sel) =>
    String(sel).startsWith('text=')
      ? `(() => { const want = ${JSON.stringify(String(sel).slice(5).trim().toLowerCase())}; let best = null; for (const el of document.querySelectorAll('body *')) { const b = el.getBoundingClientRect(); if (!b.width || !b.height || getComputedStyle(el).visibility === 'hidden') continue; const t = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().toLowerCase(); if (!t.includes(want)) continue; if (!best || b.width * b.height < best.b.width * best.b.height) best = { el, b }; } return best && best.el; })()`
      : `document.querySelector(${JSON.stringify(sel)})`;
  const center = async (sel, scroll = true) => {
    const r = await evaluate(`(() => { const el = ${findJs(sel)}; if (!el) return null; ${scroll ? "const b0 = el.getBoundingClientRect(); if (b0.top < 60 || b0.bottom > innerHeight - 60) el.scrollIntoView({ block: 'center' });" : ''} const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
    if (!r) throw new Error(`selector not found: ${sel}`);
    return r;
  };
  const click = async (sel) => {
    const { x, y } = await center(sel);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await s('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  };

  for (const [i, st] of (plan.steps || []).entries()) {
    try {
      if (st.mobile !== undefined) {
        mobile = !!st.mobile;
        view = await metrics();
      }
      if (st.goto) {
        const url = /^https?:/.test(st.goto) ? st.goto : base + (st.goto.startsWith('/') ? st.goto : `/${st.goto}`);
        await s('Page.navigate', { url });
        await settle();
      }
      if (st.fill) {
        const value = st.env ? process.env[st.env] ?? '' : String(st.value ?? '');
        if (st.env && !value) throw new Error(`env ${st.env} is empty`);
        await click(st.fill);
        await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(st.fill)}); el.focus(); el.select?.(); })()`);
        await s('Input.insertText', { text: value });
        emit({ step: i, filled: st.fill, from: st.env ? `env:${st.env}` : 'value' });
      }
      if (st.click) {
        await click(st.click);
        await sleep(st.wait ?? 900);
        await settle();
      }
      if (st.press) await s('Input.dispatchKeyEvent', { type: 'keyDown', key: st.press, windowsVirtualKeyCode: st.press === 'Enter' ? 13 : 0 });
      if (st.waitFor) {
        const t0 = Date.now();
        while (!(await evaluate(`!!document.querySelector(${JSON.stringify(st.waitFor)})`))) {
          if (Date.now() - t0 > (st.timeout ?? 15000)) throw new Error(`timed out waiting for ${st.waitFor}`);
          await sleep(250);
        }
      }
      if (st.wait && !st.click) await sleep(st.wait);
      if (st.eval) await evaluate(st.eval);
      if (st.shot) {
        let r;
        if (st.full) {
          const m = await s('Page.getLayoutMetrics');
          const h = Math.min(Math.ceil((m.cssContentSize || m.contentSize).height), st.maxHeight ?? 6000);
          await s('Emulation.setDeviceMetricsOverride', { ...view, height: h });
          await sleep(400);
          r = await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
          view = await metrics();
        } else r = await s('Page.captureScreenshot', { format: 'png' });
        const file = join(out, `${st.shot}.png`);
        await writeFile(file, Buffer.from(r.data, 'base64'));
        // Exact element boxes as 0–1 fractions of this screenshot, for the video's highlights.
        let marks;
        if (st.marks && typeof st.marks === 'object') {
          marks = {};
          for (const [name, sel] of Object.entries(st.marks)) {
            const b = await evaluate(`(() => { const el = ${findJs(sel)}; if (!el) return null; const r = el.getBoundingClientRect(); const full = ${!!st.full}; const W = full ? document.documentElement.scrollWidth : innerWidth; const H = full ? Math.min(document.documentElement.scrollHeight, ${st.maxHeight ?? 6000}) : innerHeight; const ox = full ? scrollX : 0, oy = full ? scrollY : 0; const c = (v) => Math.round(Math.min(Math.max(v, 0), 1) * 10000) / 10000; return { x: c((r.left + ox) / W), y: c((r.top + oy) / H), w: c(r.width / W), h: c(r.height / H) }; })()`).catch(() => null);
            if (b) marks[name] = b;
            else emit({ step: i, warning: `mark not found: ${name}` });
          }
          await writeFile(join(out, `${st.shot}.marks.json`), JSON.stringify(marks, null, 2));
        }
        emit({ step: i, file, url: await evaluate('location.href'), mobile, marks });
      }
      if (st.record) {
        // Screencast frames → MP4. With scroll: a smooth eased scroll through the page.
        const dir = await mkdtemp(join(tmpdir(), 'shipcast-rec-'));
        const frames = [];
        cdp.on('Page.screencastFrame', async (p, sid) => {
          if (sid !== sessionId) return;
          frames.push({ data: p.data, t: p.metadata.timestamp });
          s('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
        });
        await s('Page.startScreencast', { format: 'jpeg', quality: 88, everyNthFrame: 1, maxWidth: Math.round(view.width * view.deviceScaleFactor), maxHeight: Math.round(view.height * view.deviceScaleFactor) });
        const secs = st.seconds ?? 8;
        const t0 = Date.now();
        const timeline = [];
        if (Array.isArray(st.actions)) {
          await sleep(600);
          for (const [ai, a] of st.actions.entries()) {
            const at = +((Date.now() - t0) / 1000).toFixed(2);
            try {
            if (a.move || a.hover || a.click) {
              const sel = a.move || a.hover || a.click;
              const { x, y } = await center(sel);
              await sleep(250);
              await glide(x, y, a.ms ?? 750);
              timeline.push({ at, do: a.click ? 'click' : 'move', target: sel, x: +(x / view.width).toFixed(4), y: +(y / view.height).toFixed(4) });
              if (a.click) {
                await sleep(120);
                await ripple();
                for (const type of ['mousePressed', 'mouseReleased']) await s('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
                await sleep(a.wait ?? 700);
                await evaluate(cursorJs).catch(() => {});
                await evaluate(`(() => { const d = document.getElementById('__sc_cursor'); if (d) d.style.transform = 'translate(${x}px,${y}px)'; })()`).catch(() => {});
              } else await sleep(a.wait ?? 300);
            } else if (a.type !== undefined) {
              const text = a.env ? process.env[a.env] ?? '' : String(a.type);
              for (const [k, ch] of [...text].entries()) {
                await s('Input.insertText', { text: ch });
                await sleep(55 + ((k * 37) % 60));
              }
              timeline.push({ at, do: 'type', chars: text.length });
              await sleep(a.wait ?? 350);
            } else if (a.press) {
              await s('Input.dispatchKeyEvent', { type: 'keyDown', key: a.press, windowsVirtualKeyCode: a.press === 'Enter' ? 13 : a.press === 'Tab' ? 9 : a.press === 'Escape' ? 27 : 0 });
              await s('Input.dispatchKeyEvent', { type: 'keyUp', key: a.press });
              timeline.push({ at, do: 'press', key: a.press });
              await sleep(a.wait ?? 600);
            } else if (a.scroll !== undefined) {
              const by = Number(a.scroll) || 400;
              const ms = a.ms ?? 1100;
              await evaluate(`(() => { const el = ${a.in ? findJs(a.in) : 'null'} || document.scrollingElement; const from = el.scrollTop; const t0 = performance.now(); const e = (k) => k < .5 ? 4*k*k*k : 1 - Math.pow(-2*k + 2, 3) / 2; return new Promise(r => { const f = (now) => { const k = Math.min(1, (now - t0) / ${ms}); el.scrollTop = from + ${by} * e(k); k < 1 ? requestAnimationFrame(f) : r(1); }; requestAnimationFrame(f); }); })()`);
              timeline.push({ at, do: 'scroll', by });
              await sleep(a.wait ?? 300);
            } else if (a.wait) await sleep(a.wait);
            else if (a.eval) await evaluate(a.eval);
            } catch (e) {
              // Keep filming: a missed target is reported, the rest of the flow still runs.
              emit({ step: i, action: ai, warning: e.message });
              timeline.push({ at, do: 'skipped', reason: e.message });
            }
          }
          await evaluate(`document.getElementById('__sc_cursor')?.remove()`).catch(() => {});
          await sleep(500);
        } else if (st.scroll) await evaluate(`(() => { const max = Math.max(0, document.documentElement.scrollHeight - innerHeight); const dur = ${secs * 1000} * 0.85; const t0 = performance.now(); const ease = (x) => x < .5 ? 4*x*x*x : 1 - Math.pow(-2*x + 2, 3) / 2; return new Promise(r => { const f = (now) => { const k = Math.min(1, (now - t0) / dur); scrollTo(0, max * ease(k)); k < 1 ? requestAnimationFrame(f) : r(1); }; requestAnimationFrame(f); }); })()`);
        else await sleep(secs * 1000);
        await sleep(400);
        await s('Page.stopScreencast');
        if (timeline.length) await writeFile(join(out, `${st.record}.json`), JSON.stringify({ seconds: +((Date.now() - t0) / 1000).toFixed(2), viewport: { width: view.width, height: view.height }, actions: timeline }, null, 2));
        if (frames.length < 2) throw new Error('no frames recorded');
        // Constant 30 fps: repeat each frame for its on-screen duration.
        const list = [];
        for (let k = 0; k < frames.length; k++) {
          const f = join(dir, `f${String(k).padStart(5, '0')}.jpg`);
          await writeFile(f, Buffer.from(frames[k].data, 'base64'));
          const d = k + 1 < frames.length ? Math.max(1 / 60, frames[k + 1].t - frames[k].t) : 0.5;
          list.push(`file '${f}'\nduration ${d.toFixed(4)}`);
        }
        list.push(`file '${join(dir, `f${String(frames.length - 1).padStart(5, '0')}.jpg`)}'`);
        await writeFile(join(dir, 'list.txt'), list.join('\n'));
        const file = join(out, `${st.record}.mp4`);
        await new Promise((res, rej) => {
          const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'), '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', file]);
          ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg failed'))));
        });
        await rm(dir, { recursive: true, force: true });
        emit({ step: i, file, frames: frames.length, seconds: secs });
      }
    } catch (e) {
      // Leave a screenshot of the failure so the problem is visible.
      try {
        const r = await s('Page.captureScreenshot', { format: 'png' });
        await writeFile(join(out, `error-step-${i}.png`), Buffer.from(r.data, 'base64'));
      } catch {}
      console.error(JSON.stringify({ step: i, error: e.message, at: await evaluate('location.href').catch(() => '') }));
      await stop(chrome, profile);
      process.exit(1);
    }
  }
  await stop(chrome, profile);
}

async function stop(chrome, profile) {
  await new Promise((r) => {
    chrome.once('exit', r);
    chrome.kill('SIGTERM');
    setTimeout(() => { chrome.kill('SIGKILL'); r(); }, 3000);
  });
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}

main().catch((e) => {
  console.error(JSON.stringify({ error: e.message }));
  process.exit(1);
});
