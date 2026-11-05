import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';

process.env.SHIPCAST_HOME = mkdtempSync(join(tmpdir(), 'takes-'));
const { findChrome, recordTake, exploreProduct, productMarkdown, probe, sessionProfileDir, sessionHost, listSessions, forgetSession, runAs, DESTRUCTIVE } = await import('@shipcast/engine');

const hasChrome = !!findChrome();
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const skip = (!hasChrome && 'no Chrome') || (!hasFfmpeg && 'no ffmpeg');
const out = mkdtempSync(join(tmpdir(), 'takes-out-'));

const PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Acme Planner</title>
<style>body{font:16px system-ui;margin:0;padding:24px;background:#fff;color:#111}button,select{font:inherit;padding:10px 16px;margin:8px 0;display:block}
.tall{height:2400px;background:linear-gradient(#fafafa,#dde)}[role=dialog]{position:fixed;inset:20% 10%;background:#fff;border:2px solid #333;padding:20px}</style></head>
<body><h1>Acme Planner</h1><p>Plan your week.</p>
<button id="open">Open details</button>
<button id="copy">Copy link</button><div role="status" id="st"></div>
<label for="plan">Plan</label><select id="plan"><option value="free">Free</option><option value="pro">Pro</option><option value="team">Team</option></select>
<button id="del">Delete account</button>
<div class="tall"></div>
<h2 id="pricing">Pricing</h2><p>Pro is $9 a month.</p><div style="height:600px"></div>
<div role="dialog" aria-label="Details" id="dlg" hidden><p>Details: plans start at $9 a month.</p><button id="close">Close</button></div>
<script>
const $ = (id) => document.getElementById(id), dlg = $('dlg'), st = $('st'), plan = $('plan');
const hit = (k) => fetch('/hit?' + k);
$('open').onclick = () => { dlg.hidden = false; hit('open'); };
$('close').onclick = () => { dlg.hidden = true; };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') dlg.hidden = true; });
$('copy').onclick = () => { st.textContent = 'Link copied'; };
plan.onchange = () => hit('plan=' + plan.value);
$('del').onclick = () => hit('delete');
</script></body></html>`;

const hits: string[] = [];
let server: Server;
let base = '';

before(async () => {
  server = createServer((req, res) => {
    if (req.url!.startsWith('/hit?')) {
      hits.push(decodeURIComponent(req.url!.slice(5)));
      res.end('ok');
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(PAGE);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

after(() => {
  server?.close();
});

test('a phone take records taps, a select, a smooth scroll and marks at full device resolution', { skip, timeout: 240_000 }, async () => {
  hits.length = 0;
  const file = join(out, 'phone.mp4');
  const t0 = Date.now();
  const log = await recordTake({
    url: base,
    viewport: 'phone',
    out: file,
    pauseMs: 400,
    steps: [{ mark: 'start' }, { tap: { role: 'button', name: 'Open details' } }, { wait: 600 }, { tap: { role: 'button', name: 'Close' } }, { select: { label: 'Plan' }, value: 'Pro' }, { scrollTo: { role: 'heading', name: 'Pricing' }, ms: 900 }, { mark: 'pricing' }],
  });
  const wall = (Date.now() - t0) / 1000;
  assert.ok(existsSync(file) && statSync(file).size > 10_000);
  assert.deepEqual(JSON.parse(readFileSync(join(out, 'phone.json'), 'utf8')), log);
  const p = await probe(file);
  assert.equal(p.video!.width, 1170);
  assert.equal(p.video!.height, 2532);
  assert.equal(p.video!.fps, 30);
  assert.ok(Math.abs(p.duration - log.seconds) < 0.2, `video ${p.duration}s vs log ${log.seconds}s`);
  // The take runs at real speed: at least the scripted pauses, and no longer than the whole call.
  assert.ok(log.seconds > 0.6 + 0.9 + 4 * 0.4 + 1.6 && log.seconds < wall, `${log.seconds}s of ${wall}s`);
  assert.deepEqual(log.marks.map((m) => m.label), ['start', 'pricing']);
  assert.deepEqual(log.taps.map((t) => t.label), ['Open details', 'Close', 'Plan']);
  const ats = [log.marks[0].at, ...log.taps.map((t) => t.at), log.marks[1].at];
  assert.deepEqual([...ats].sort((a, b) => a - b), ats);
  assert.ok(ats.at(-1)! < log.seconds);
  for (const t of log.taps) assert.ok(t.x > 0.02 && t.x < 0.98 && t.y > 0.01 && t.y < 0.99, JSON.stringify(t));
  // The buttons sit near the top-left of the page; the dialog's Close button is lower down.
  assert.ok(log.taps[0].x < 0.5 && log.taps[0].y < 0.35);
  assert.ok(log.taps[1].y > log.taps[0].y);
  assert.deepEqual(hits, ['open', 'plan=pro']);
});

test('a desktop take is 2880×1800; targets resolve by text and css, and a missing one fails clearly', { skip, timeout: 180_000 }, async () => {
  hits.length = 0;
  const file = join(out, 'desk.mp4');
  const log = await recordTake({ url: base, viewport: 'desktop', out: file, pauseMs: 200, holdMs: 300, steps: [{ tap: { text: 'Open details' } }, { tap: { css: '#close' } }] });
  const p = await probe(file);
  assert.equal(p.video!.width, 2880);
  assert.equal(p.video!.height, 1800);
  assert.equal(p.video!.fps, 30);
  assert.deepEqual(log.taps.map((t) => t.label), ['Open details', 'Close']);
  assert.deepEqual(hits, ['open']);
  await assert.rejects(recordTake({ url: base, viewport: 'desktop', out: join(out, 'bad.mp4'), holdMs: 0, steps: [{ tap: { role: 'button', name: 'No such button' } }] }), /Couldn't find button "No such button"/);
});

test('exploring finds the dialog, the message and the heading, and never presses Delete account', { skip: !hasChrome && 'no Chrome', timeout: 180_000 }, async () => {
  hits.length = 0;
  const r = await exploreProduct({ url: base, viewport: 'phone' });
  const v = r.views[0];
  assert.equal(v.title, 'Acme Planner');
  assert.deepEqual(v.headings, ['Acme Planner', 'Pricing']);
  const by = (l: string) => v.controls.find((c) => c.label === l)!;
  assert.match(by('Open details').result, /opens a dialog: "Details: plans start at \$9 a month/);
  assert.match(by('Copy link').result, /shows "Link copied"/);
  assert.match(by('Plan').result, /choices: Free, Pro, Team/);
  assert.match(by('Delete account').result, /^skipped/);
  assert.ok(hits.includes('open') && !hits.includes('delete'), hits.join());
  const md = productMarkdown(r);
  assert.match(md, /## Acme Planner/);
  assert.match(md, /\*\*Open details\*\* \(button\): opens a dialog/);
  assert.match(md, /Not pressed:\n- Delete account/);
});

test('destructive names are recognised', () => {
  for (const s of ['Submit', 'Delete account', 'Send invite', 'Sign out', 'Log out', 'Cancel subscription', 'Pay now', 'Revoke key']) assert.ok(DESTRUCTIVE.test(s), s);
  for (const s of ['Open details', 'Pricing', 'Copy link', 'Cancel']) assert.ok(!DESTRUCTIVE.test(s), s);
});

test('session profiles are private to the workspace and can be forgotten', async () => {
  assert.equal(sessionHost('https://App.Example.com:8443/x?y'), 'app.example.com:8443');
  assert.throws(() => sessionHost('../etc'), /not a host/);
  const dir = await runAs({ workspace: 'wtakes0001' }, () => sessionProfileDir('app.example.com:8443'));
  assert.ok(dir.startsWith(join(process.env.SHIPCAST_HOME!, 'workspaces', 'wtakes0001', 'private')));
  if (process.platform !== 'win32') assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.deepEqual((await runAs({ workspace: 'wtakes0001' }, listSessions)).map((s) => s.host), ['app.example.com:8443']);
  assert.deepEqual(await runAs({ workspace: 'wtakes0002' }, listSessions), []);
  assert.equal(await runAs({ workspace: 'wtakes0001' }, () => forgetSession('app.example.com:8443')), true);
  assert.ok(!existsSync(dir));
});
