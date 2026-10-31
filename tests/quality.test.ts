import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio, ensureContrast, normalizeBrand, brandCss, PRESETS, getPreset, VERTICAL_SAFE } from '@shipcast/engine';
import { makeMusic, MOODS, toWav, addSfx } from '@shipcast/media';
import { CAPTION_STYLES, SCENES } from '@shipcast/render';

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
