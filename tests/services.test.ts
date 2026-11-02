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

test('stills renders a document to a real-text PDF, previews and a page audit', { skip: !hasChrome && 'no Chrome' }, async () => {
  const out = join(home, 'doc');
  const job = await run('document', {
    title: 'Acme guide',
    size: 'letter',
    theme: 'editorial',
    brand: { name: 'Acme', colors: { background: '#ffffff', primary: '#3355ff' } },
    outDir: out,
    pages: [
      { layout: 'cover', fields: { kicker: 'Guide', title: 'Ship *faster*' } },
      { layout: 'toc', fields: {} },
      { layout: 'article', fields: { heading: 'Why it matters', body: '### Three habits\n- One\n- Two\n- Three' } },
      { layout: 'chart', fields: { heading: 'It adds up', chart: '{"type":"bar","data":[{"label":"A","value":3},{"label":"B","value":5}]}' } },
    ],
  });
  assert.equal(job.status, 'done', job.error);
  assert.equal(job.output.pages.length, 4);
  assert.ok(existsSync(join(out, 'document.pdf')) && existsSync(join(out, 'document.sheet.jpg')));
  const html = (await import('node:fs')).readFileSync(join(out, 'document.html'), 'utf8');
  assert.match(html, /<ul><li>One<\/li>/, 'subhead + list parses as a list');
  assert.match(html, /Why it matters<span class="lead"><\/span><span class="pn">3<\/span>/, 'contents carry real page numbers');
  assert.ok(job.output.problems.some((p: string) => /page 3 .* full/.test(p)), 'a near-empty article page is flagged');
});

test('stills renders slides to PNGs, a PDF and an editable PPTX with notes', { skip: !hasChrome && 'no Chrome' }, async () => {
  const out = join(home, 'slides');
  const job = await run('slides', {
    theme: 'dark',
    brand: { name: 'Acme', colors: { background: '#0b0d12', primary: '#3355ff' } },
    outDir: out,
    slides: [
      { layout: 'title', fields: { title: 'R&D <2026>' } },
      { layout: 'bullets', fields: { heading: 'Three points', points: ['One', 'Two', 'Three'] }, notes: 'Say why.' },
    ],
  });
  assert.equal(job.status, 'done', job.error);
  assert.ok(existsSync(join(out, 'presentation.pptx')) && existsSync(join(out, 'presentation.pdf')));
  const { execFileSync } = await import('node:child_process');
  const list = execFileSync('unzip', ['-l', join(out, 'presentation.pptx')]).toString();
  assert.match(list, /ppt\/slides\/slide2\.xml/);
  assert.match(list, /notesSlide2\.xml/);
  const xml = execFileSync('unzip', ['-p', join(out, 'presentation.pptx'), 'ppt/slides/slide1.xml']).toString();
  assert.match(xml, /R&amp;D &lt;2026&gt;/, 'title is editable text');
});

test('stills renders an ad set: every variant × size, an upload sheet, nothing overflowing', { skip: !hasChrome && 'no Chrome' }, async () => {
  const out = join(home, 'ads');
  const job = await run('ads', {
    theme: 'brand',
    brand: { name: 'Acme', colors: { background: '#ffffff', primary: '#3355ff' } },
    outDir: out,
    cta: 'Start free',
    sizes: ['meta-square', 'story', 'display-728x90', 'display-300x250', 'display-160x600'],
    variants: [{ name: 'Pain', headline: 'Still chasing *invoices* by email every Friday afternoon?', sub: 'Get paid two days sooner.', primary: 'Stop chasing.' }, { name: 'stat', headline: '2 days *faster*' }],
  });
  assert.equal(job.status, 'done', job.error);
  assert.equal(job.output.items.length, 10);
  assert.ok(existsSync(join(out, 'ads', 'pain', 'pain-display-728x90.png')));
  assert.ok(existsSync(join(out, 'pain.sheet.png')));
  const csv = (await import('node:fs')).readFileSync(join(out, 'ads.csv'), 'utf8').trim().split('\n');
  assert.equal(csv.length, 11);
  assert.match(csv[1], /"Pain",meta-square,meta,1080,1080/);
  for (const it of job.output.items) assert.deepEqual(it.audit.offCanvas, [], `${it.variant} ${it.size}`);
});
