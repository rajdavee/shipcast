import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

// Real capability services on random ports, in an isolated data dir.
const home = mkdtempSync(join(tmpdir(), 'shipcast-svc-'));
process.env.SHIPCAST_HOME = home;
const { findChrome, alignScript, buildCues, checkCaptions, validateStoryboard } = await Promise.all([
  import('@shipcast/engine'),
  import('@shipcast/media'),
  import('@shipcast/qa'),
  import('@shipcast/render'),
]).then(([e, m, q, r]) => ({ ...e, ...m, ...q, ...r }));
const { createStillsService } = await import('@shipcast/stills');
const { browser } = await import('@shipcast/engine');

const hasChrome = !!findChrome();
let stills: ReturnType<typeof createStillsService> | null = null;
let base = '';

before(async () => {
  if (!hasChrome) return;
  stills = createStillsService();
  await stills.listen(0);
  base = `http://127.0.0.1:${(stills.server.address() as AddressInfo).port}`;
});
after(async () => {
  await stills?.close();
  await browser().close();
  rmSync(home, { recursive: true, force: true });
});

const run = async (kind: string, input: unknown) => (await fetch(`${base}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, input }) })).json();

test('script alignment keeps script spelling and fills gaps', () => {
  const asr = [
    { text: 'ship', start: 0.1, end: 0.3 },
    { text: 'cast', start: 0.3, end: 0.5 },
    { text: 'turns', start: 0.6, end: 0.8 },
    { text: 'repos', start: 1.0, end: 1.3 },
  ];
  const w = alignScript('Shipcast turns your repo into videos.', asr);
  assert.deepEqual(w.map((x) => x.text), ['Shipcast', 'turns', 'your', 'repo', 'into', 'videos.']);
  assert.equal(w[1].start, 0.6);
  for (let i = 1; i < w.length; i++) assert.ok(w[i].start >= w[i - 1].start);
});

test('caption cues respect chunk size and minimum display time', () => {
  const words = 'One two three four five six. Seven'.split(' ').map((t, i) => ({ text: t, start: i * 0.2, end: i * 0.2 + 0.15 }));
  const cues = buildCues(words, { maxWords: 3 });
  assert.ok(cues.every((c) => c.text.split(' ').length <= 3));
  // Each cue holds for the readable minimum, unless the next cue needs the screen first.
  cues.forEach((c, i) => assert.ok(c.end >= Math.min(c.start + 0.69, cues[i + 1]?.start ?? Infinity), `cue ${i}`));
  const r = checkCaptions('1\n00:00:00,000 --> 00:00:00,300\nThis cue is far too long to read in a third of a second\n');
  assert.ok(r.issues.some((i) => i.rule === 'captions.speed'));
});

test('storyboard validation names the broken scene and field', () => {
  const errs = validateStoryboard({ preset: 'vertical', scenes: [{ scene: 'title', fields: {} }, { scene: 'nope' }] } as any);
  assert.ok(errs.some((e) => e.includes('scene 1') && e.includes('title')));
  assert.ok(errs.some((e) => e.includes('scene 2')));
  assert.deepEqual(validateStoryboard({ preset: 'vertical', scenes: [{ scene: 'title', fields: { title: 'Hi' } }] }), []);
});

test('stills renders a carousel deck to PNGs + PDF with layout audits', { skip: !hasChrome && 'no Chrome' }, async () => {
  const out = join(home, 'deck');
  const job = await run('deck', {
    theme: 'swiss',
    brand: { name: 'Acme', colors: { background: '#ffffff', primary: '#3355ff' } },
    outDir: out,
    slides: [
      { layout: 'cover', fields: { title: 'A *specific* promise' } },
      { layout: 'points', fields: { title: 'Three things', items: ['One — detail', 'Two', 'Three'] } },
      { layout: 'cta', fields: { title: 'Try it', button: 'Start' } },
    ],
  });
  assert.equal(job.status, 'done', job.error);
  assert.equal(job.output.slides.length, 3);
  assert.ok(existsSync(join(out, 'slides', 'slide-01.png')));
  assert.ok(existsSync(join(out, 'carousel.pdf')));
  assert.deepEqual(job.output.slides[0].audit.overflow, []);
});

test('stills audit catches text that overflows', { skip: !hasChrome && 'no Chrome' }, async () => {
  const f = join(home, 'bad.html');
  writeFileSync(f, '<html><body style="margin:0"><div style="width:200px;overflow:hidden;white-space:nowrap;font-size:40px">This headline is far too long for its box</div></body></html>');
  const job = await run('html', { file: f, out: join(home, 'bad.png'), width: 600, height: 400 });
  assert.equal(job.status, 'done', job.error);
  assert.equal(job.output.audit.overflow.length, 1);
});
