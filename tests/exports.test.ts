import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { exportForPlatforms, fitCaption, PLATFORMS, run, probe } = await import('@shipcast/engine');

test('captions are trimmed at a word, hashtags capped per platform', () => {
  const x = PLATFORMS.find((p) => p.id === 'x')!;
  const long = `${'Payments wait until the evidence agrees. '.repeat(12)}#trust #fiduciary #wealth`;
  const t = fitCaption(long, x);
  assert.ok(t.length <= 280 && t.endsWith('…'));
  assert.equal((fitCaption('Short post #a #b #c', x).match(/#/g) ?? []).length, 1);
});

test('a landscape video is re-framed for vertical and feed platforms with captions and a checklist', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'export-'));
  const src = join(dir, 'src');
  (await import('node:fs')).mkdirSync(src);
  const r = await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-shortest', '-pix_fmt', 'yuv420p', join(src, 'video.mp4')]);
  assert.equal(r.code, 0, r.stderr);
  writeFileSync(join(src, 'caption.md'), '# Caption\nTwo Sources disagree. Who catches it? #trust #fiduciary #wealth #law #ops #more');
  const res = await exportForPlatforms(src, join(dir, 'out'), ['tiktok', 'linkedin', 'x']);
  assert.deepEqual(res.map((x) => x.platform), ['tiktok', 'linkedin', 'x']);
  const tik = await probe(join(dir, 'out', 'tiktok', 'tiktok.mp4'));
  assert.deepEqual([tik.video?.width, tik.video?.height], [1080, 1920]);
  assert.ok(tik.audio, 'keeps the sound');
  const li = await probe(join(dir, 'out', 'linkedin', 'linkedin.mp4'));
  assert.deepEqual([li.video?.width, li.video?.height], [1080, 1350]);
  assert.match(readFileSync(join(dir, 'out', 'tiktok', 'CHECKLIST.md'), 'utf8'), /AI-generated/);
  assert.equal((readFileSync(join(dir, 'out', 'x', 'caption.txt'), 'utf8').match(/#/g) ?? []).length, 1);
  assert.ok(existsSync(join(dir, 'out', 'linkedin', 'caption.txt')));
});
