import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio, ensureContrast, normalizeBrand, brandCss, PRESETS, getPreset, VERTICAL_SAFE, shortsFromStoryboard, patternSimilarity, varietyFeedback } from '@shipcast/engine';
import { makeMusic, MOODS, toWav, addSfx } from '@shipcast/media';
import { CAPTION_STYLES, SCENES, echoesVoice, validateInfographic, validateStoryboard } from '@shipcast/render';

test('brand tokens always meet contrast on their ground', () => {
  for (const [primary, bg] of [['#6965db', '#121212'], ['#ffd400', '#ffffff'], ['#1a1a1a', '#0b0d12'], ['#2b3bff', '#eceff3']]) {
    assert.ok(contrastRatio(ensureContrast(primary, bg), bg) >= 4.5, `${primary} on ${bg}`);
  }
  const b = normalizeBrand({ colors: { background: '#ffffff', text: '#fefefe', primary: '#ff0000' } as any });
  assert.ok(contrastRatio(b.colors.text, b.colors.background) >= 4.5, 'unreadable text colour is replaced');
  assert.match(brandCss(b), /--accent-on-dark:#[0-9a-f]{6}/);
});

test('presets are internally consistent', () => {
  const ids = new Set();
  for (const p of PRESETS) {
    assert.ok(!ids.has(p.id), p.id);
    ids.add(p.id);
    assert.ok(p.safe.left + p.safe.right < p.width && p.safe.top + p.safe.bottom < p.height, `${p.id} safe zone leaves room`);
    if (p.kind === 'video') assert.deepEqual(p.loudness, { lufs: -14, truePeak: -1 });
  }
  // The unified vertical mask covers every platform's own mask.
  for (const id of ['reels', 'tiktok', 'shorts']) {
    const p = getPreset(id)!;
    for (const k of ['top', 'right', 'bottom'] as const) assert.ok(VERTICAL_SAFE[k] >= p.safe[k] - 5, `${id}.${k}`);
  }
});

test('music is deterministic, the requested length, and not silent', () => {
  const a = makeMusic({ mood: 'tech', seconds: 6, seed: 3 });
  const b = makeMusic({ mood: 'tech', seconds: 6, seed: 3 });
  assert.equal(a.left.length, Math.ceil(6 * 44100));
  assert.deepEqual(a.left.slice(80000, 80100), b.left.slice(80000, 80100));
  assert.equal(a.bpm, MOODS.tech.bpm);
  let peak = 0;
  for (const v of a.left) peak = Math.max(peak, Math.abs(v));
  assert.ok(peak > 0.1 && peak <= 1);
  addSfx(a, 'whoosh', 2);
  const wav = toWav(a);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.length, 44 + a.left.length * 4);
});

test('every scene declares fields the director can fill', () => {
  for (const s of SCENES) {
    assert.ok(s.use.length > 20, s.id);
    assert.ok(s.minSeconds >= 1.5, s.id);
    assert.ok(s.fields.some((f) => !f.optional) || s.id === 'logo-sting', `${s.id} has a required field`);
  }
  assert.ok(Object.keys(CAPTION_STYLES).includes('bold'));
});

test('copy check catches clichés and platform limits', async () => {
  const { checkCopy } = await import('@shipcast/engine');
  const problems = checkCopy({
    linkedin: [{ label: 'Launch', text: 'We are excited to announce our seamless new tool. ' + 'x'.repeat(220) + '\n\nMore.' }],
    youtube: [{ label: 'Title A', text: 'A'.repeat(80) }],
    x: [{ label: 'Standalone 1', text: 'y'.repeat(300) }],
  });
  assert.ok(problems.some((p) => p.includes('excited to announce')));
  assert.ok(problems.some((p) => p.includes('seamless')));
  assert.ok(problems.some((p) => p.includes('210')));
  assert.ok(problems.some((p) => p.includes('title')));
  assert.ok(problems.some((p) => p.includes('280')));
  assert.deepEqual(checkCopy({ linkedin: [{ label: 'ok', text: 'Short, specific hook.\n\nBody.' }] }), []);
});

test('preset lookup never crosses kinds', async () => {
  const { presetForSize } = await import('@shipcast/engine');
  assert.equal(presetForSize(1280, 720, 'video'), undefined);
  assert.equal(presetForSize(1280, 720, 'image')?.id, 'youtube-thumbnail');
  assert.equal(presetForSize(1080, 1920, 'video')?.id, 'vertical');
});

test('infographic specs are validated before rendering', () => {
  const columns = [{ label: 'Stage', kind: 'stage' }, { label: 'Think', kind: 'note' }, { label: 'Go', kind: 'chips' }] as const;
  const row = (s: string) => [s, '“Is there a better way?”', ['Google', 'Reddit']];
  const ok = { title: 'Where buyers go *before they buy*', columns: [...columns], rows: [row('Aware'), row('Consider'), row('Decide')] };
  assert.deepEqual(validateInfographic(ok as any), []);
  assert.ok(validateInfographic({ ...ok, rows: [row('Only one')] } as any).some((e) => /rows/.test(e)));
  assert.ok(validateInfographic({ ...ok, rows: [...ok.rows, ['Short row', 'x']] } as any).length > 0, 'cell count must match columns');
});

test('long-form storyboards validate per chapter', () => {
  const title = (t: string) => ({ scene: 'title', fields: { title: t } });
  const ok = { preset: 'youtube', chapters: [{ title: 'Cold open', card: false, scenes: [title('Hook')] }, { title: 'Part two', scenes: [title('Two')] }] };
  assert.deepEqual(validateStoryboard(ok as any), []);
  assert.ok(validateStoryboard({ ...ok, chapters: [ok.chapters[0]] } as any).some((e) => /2–16/.test(e)), 'needs at least two chapters');
  assert.ok(validateStoryboard({ ...ok, chapters: [...ok.chapters, { title: 'Bad', scenes: [{ scene: 'title', fields: {} }] }] } as any).some((e) => /chapter 3/.test(e)));
  assert.ok(SCENES.some((s) => s.id === 'chapter'), 'chapter card scene exists');
});

test('shorts pick the strongest chapters and stay short', () => {
  const sc = (scene: string, vo = 'eight words of narration for this one scene here') => ({ scene, fields: { title: 'x' }, vo });
  const board = {
    title: 'Five jobs',
    preset: 'youtube',
    chapters: [
      { title: 'Cold open', card: false, scenes: [sc('kinetic'), sc('statement')] },
      { title: 'Calm part', scenes: [sc('features'), sc('features')] },
      { title: 'The peak', scenes: Array.from({ length: 20 }, () => sc('stat')) },
      { title: 'Wrap', scenes: [sc('statement'), sc('outro')] },
    ],
  };
  const shorts = shortsFromStoryboard(board, 2);
  assert.equal(shorts.length, 2);
  assert.deepEqual(shorts.map((s) => s.title), ['Five jobs — Cold open', 'Five jobs — The peak']);
  for (const s of shorts) {
    assert.equal(s.preset, 'vertical');
    assert.equal(s.scenes!.at(-1)!.scene, 'outro', 'every short ends on the outro');
    assert.ok(s.scenes!.length < 15, 'trimmed to about 45 s');
  }
});

test('variety guard flags near-copies and lets fresh structures through', () => {
  const a = ['kinetic', 'statement', 'product', 'product', 'stat', 'outro'];
  assert.ok(patternSimilarity(a, a) > 0.9);
  assert.equal(varietyFeedback(a, [{ label: 'x', pattern: ['cinema', 'terminal', 'chart', 'logos', 'quote', 'outro'] }]).length, 0);
  const fb = varietyFeedback(a, [{ label: 'uv · reel', pattern: [...a] }]);
  assert.equal(fb.length, 1);
  assert.match(fb[0], /uv · reel/);
});

test('music follows the energy curve of the edit', () => {
  const t = makeMusic({ mood: 'tech', seconds: 12, seed: 3, energy: [{ at: 0, level: 0.25 }, { at: 6, level: 1 }] });
  const rms = (a: Float32Array, s: number, e: number) => {
    let sum = 0;
    for (let i = Math.floor(s * 44100); i < Math.floor(e * 44100); i++) sum += a[i] * a[i];
    return Math.sqrt(sum / ((e - s) * 44100));
  };
  const calm = rms(t.left, 2.5, 5.5);
  const big = rms(t.left, 7.5, 9.5);
  assert.ok(big > calm * 1.3, `full section (${big.toFixed(3)}) should be clearly louder than the calm one (${calm.toFixed(3)})`);
});

test('captions step aside when the scene already shows what the voice says', () => {
  const w = (s: string) => s.split(' ').map((text) => ({ text }));
  assert.equal(echoesVoice({ headline: 'Shipped it. Now who makes the launch video?' }, w('Shipped it. Now who makes the launch video?')), true);
  assert.equal(echoesVoice({ headline: 'Eight tools.' }, w('You need eight different tools to launch one product properly')), false);
  assert.equal(echoesVoice({ image: 'shots/x.png', zoom: 1.3 }, w('Paste one link into Shipcast today')), false);
});

test('the critic only asks for a fix on low, fixable criteria', async () => {
  const { criticWeakest, criticSummary } = await import('@shipcast/engine');
  const v = (s: Record<string, number>) => ({ scores: { realism: 3, fidelity: 4, brand: 4, hook: 4, layout: 4, legibility: 4, artefacts: 4, ...s } as any, notes: '', fix: '' });
  assert.equal(criticWeakest(v({})), null);
  assert.equal(criticWeakest(v({ realism: 1 })), null, 'realism needs generated imagery, not a rewrite');
  assert.deepEqual(criticWeakest(v({ legibility: 2, layout: 1 })), { crit: 'layout', score: 1 });
  assert.match(criticSummary(v({ legibility: 2 })), /lowest legibility 2/);
});

test('contact sheets can sample each scene at its settled moment, and frame detail tells content from a flat frame', async () => {
  const { contactSheet, frameDetail, run } = await import('@shipcast/engine');
  const { mkdtempSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const d = mkdtempSync(join(tmpdir(), 'sheet-'));
  const v = join(d, 'v.mp4');
  // 2 s flat blue, then 2 s of test pattern.
  const r = await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x2233cc:s=320x240:d=2', '-f', 'lavfi', '-i', 'testsrc=s=320x240:d=2', '-filter_complex', '[0][1]concat=n=2:v=1', '-pix_fmt', 'yuv420p', v]);
  if (r.code !== 0) return; // no ffmpeg here
  const flat = await frameDetail(v, 1);
  const busy = await frameDetail(v, 3);
  assert.ok(flat !== null && busy !== null && flat < 0.6 && busy > 2, `flat ${flat}, busy ${busy}`);
  const out = await contactSheet(v, join(d, 's.jpg'), { at: [1, 3] });
  assert.ok(existsSync(out));
});
