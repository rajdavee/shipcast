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

test('photo carousel renders one deck at TikTok 9:16 and Instagram 4:5, clear of the app overlays', { skip: !hasChrome && 'no Chrome' }, async () => {
  const { renderSpec, getPreset } = await import('@shipcast/engine');
  const cwd = join(home, 'photo');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(join(cwd, 'out'), { recursive: true });
  mkdirSync(join(cwd, 'brief'), { recursive: true });
  writeFileSync(join(cwd, 'brief', 'brand.json'), JSON.stringify({ name: 'Shipcast', colors: { background: '#0b0d12', primary: '#2b3bff' } }));
  const shot = join(process.cwd(), 'docs', 'assets', 'studio-new.png');
  writeFileSync(join(cwd, 'out', 'deck.json'), JSON.stringify({
    theme: 'midnight',
    handle: '@shipcast',
    slides: [
      { layout: 'cover', fields: { kicker: 'For solo founders', title: 'Launch day, *zero* content ready?', subtitle: '5 things to make before you post' } },
      { layout: 'points', fields: { title: 'Make these *first*', items: ['A hook video — 30 seconds, real UI', 'A carousel — one idea per slide', 'Social posts — every size', 'A one-pager — for the DMs'] } },
      { layout: 'step', fields: { step: 'Step 1', title: 'Paste a link', body: 'Shipcast studies your site first.', image: `${shot}#crop=0.3,0.3,0.24,0.22` } },
      { layout: 'compare', fields: { title: 'Before vs *after*', leftLabel: 'Before', left: ['Two days in Canva', 'Stock footage'], rightLabel: 'After', right: ['One paste', 'Your real UI'] } },
      { layout: 'cta', fields: { title: 'Make it in *minutes*', button: 'Link in bio' } },
    ],
  }));
  process.env.SHIPCAST_STILLS_URL = base;
  try {
    const r = await renderSpec('deck', cwd, join(cwd, 'brief'), { force: { sizes: ['tiktok-photo', 'instagram-carousel'] } });
    assert.deepEqual(r.feedback, []);
    assert.equal(r.summary, '5 slides × 2 sizes');
  } finally {
    delete process.env.SHIPCAST_STILLS_URL;
  }
  assert.ok(existsSync(join(cwd, 'out', 'tiktok-photo', 'slides', 'slide-05.png')) && existsSync(join(cwd, 'out', 'instagram-carousel', 'slides', 'slide-05.png')));
  assert.ok(!existsSync(join(cwd, 'out', 'tiktok-photo', 'carousel.pdf')), 'photo apps take images, not a PDF');
  assert.equal(getPreset('tiktok-photo')?.height, 1920);
});

test('quote, testimonial and post cards render at square, 4:5 and 1.91:1 without overflow; sample copy is labelled', { skip: !hasChrome && 'no Chrome' }, async () => {
  const out = join(home, 'quotes');
  const shot = join(process.cwd(), 'docs', 'assets', 'studio-new.png');
  const cards: [string, Record<string, unknown>][] = [
    ['pull-quote', { kicker: 'Paste a link. Get a launch.', quote: 'Shipcast makes *all of it* from one URL, on your own machine.', source: 'Shipcast README' }],
    ['testimonial', { quote: 'We went from launch-day panic to a full set of posts in an afternoon. The carousel alone saved us two days.', name: 'Sample Person', role: 'Founder', company: 'Sample Co', sample: 'yes' }],
    ['post-card', { name: 'Shipcast', handle: '@shipcast', time: '2h', avatar: 'logo', text: 'Paste a link → get a launch campaign. Videos, carousels, decks and posts — *open source*.', image: `${shot}#crop=0.3,0.3,0.14,0.12` }],
  ];
  const items = cards.flatMap(([layout, fields]) => ['instagram-post', 'linkedin-image', 'linkedin-landscape'].map((preset) => ({ type: 'card', layout, theme: 'editorial', preset, name: `${layout}-${preset}.png`, fields })));
  const job = await run('graphics', { brand: { name: 'Shipcast', colors: { background: '#0b0d12', primary: '#2b3bff' } }, outDir: out, items });
  assert.equal(job.status, 'done', job.error);
  assert.equal(job.output.items.length, 9);
  for (const it of job.output.items) {
    const where = it.file.split('/').pop();
    for (const k of ['overflow', 'offCanvas', 'unsafe', 'tinyShots', 'small']) assert.deepEqual(it.audit[k], [], `${where} ${k}`);
  }
  const fs = await import('node:fs');
  assert.match(fs.readFileSync(join(out, 'testimonial-linkedin-image.html'), 'utf8'), /data-sample>Sample copy — not a real customer/);
  assert.ok(!/data-sample>/.test(fs.readFileSync(join(out, 'pull-quote-instagram-post.html'), 'utf8')), 'real quotes carry no sample label');
});

test('app store screens: captions over real screens in a phone frame for iOS and Play, with readability checks', { skip: !hasChrome && 'no Chrome' }, async () => {
  const out = join(home, 'appstore');
  const shot = join(process.cwd(), 'docs', 'assets', 'studio-run.png');
  const { execFileSync } = await import('node:child_process');
  const wide = join(home, 'wide-desktop.png');
  let hasWide = true;
  try {
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=2880x1800', '-frames:v', '1', wide]);
  } catch {
    hasWide = false;
  }
  const screen = (preset: string, name: string, fields: Record<string, unknown>) => ({ type: 'card', layout: 'app-screen', theme: 'midnight', preset, name, fields });
  const items = [
    screen('app-store-ios', 'ios/01-launch.png', { headline: 'Paste a link. Get a *launch*.', sub: 'Videos, carousels and posts from one URL', image: `${shot}#crop=0.08,0,0.29,1` }),
    screen('app-store-ios', 'ios/02-box.png', { headline: 'One *box*', image: `${shot}#crop=0.5,0,0.29,1`, frame: 'bleed' }),
    screen('play-store', 'android/01-launch.png', { headline: 'Paste a link. Get a *launch*.', image: `${shot}#crop=0.08,0,0.29,1` }),
    screen('play-store', 'android/02-box.png', { headline: 'One *box*', image: `${shot}#crop=0.55,0,0.2,1`, frame: 'full' }),
    screen('play-store', '../../escape.png', { headline: 'Supercalifragilisticexpialidocious', image: hasWide ? wide : shot }),
    screen('play-store', 'android/missing.png', { headline: 'Gone', image: join(home, 'nope.png') }),
  ];
  const job = await run('graphics', { brand: { name: 'Shipcast', colors: { background: '#0b0d12', primary: '#2b3bff' } }, outDir: out, items });
  assert.equal(job.status, 'done', job.error);
  const [ios1, ios2, and1, and2, bad, missing] = job.output.items;
  for (const it of [ios1, ios2, and1, and2]) for (const k of ['overflow', 'offCanvas', 'unsafe', 'tinyShots', 'small', 'broken']) assert.deepEqual(it.audit[k], [], `${it.file} ${k}`);
  assert.ok(existsSync(join(out, 'ios', '01-launch.png')) && existsSync(join(out, 'android', '02-box.png')), 'one folder per store');
  assert.equal(bad.file, join(out, 'escape.png'), 'file names cannot leave the output folder');
  assert.equal(bad.audit.small.length, 1, 'a caption that shrinks past its floor is reported');
  if (hasWide) assert.equal(bad.audit.tinyShots.length, 1, 'a whole desktop page squeezed into a phone is unreadable');
  assert.equal(missing.audit.broken.length, 1);
  assert.ok(!/apple|iphone|android|google/i.test((await import('node:fs')).readFileSync(ios1.html, 'utf8').split('<body>')[1].replace(/src="[^"]*"/g, '')), 'no platform names drawn on the screen');
});

test('Product Hunt gallery and thumbnail render at 1270×760 and 240×240 without overflow', { skip: !hasChrome && 'no Chrome' }, async () => {
  const out = join(home, 'ph');
  const shot = join(process.cwd(), 'docs', 'assets', 'studio-new.png');
  const logo = join(process.cwd(), 'docs', 'assets', 'mark.svg');
  const items = [
    { type: 'card', layout: 'gallery-shot', theme: 'midnight', preset: 'producthunt-gallery', name: 'gallery/01-launch.png', fields: { kicker: 'Open source', title: 'Paste a link. Get a *launch*.', sub: 'Videos, carousels, decks and posts from one URL.', image: `${shot}#crop=0.3,0.3,0.32,0.3` } },
    { type: 'card', layout: 'gallery-points', theme: 'editorial', preset: 'producthunt-gallery', name: 'gallery/02-why.png', fields: { title: "Why it's *different*", items: ['No API keys — uses the login you have', 'Runs locally — files stay on your machine', 'Checks itself — overflow, safe zones, legibility'] } },
    { type: 'card', layout: 'launch-thumb', theme: 'editorial', preset: 'producthunt-thumb', name: 'thumbnail.png', fields: { bg: 'light' } },
  ];
  const job = await run('graphics', { brand: { name: 'Shipcast', logo, colors: { background: '#0b0d12', primary: '#2b3bff' } }, outDir: out, items });
  assert.equal(job.status, 'done', job.error);
  for (const it of job.output.items) for (const k of ['overflow', 'offCanvas', 'unsafe', 'tinyShots', 'small', 'broken']) assert.deepEqual(it.audit[k], [], `${it.file} ${k}`);
  const nomono = await run('graphics', { brand: { name: 'Shipcast', colors: { background: '#0b0d12', primary: '#2b3bff' } }, outDir: out, items: [{ ...items[2], name: 'mono.png', fields: { bg: 'brand' } }] });
  assert.deepEqual(nomono.output.items[0].audit.offCanvas, []);
  assert.match((await import('node:fs')).readFileSync(join(out, 'mono.html'), 'utf8'), />S<\/span>/, 'no logo → a monogram, never someone else\'s mark');
  assert.ok(existsSync(join(out, 'gallery', '02-why.png')) && existsSync(join(out, 'thumbnail.png')));
});

const shipcast = { name: 'Shipcast', logo: join(process.cwd(), 'docs', 'assets', 'mark.svg'), colors: { background: '#0b0d12', primary: '#2b3bff' } };
const clean = (it: any) => {
  for (const k of ['overflow', 'offCanvas', 'unsafe', 'tinyShots', 'small', 'broken']) assert.deepEqual(it.audit[k], [], `${it.file.split('/').pop()} ${k}`);
};

test('profile kit: one banner design fits every platform safe area, the avatar stays inside its circle', { skip: !hasChrome && 'no Chrome' }, async () => {
  const out = join(home, 'profile');
  const shot = join(process.cwd(), 'docs', 'assets', 'studio-new.png');
  const fields = { title: 'Paste a link. Get a *launch*.', sub: 'Videos, carousels, decks and posts from one URL — on your machine.', url: 'github.com/rajdavee/shipcast', motif: 'grid' };
  const { PROFILE_KIT_PRESETS } = await import('@shipcast/engine');
  const items = PROFILE_KIT_PRESETS.map((preset: string) => ({ type: 'card', layout: preset === 'profile-avatar' ? 'profile-avatar' : 'profile-banner', theme: 'midnight', preset, name: `profile/${preset}.png`, fields: preset === 'og-card' ? { ...fields, image: `${shot}#crop=0.4,0.2,0.08,0.1` } : preset === 'profile-avatar' ? {} : fields }));
  items.push({ type: 'card', layout: 'profile-avatar', theme: 'swiss', preset: 'profile-avatar', name: 'profile/mono.png', fields: { bg: 'brand' } as any });
  const job = await run('graphics', { brand: shipcast, outDir: out, items: items.slice(0, -1) });
  assert.equal(job.status, 'done', job.error);
  assert.equal(job.output.items.length, 8);
  job.output.items.forEach(clean);
  const mono = await run('graphics', { brand: { ...shipcast, logo: undefined }, outDir: out, items: items.slice(-1) });
  clean(mono.output.items[0]);
  // Swapping themes changes the colours, never the safe placement.
  for (const theme of ['editorial', 'bold']) (await run('graphics', { brand: shipcast, outDir: join(out, theme), items: items.slice(0, 5).map((i) => ({ ...i, theme })) })).output.items.forEach(clean);
});

test('safe-area audit flags content outside the YouTube strip, under a profile photo and outside an avatar circle', { skip: !hasChrome && 'no Chrome' }, async () => {
  const logo = join(process.cwd(), 'docs', 'assets', 'mark.svg');
  const page = (body: string) => `<html><body style="margin:0;position:relative;font:40px sans-serif">${body}</body></html>`;
  const check = async (name: string, preset: string, body: string) => {
    const f = join(home, `${name}.html`);
    writeFileSync(f, page(body));
    const job = await run('html', { file: f, out: join(home, `${name}.png`), preset });
    assert.equal(job.status, 'done', job.error);
    return job.output.audit.unsafe as string[];
  };
  const yt = await check('yt', 'youtube-banner', `<h1 style="position:absolute;left:1000px;top:640px;margin:0">Centred</h1><img src="${logo}" style="position:absolute;left:80px;top:80px;width:120px">`);
  assert.equal(yt.length, 1, yt.join(' | '));
  assert.match(yt[0], /^image mark\.svg — outside the safe area/);
  assert.match((await check('yt2', 'youtube-banner', '<h1 style="position:absolute;left:1000px;top:120px;margin:0">Cropped on phones</h1>'))[0] ?? '', /Cropped on phones/);
  const li = await check('li', 'linkedin-banner', '<p style="position:absolute;left:60px;top:300px;margin:0">Under the photo</p><p style="position:absolute;left:60px;top:40px;margin:0">Top-left is fine</p>');
  assert.deepEqual(li.map((x) => x.split(' — ')[1]), ['under the profile photo']);
  const av = await check('av', 'profile-avatar', '<p style="position:absolute;left:12px;top:12px;margin:0">AB</p><p style="position:absolute;left:170px;top:170px;margin:0">OK</p>');
  assert.deepEqual(av.map((x) => x.split(' — ')[1]), ['outside the round crop']);
  assert.deepEqual(await check('av2', 'profile-avatar', `<img src="${logo}" style="position:absolute;left:84px;top:84px;width:232px;height:232px;object-fit:contain">`), [], 'a mark 0.58 × the side fits the circle');
  assert.equal((await check('av3', 'profile-avatar', `<img src="${logo}" style="position:absolute;left:0;top:0;width:400px;height:400px">`)).length, 1, 'a full-bleed square mark loses its corners');
});

test('stills audit catches text that overflows', { skip: !hasChrome && 'no Chrome' }, async () => {
  const f = join(home, 'bad.html');
  writeFileSync(f, '<html><body style="margin:0"><div style="width:200px;overflow:hidden;white-space:nowrap;font-size:40px">This headline is far too long for its box</div></body></html>');
  const job = await run('html', { file: f, out: join(home, 'bad.png'), width: 600, height: 400 });
  assert.equal(job.status, 'done', job.error);
  assert.equal(job.output.audit.overflow.length, 1);
  writeFileSync(f, '<html><body style="margin:0"><h1 data-min-font="80" style="font-size:40px">Shrunk</h1><p data-min-font="20" style="font-size:30px">Fine</p></body></html>');
  const small = await run('html', { file: f, out: join(home, 'small.png'), width: 600, height: 400 });
  assert.deepEqual(small.output.audit.small, ['h1 "Shrunk" 40px'], 'text pushed below its floor is reported');
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
  assert.ok(!/srgbClr val="010101"/.test(execFileSync('unzip', ['-p', join(out, 'presentation.pptx'), 'ppt/slides/slide2.xml']).toString()), 'color-mix() text keeps its colour, not near-black');
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

test('stills renders inbox-safe email: HTML, text, zip, previews and deliverability checks', { skip: !hasChrome && 'no Chrome' }, async () => {
  const out = join(home, 'email');
  const job = await run('email', {
    theme: 'light',
    brand: { name: 'Acme', colors: { background: '#ffffff', primary: '#3355ff' } },
    outDir: out,
    emails: [{ name: 'Launch Day', subjects: ['Invoices, paid two days sooner'], preheader: 'Short.', blocks: [{ type: 'hero', headline: 'Get paid *sooner*', body: 'One link.\n\n- Fast\n- Simple', cta: 'Start free', url: 'https://acme.test' }, { type: 'cta', headline: 'Try it', cta: 'Click here', url: 'https://acme.test' }] }],
  });
  assert.equal(job.status, 'done', job.error);
  const fs = await import('node:fs');
  const html = fs.readFileSync(join(out, 'emails', 'launch-day', 'launch-day.html'), 'utf8');
  assert.match(html, /role="presentation"/);
  assert.match(html, /v:roundrect/, 'Outlook-safe button');
  assert.ok(!/<link[^>]+stylesheet/.test(html), 'no external CSS');
  assert.match(fs.readFileSync(join(out, 'emails', 'launch-day', 'launch-day.txt'), 'utf8'), /Start free: https:\/\/acme\.test/);
  assert.ok(existsSync(join(out, 'launch-day.zip')) && existsSync(join(out, 'launch-day-mobile.png')));
  const p = job.output.problems.join(' | ');
  assert.match(p, /preheader/);
  assert.match(p, /spam-trigger/);
  assert.match(p, /postal address/);
});

test('stills renders a landing page: page, snippets, copy deck, previews, no sideways scroll', { skip: !hasChrome && 'no Chrome' }, async () => {
  const out = join(home, 'landing');
  const job = await run('landing', {
    title: 'Acme — invoices paid sooner',
    theme: 'light',
    brand: { name: 'Acme', colors: { background: '#ffffff', primary: '#3355ff' } },
    outDir: out,
    sections: [
      { type: 'hero', headline: 'Get paid *sooner*', sub: 'Invoices that chase themselves.', cta: 'Start free', url: 'https://acme.test' },
      { type: 'features', heading: 'Why teams switch', items: ['clock | Faster | Two days sooner.', 'shield-check | Safer | Bank-grade.', 'smile | Simpler | No setup.'] },
      { type: 'faq', items: ['Is there a free plan? | Yes, forever.'] },
      { type: 'cta', heading: 'Try it', cta: 'Start free', url: 'https://acme.test' },
    ],
  });
  assert.equal(job.status, 'done', job.error);
  assert.deepEqual(job.output.problems, []);
  const fs = await import('node:fs');
  assert.match(fs.readFileSync(join(out, 'landing', 'index.html'), 'utf8'), /<details><summary>Is there a free plan\?/);
  assert.ok(existsSync(join(out, 'landing', 'sections', '02-features.html')) && existsSync(join(out, 'landing.zip')) && existsSync(join(out, 'landing-mobile.png')));
});

test('stills renders print pieces with bleed and crop marks at print resolution', { skip: !hasChrome && 'no Chrome' }, async () => {
  const out = join(home, 'print');
  const job = await run('print', {
    brand: { name: 'Acme', colors: { background: '#ffffff', primary: '#3355ff' } },
    outDir: out,
    pieces: [{ name: 'Flyer', size: 'a5-flyer', theme: 'light', layout: 'event', fields: { title: 'Meet us', date: '12 Nov', place: 'Berlin', cta: 'Book', url: 'acme.test' } }],
  });
  assert.equal(job.status, 'done', job.error);
  assert.deepEqual(job.output.problems, []);
  const p = job.output.pieces[0];
  assert.equal(p.dpi, 300);
  assert.ok(existsSync(p.pdf) && existsSync(p.png));
  const html = (await import('node:fs')).readFileSync(p.pdf.replace(/\.pdf$/, '.html'), 'utf8');
  assert.match(html, /trim 148 × 210 mm · bleed 3 mm/);
});
