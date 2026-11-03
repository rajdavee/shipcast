import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Audiograms: a storyboard scene whose meter is measured from the real audio, so renders are seek-safe.
const home = mkdtempSync(join(tmpdir(), 'shipcast-audiogram-'));
process.env.SHIPCAST_HOME = home;
const { findChrome, browser, getPreset, layoutAuditScript, loadPacks, validatePack, PLUGIN_DIR, PACK_CHANNEL, previews } = await import('@shipcast/engine');
const { compileStoryboard, validateStoryboard } = await import('@shipcast/render');
const { audioLevels } = await import('../services/render/src/audiogram.ts');

const hasChrome = !!findChrome();
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
after(async () => {
  await browser().close();
  if (!process.env.KEEP) rmSync(home, { recursive: true, force: true });
});

/** 1 s of tone, 1 s of silence, 1 s of louder tone. */
function speechLike(file: string) {
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=1', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono:d=1', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=1', '-filter_complex', '[0:a]aresample=48000,volume=0.25[a];[1:a]aresample=48000[b];[2:a]aresample=48000,volume=0.9[c];[a][b][c]concat=n=3:v=0:a=1', '-ac', '1', file]);
  assert.equal(r.status, 0, String(r.stderr));
  return file;
}

test('the audiogram pack loads, validates and points at its skill', async () => {
  const p = (await loadPacks(true)).find((x) => x.id === 'audiogram');
  assert.ok(p);
  assert.deepEqual(validatePack(p!, 'audiogram'), []);
  assert.equal(p!.spec, 'storyboard');
  const skill = p!.prompt.match(/shipcast:([\w-]+)/)?.[1];
  assert.ok(skill && existsSync(join(PLUGIN_DIR, 'skills', skill, 'SKILL.md')));
  assert.ok(PACK_CHANNEL.audiogram);
});

test('an audiogram needs a voiceover line or an audio file, and stays under 90 seconds', () => {
  const sc = (x: object) => ({ scene: 'audiogram', fields: { name: 'Maya Chen' }, ...x });
  assert.match(validateStoryboard({ preset: 'vertical', scenes: [sc({})] } as any).join(' '), /needs a "vo" line .* or an "audio" file/);
  assert.match(validateStoryboard({ preset: 'vertical', scenes: [sc({ vo: 'Hello there.' })] } as any).join(' '), /needs a "vo" line/, 'a vo line without a voice is silent');
  assert.deepEqual(validateStoryboard({ preset: 'vertical', voice: { voice: 'af_heart' }, scenes: [sc({ vo: 'Hello there.' })] } as any), []);
  assert.deepEqual(validateStoryboard({ preset: 'square-video', voice: null, scenes: [sc({ fields: { name: 'Maya', audio: 'assets/ep.mp3' } })] } as any), []);
  assert.match(validateStoryboard({ preset: 'vertical', voice: { voice: 'af_heart' }, scenes: [sc({ vo: 'word '.repeat(261) })] } as any).join(' '), /past 90 seconds/);
});

test('levels follow the real loudness, frame by frame, and are deterministic', { skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  const wav = speechLike(join(home, 'speech.wav'));
  const a = await audioLevels(wav, join(home, 'a.raw'));
  const b = await audioLevels(wav, join(home, 'b.raw'));
  assert.deepEqual(a, b);
  assert.ok(Math.abs(a.length - 90) <= 1, `30 levels a second (${a.length})`);
  const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
  const [quiet, silent, loud] = [mean(a.slice(5, 25)), mean(a.slice(50, 58)), mean(a.slice(65, 85))];
  assert.ok(loud > quiet && quiet > silent, `loud ${loud} > quiet ${quiet} > silent ${silent}`);
  assert.ok(silent < 0.05 && loud > 0.9);
});

test('the critic finds every size of a multi-size video', async () => {
  const d = mkdtempSync(join(tmpdir(), 'pv-'));
  mkdirSync(join(d, 'out', 'square-video'), { recursive: true });
  for (const f of ['video.sheet.jpg', 'video.jpg', 'square-video/video.sheet.jpg']) writeFileSync(join(d, 'out', f), 'x');
  assert.deepEqual((await previews(d)).map((f) => f.split('/out/')[1]), ['video.sheet.jpg', 'square-video/video.sheet.jpg', 'video.jpg']);
  rmSync(d, { recursive: true, force: true });
});

for (const preset of ['vertical', 'square-video']) {
  test(`the audiogram scene compiles at ${preset}: real levels, nothing overflowing or under the captions, seek-safe meter`, { skip: (!hasFfmpeg && 'no ffmpeg') || (!hasChrome && 'no Chrome') }, async () => {
    const dir = join(home, preset);
    mkdirSync(join(dir, 'brief'), { recursive: true });
    const deps = {
      voice: async (_t: string, _v: string, _s: number, out: string) => ({ file: speechLike(out), duration: 3, words: 'Every launch I shipped had the product ready and the marketing late.'.split(' ').map((text, i) => ({ text, start: i * 0.25, end: i * 0.25 + 0.2 })) }),
      music: async () => ({ file: '', bpm: 100 }),
      mix: async (voice: string | null) => ({ file: voice! }),
    };
    const story = {
      preset,
      voice: { voice: 'af_heart' },
      music: null,
      scenes: [{ scene: 'audiogram', vo: 'Every launch I shipped had the product ready and the marketing late.', fields: { name: 'Maya Chen', title: 'Founder, Shipcast', headline: 'Why the launch kit *is* the product', kicker: 'Founder notes', cover: join(process.cwd(), 'docs', 'assets', 'studio-new.png') } }],
    };
    const brand = { name: 'Shipcast', colors: { background: '#0b0d12', primary: '#2b3bff' }, fonts: { display: 'system-ui', body: 'system-ui', mono: 'ui-monospace' } };
    const c = await compileStoryboard(story as any, { dir: join(dir, 'project'), brand: brand as any, deps });
    assert.ok(c.words.length && existsSync(join(dir, 'project', 'compositions', 'captions.html')), 'karaoke captions are burned in');
    const comp = readFileSync(join(dir, 'project', 'compositions', `${c.scenes[0].id}.html`), 'utf8');
    const L = JSON.parse(comp.match(/const L=(\[[^\]]*\])/)![1]);
    assert.ok(L.length >= 90 && Math.max(...L) > 0.9 && L.slice(0, 9).every((v: number) => v === 0), 'the level track is the voice, shifted by its lead-in');

    // Lay the settled scene out in Chrome (no animation library: a stub timeline records the tweens).
    const p = getPreset(preset)!;
    const style = readFileSync(join(dir, 'project', 'index.html'), 'utf8').match(/<style>([\s\S]*?)<\/style>/)![1];
    const tpl = comp.match(/<template>([\s\S]*)<\/template>/)![1];
    const stub = `<script>window.__timelines={};const tw=[];window.gsap={timeline:()=>{const t={fromTo:(o,a,b,at)=>{tw.push({o,b});return t},to:()=>t,set:()=>t};return t}};window.__seek=(x)=>{for(const w of tw)if(w.b.onUpdate){w.o.t=Math.min(x,w.b.t);w.b.onUpdate()}return [...document.querySelectorAll('.bars i')].map((i)=>i.style.transform).join(',')};</script>`;
    const page = join(dir, 'project', 'scene.html');
    writeFileSync(page, `<!doctype html><html><head><meta charset="utf-8"><style>${style}</style>${stub}</head><body><div id="main" style="width:${p.width}px;height:${p.height}px">${tpl}</div></body></html>`);
    const { pathToFileURL } = await import('node:url');
    const pg = await browser().open(pathToFileURL(page).href, { width: p.width, height: p.height, settleMs: 200 });
    try {
      const band = preset === 'vertical' ? Math.max(p.safe.bottom, 560) + 250 : Math.round(p.height * 0.08) + 170;
      const audit = await pg.eval<any>(layoutAuditScript({ ...p.safe, bottom: Math.max(p.safe.bottom, band - 2) }, p.width, p.height));
      assert.deepEqual(audit.overflow, []);
      assert.deepEqual(audit.offCanvas, []);
      assert.deepEqual(audit.unsafe, [], 'scene text stays clear of the platform UI and the caption band');
      assert.ok(audit.minFont >= 28, `smallest scene text ${audit.minFont}px`);
      const at2 = await pg.eval<string>('__seek(2.0)');
      await pg.eval('__seek(0.4)');
      assert.equal(await pg.eval<string>('__seek(2.0)'), at2, 'the same time draws the same meter, whatever was drawn before');
      assert.notEqual(await pg.eval<string>('__seek(1.8)'), await pg.eval<string>('__seek(3.0)'), 'the meter moves with the audio');
    } finally {
      await pg.close();
    }
  });
}
