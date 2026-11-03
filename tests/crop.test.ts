import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapCrop } from '@shipcast/stills';

// A 400×200 page (grey 20) with a panel (grey 40, border 90) at x 40–360, y 40–160, text-like stripes inside.
function page() {
  const W = 400;
  const H = 200;
  const g = new Uint8Array(W * H).fill(20);
  for (let y = 40; y <= 160; y++) for (let x = 40; x <= 360; x++) g[y * W + x] = x === 40 || x === 360 || y === 40 || y === 160 ? 90 : 40;
  for (let y = 70; y < 80; y++) for (let x = 60; x < 300; x++) if (x % 3 === 0) g[y * W + x] = 230;
  return { g, W, H };
}
const px = (b: { x: number; w: number }, W: number) => [Math.round(b.x * W), Math.round((b.x + b.w) * W)];

test('a crop that stops inside a panel grows to take in the whole panel', () => {
  const { g, W, H } = page();
  const b = snapCrop(g, W, H, { x: 30 / W, y: 30 / H, w: 220 / W, h: 140 / H });
  const [x0, x1] = px(b, W);
  assert.ok(x0 <= 40 && x1 > 360, `got ${x0}–${x1}`);
});

test('a crop already sitting on the page background is left alone', () => {
  const { g, W, H } = page();
  const box = { x: 30 / W, y: 30 / H, w: 340 / W, h: 140 / H };
  assert.deepEqual(snapCrop(g, W, H, box), box);
});

test('a crop that cuts through a line of text moves only to the nearest gap', () => {
  const { g, W, H } = page();
  const b = snapCrop(g, W, H, { x: 30 / W, y: 60 / H, w: 150 / W, h: 15 / H });
  const [, x1] = px(b, W);
  assert.ok(x1 > 180 && x1 <= 330, `right edge ${x1} should clear the text, not jump far`);
});

test('a crop wholly inside a panel is a deliberate zoom and stays put', () => {
  const { g, W, H } = page();
  const box = { x: 120 / W, y: 90 / H, w: 100 / W, h: 50 / H };
  assert.deepEqual(snapCrop(g, W, H, box), box);
});

test('crops of marketing graphics are exempt from the UI-text rule; screenshot crops are not', async () => {
  const { layoutAuditScript } = await import('@shipcast/engine');
  const s = layoutAuditScript({ top: 0, right: 0, bottom: 0, left: 0 }, 1080, 1080, 0.022, ['carousel.jpg']);
  assert.match(s, /"carousel\.jpg"/);
  assert.match(s, /-img\\\\?\.png\$/);
});
