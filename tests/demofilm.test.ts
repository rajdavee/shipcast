import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Demo films: real takes in a phone rig or desktop window, callouts from tap logs, phrase-led captions.
const home = mkdtempSync(join(tmpdir(), 'shipcast-film-'));
process.env.SHIPCAST_HOME = home;
const { findChrome } = await import('@shipcast/engine');
const { buildFilm, validateFilmSpec, logoHasOpaqueCorners } = await import('../services/render/src/demofilm.ts');
type FilmSpec = import('../services/render/src/demofilm.ts').FilmSpec;

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const hf = () => spawnSync('npx', ['--no-install', 'hyperframes', '--version'], { encoding: 'utf8', timeout: 60_000 }).status === 0;
after(() => {
  if (!process.env.KEEP) rmSync(home, { recursive: true, force: true });
});

const ff = (...args: string[]) => {
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
};
const fx = join(home, 'fixtures');
const phone = join(fx, 'phone.mp4');
const desk = join(fx, 'desk.mp4');
const card = join(fx, 'card.png');
const boxLogo = join(fx, 'logo-box.png');
const cleanLogo = join(fx, 'logo-clean.png');

before(() => {
  if (!hasFfmpeg) return;
  mkdirSync(fx, { recursive: true });
  ff('-f', 'lavfi', '-i', 'testsrc=size=1170x2532:rate=30:duration=6', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', phone);
  writeFileSync(`${phone}.json`, JSON.stringify({ viewport: 'phone', taps: [{ label: 'Pick a plan', at: 1.2, x: 0.5, y: 0.42 }, { label: 'Confirm', at: 3.1, x: 0.5, y: 0.82 }], marks: [{ label: 'start', at: 0.5 }] }));
  ff('-f', 'lavfi', '-i', 'testsrc=size=2880x1800:rate=30:duration=6', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', desk);
  writeFileSync(`${desk}.json`, JSON.stringify({ viewport: 'desktop', taps: [{ label: 'Approve', at: 2, x: 0.7, y: 0.3 }], marks: [] }));
  ff('-f', 'lavfi', '-i', 'testsrc=size=800x1000', '-frames:v', '1', card);
  ff('-f', 'lavfi', '-i', 'color=c=red:s=240x80', '-frames:v', '1', boxLogo);
  ff('-f', 'lavfi', '-i', 'color=c=black@0.0:s=240x80,format=rgba,drawbox=x=40:y=20:w=160:h=40:color=red@1:t=fill', '-frames:v', '1', cleanLogo);
});

/** Stub deps: silent voice at 0.4 s a word, a silent bed, a "mix" that hands back the voice. */
function stubDeps() {
  const calls: { music: any[] } = { music: [] };
  const silent = (out: string, d: number) => ff('-f', 'lavfi', '-i', `anullsrc=r=48000:cl=mono:d=${d.toFixed(3)}`, out);
  return {
    calls,
    deps: {
      voice: async (text: string, _v: string, _s: number, out: string) => {
        const ws = text.split(/\s+/).filter(Boolean);
        const words = ws.map((w, i) => ({ text: w, start: +(i * 0.4).toFixed(3), end: +(i * 0.4 + 0.32).toFixed(3) }));
        const duration = ws.length * 0.4;
        silent(out, duration);
        return { file: out, duration, words };
      },
      music: async (mood: any, seconds: number, sfx: any[], out: string, energy?: any[], opts?: any) => {
        calls.music.push({ mood, seconds, sfx, energy, opts });
        silent(out, seconds);
        return { file: out };
      },
      mix: async (voice: string | null, music: string | null) => ({ file: (voice ?? music)! }),
    },
  };
}

const brand = (logo?: string): FilmSpec['brand'] => ({ name: 'Acme Plans', fonts: { display: 'system-ui', body: 'system-ui' }, colors: { bg: '#0b0d12', ink: '#f4f5f7', accent: '#3b82f6', highlight: '#facc15' }, logo, url: 'acme.test' });

const fullSpec = (format: 'vertical' | 'landscape', logo?: string): FilmSpec => ({
  format,
  brand: brand(logo),
  voice: { voice: 'af_heart', pace: 155, pause: 0.3 },
  music: { mood: 'uplifting', bpm: 96, seed: 7 },
  target: 15,
  scenes: [
    { id: 'open', kind: 'title', vo: 'Meet Acme Plans.', head: 'Plans in a minute' },
    { id: 'pick', kind: 'ui', take: { file: phone, log: `${phone}.json`, fromMark: 'start' }, kick: 'Step 1', head: 'Pick a plan', vo: 'Pick a plan, then confirm.', callouts: 'taps', zoom: [[0, 1, 0.5, 0.4], [0.4, 1.2, 0.5, 0.45]] },
    { id: 'ops', kind: 'ui', take: { file: desk, log: `${desk}.json`, from: 0.2 }, head: 'The team takes over', vo: 'We draft, review, and ship it.', pipeline: ['Draft', 'Review', 'Ship'], callouts: [{ text: 'Approve', at: 1.6 }] },
    { id: 'result', kind: 'ui', take: { file: phone, log: `${phone}.json`, from: 1 }, head: 'For the family', dive: true, vo: 'When it is ready the family finds it waiting in their collection, with a note from the team and every detail checked twice.' },
    { id: 'card', kind: 'card', image: card, vo: 'A keepsake that lasts.', head: 'Made to keep' },
    { id: 'cta', kind: 'cta', vo: 'Try Acme Plans today.', head: 'Plan your next one', sub: 'Free to start.' },
  ],
});

/** Ancestors (by id and attributes) of every element, from a tiny tag-stack parse of the generated page. */
function tree(html: string) {
  const body = html.slice(html.indexOf('<body>'), html.indexOf('<script>(()=>'));
  const stack: { tag: string; attrs: string }[] = [];
  const els: { tag: string; attrs: string; ancestors: { tag: string; attrs: string }[] }[] = [];
  const VOID = new Set(['img', 'br', 'meta', 'input', 'source', 'path']);
  for (const m of body.matchAll(/<(\/?)([a-z][\w-]*)([^>]*?)(\/?)>/gi)) {
    const [, close, tag, attrs, self] = m;
    if (close) {
      const k = stack.map((s) => s.tag).lastIndexOf(tag);
      if (k >= 0) stack.length = k;
      continue;
    }
    els.push({ tag, attrs, ancestors: [...stack] });
    if (!self && !VOID.has(tag.toLowerCase())) stack.push({ tag, attrs });
  }
  return els;
}
const idOf = (attrs: string) => attrs.match(/\bid="([^"]+)"/)?.[1];

test('validateFilmSpec names the scene and field of every problem', () => {
  const bad = validateFilmSpec({
    format: 'square' as any,
    brand: { name: '', fonts: { display: 'Inter', body: 'x;}' }, colors: { bg: 'url(x)', ink: '#fff', accent: '#00f' } },
    music: { mood: 'sad' },
    scenes: [
      { id: 'open', kind: 'title' },
      { id: 'pick', kind: 'ui', zoom: [[0.5, 4, 0.5, 0.5]] as any },
      { id: 'pick', kind: 'movie' as any },
      { id: 'tap', kind: 'ui', take: { file: '/nope/take.mp4' }, callouts: 'taps' },
      { id: 'card', kind: 'card', image: 'relative.png', dive: false },
      { id: 'go', kind: 'ui', take: { file: '/nope/take.mp4' }, dive: true },
    ],
  } as FilmSpec).join('\n');
  for (const re of [
    /format must be/,
    /brand\.name is required/,
    /brand\.fonts\.body must be a font family/,
    /brand\.colors\.bg must be a CSS colour/,
    /music\.mood must be one of/,
    /scene 2 "pick" \(ui\): take is required/,
    /scene 2 "pick" \(ui\): zoom\[0\] scale must be 1–3/,
    /scene 2 "pick" \(ui\): zoom needs a take/,
    /scene 3 "pick" \(movie\): id is used twice/,
    /scene 3 "pick" \(movie\): kind must be one of/,
    /scene 4 "tap" \(ui\): take\.file not found/,
    /scene 4 "tap" \(ui\): callouts "taps" needs take\.log/,
    /scene 5 "card" \(card\): image must be an absolute path/,
    /scene 6 "go" \(ui\): dive pushes into the next scene, which must be a card/,
  ])
    assert.match(bad, re);
  assert.deepEqual(validateFilmSpec({ format: 'vertical', brand: brand(), scenes: [{ id: 'a', kind: 'title', head: 'Hi' }] }), []);
});

test('logo check: an opaque box is caught, a transparent logo is not', { skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  assert.equal(await logoHasOpaqueCorners(boxLogo, fx), true);
  assert.equal(await logoHasOpaqueCorners(cleanLogo, fx), false);
});

for (const format of ['vertical', 'landscape'] as const) {
  test(`${format}: one timeline, a phone rig, ${format === 'landscape' ? 'a desktop window' : 'no desktop window'}, untimed video parents, phrase captions, honest totals and warnings`, { skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
    const dir = join(home, `film-${format}`);
    const { deps, calls } = stubDeps();
    const r = await buildFilm(fullSpec(format, boxLogo), dir, deps);
    const html = readFileSync(join(dir, 'index.html'), 'utf8');

    // One composition, one paused timeline, registered as main.
    assert.equal(html.match(/data-composition-id=/g)?.length, 1);
    assert.match(html, /<div id="root" data-composition-id="main"/);
    assert.equal(html.match(/gsap\.timeline\(/g)?.length, 1);
    assert.match(html, /window\.__timelines\["main"\]=tl/);
    assert.doesNotMatch(html, /<br/i);
    assert.doesNotMatch(html, /letterSpacing/);
    assert.equal(r.width, format === 'vertical' ? 1080 : 1920);

    const els = tree(html);
    const find = (id: string) => els.find((e) => idOf(e.attrs) === id);
    const under = (id: string, anc: string) => !!find(id)?.ancestors.some((a) => idOf(a.attrs) === anc);
    assert.ok(under('v-pick', 'rig') && under('v-result', 'rig'), 'phone takes play in the rig');
    if (format === 'landscape') {
      assert.ok(under('v-ops', 'win'), 'the desktop take plays in a window');
      assert.ok(!find('pane'));
    } else {
      assert.ok(!find('win'), 'no desktop window in 9:16');
      assert.ok(under('v-ops', 'pane'));
    }
    // Videos are never inside a timed wrapper, and each starts at its take point.
    const videos = els.filter((e) => e.tag === 'video');
    assert.equal(videos.length, 3);
    for (const v of videos) {
      assert.ok(!v.ancestors.some((a) => /data-start=/.test(a.attrs) && !/data-composition-id=/.test(a.attrs)), `${idOf(v.attrs)} is not inside a timed element`);
      assert.match(v.attrs, /data-media-start="[\d.]+"/);
    }
    assert.match(find('v-pick')!.attrs, /data-media-start="0.5"/, 'fromMark resolves through the log');
    // The screen has no backing colour that could linger once the rig leaves.
    assert.doesNotMatch(find('screen')!.attrs, /background/);
    // Elements GSAP moves never carry a CSS transform of their own.
    const css = html.match(/<style>([\s\S]*?)<\/style>/)![1];
    for (const sel of ['#rig', '.zoom', '.glint', '.sweep', '.cw', '.co', '.cap', '.head', '.side'])
      for (const rule of css.matchAll(new RegExp(`(^|[},\\s])${sel.replace('.', '\\.')}\\{([^}]*)\\}`, 'g'))) assert.doesNotMatch(rule[2], /(^|;)transform:/, `${sel} has no CSS transform`);

    // Callouts from the take log sit outside the device; ticks land on the taps.
    assert.ok(find('co-pick-0') && find('co-pick-1'), 'one callout per logged tap');
    assert.ok(!under('co-pick-0', 'rig'));
    assert.ok(find('tp-pick-0'), 'tap ripple');
    const sfx = calls.music[0].sfx;
    const pick = r.scenes.find((s) => s.id === 'pick')!;
    assert.ok(sfx.some((s: any) => s.kind === 'tick' && Math.abs(s.at - (pick.start + 1.2 - 0.5)) < 0.01), 'a tick on the first tap');
    assert.ok(sfx.some((s: any) => s.kind === 'impact') && sfx.some((s: any) => s.kind === 'riser') && sfx.some((s: any) => s.kind === 'whoosh'));
    assert.deepEqual(calls.music[0].opts, { bpm: 96, seed: 7 });
    assert.ok(calls.music[0].energy.some((e: any) => e.level === 1), 'the card is the energy peak');
    // Pipeline nodes and the dive.
    assert.match(html, /class="pn n2"/);
    assert.match(html, /scale:2\.6/);
    assert.match(html, /class="cbg"/, 'the card lands full-screen after the dive');

    // Plan totals add up, scene after scene.
    const plan = JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf8'));
    let t = 0;
    for (const s of plan.scenes) {
      assert.ok(Math.abs(s.start - t) < 0.002, `${s.id} starts where the previous ends`);
      t += s.duration;
    }
    assert.ok(Math.abs(t - plan.total) < 0.01 && plan.total === r.total);
    assert.match(html, new RegExp(`data-duration="${r.total}"`));

    // Captions: phrase cues — a comma only ever ends a cue, and no cue crosses a cut.
    const srt = readFileSync(r.srt!, 'utf8');
    const cues = srt.trim().split(/\n\n/).map((b) => {
      const [, times, text] = b.split('\n');
      const [a, z] = times.split(' --> ').map((x) => {
        const [h, m, s] = x.replace(',', '.').split(':').map(Number);
        return h * 3600 + m * 60 + s;
      });
      return { a, z, text };
    });
    assert.ok(cues.some((c) => c.text === 'We draft,'), cues.map((c) => c.text).join(' | '));
    for (const c of cues) {
      assert.doesNotMatch(c.text.slice(0, -1), /,/, `"${c.text}" breaks at its comma`);
      assert.ok(r.scenes.some((s) => c.a >= s.start && c.z <= s.start + s.duration + 0.001), `"${c.text}" stays inside one scene`);
    }
    assert.match(html, /class="clip cap capd"/);
    assert.match(html, /\{color:"#facc15"\}/, 'the spoken word lights up in the highlight colour');

    // Warnings: voice past its footage, a missed target, a boxed logo.
    assert.ok(r.warnings.some((w) => /scene "result": the voice needs [\d.]+ s but the take has 5\.0 s of footage/.test(w)), r.warnings.join('\n'));
    assert.ok(r.warnings.some((w) => new RegExp(`^15 s cut came out ${r.total.toFixed(1)} s$`).test(w)));
    assert.ok(r.warnings.some((w) => /brand\.logo: the corners .* are opaque/.test(w)));
    if (format === 'vertical') assert.ok(r.warnings.some((w) => /desktop take in a 9:16 film/.test(w)));

    // HyperFrames' own lint, when it's installed.
    if (hf()) {
      const l = spawnSync('npx', ['--no-install', 'hyperframes', 'lint', '.', '--json'], { cwd: dir, encoding: 'utf8', timeout: 120_000 });
      const j = JSON.parse(l.stdout.slice(l.stdout.indexOf('{')));
      const errors = (j.findings ?? []).filter((f: any) => f.severity === 'error');
      assert.deepEqual(errors, [], JSON.stringify(errors, null, 1));
    }
  });
}

test('a clean logo and an on-target cut raise no warnings', { skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  const { deps } = stubDeps();
  const r = await buildFilm(
    { format: 'vertical', brand: brand(cleanLogo), voice: { voice: 'af_heart' }, music: null, target: 8, scenes: [{ id: 'open', kind: 'title', head: 'Hello', min: 3 }, { id: 'pick', kind: 'ui', take: { file: phone, log: `${phone}.json` }, vo: 'Pick a plan.', min: 5 }] },
    join(home, 'film-clean'),
    deps,
  );
  assert.equal(r.total, 8.2);
  assert.deepEqual(r.warnings, []);
});

const renderable = hasFfmpeg && !!findChrome() && hf();
test('a four-scene vertical film renders (draft) to a 1080×1920 video of the planned length', { skip: !renderable && 'needs ffmpeg, Chrome and hyperframes' }, async () => {
  const dir = join(home, 'film-render');
  const { deps } = stubDeps();
  const r = await buildFilm(
    {
      format: 'vertical',
      brand: brand(cleanLogo),
      voice: { voice: 'af_heart' },
      music: { mood: 'uplifting' },
      scenes: [
        { id: 'open', kind: 'title', head: 'Plans in a minute', min: 2 },
        { id: 'pick', kind: 'ui', take: { file: phone, log: `${phone}.json` }, head: 'Pick a plan', vo: 'Pick a plan, then confirm.', callouts: 'taps', dive: true },
        { id: 'card', kind: 'card', image: card, head: 'Made to keep', min: 2.5 },
        { id: 'cta', kind: 'cta', head: 'Plan your next one', min: 2 },
      ],
    },
    dir,
    deps,
  );
  const out = join(dir, 'draft.mp4');
  const rr = spawnSync('npx', ['--no-install', 'hyperframes', 'render', '.', '-o', out, '--quality', 'draft', '--fps', '30', '--quiet'], { cwd: dir, encoding: 'utf8', timeout: 600_000 });
  assert.equal(rr.status, 0, (rr.stderr || rr.stdout).slice(-800));
  assert.ok(existsSync(out));
  const p = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', out], { encoding: 'utf8' }).stdout);
  const v = p.streams.find((s: any) => s.codec_type === 'video');
  assert.equal(v.width, 1080);
  assert.equal(v.height, 1920);
  assert.ok(Math.abs(Number(p.format.duration) - r.total) < 0.3, `${p.format.duration} vs ${r.total}`);
});
