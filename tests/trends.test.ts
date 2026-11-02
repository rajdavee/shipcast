import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SHIPCAST_HOME = mkdtempSync(join(tmpdir(), 'trends-'));
const { parseTrendsRss, fromReddit, fromHN, cleanCard, mergeCards, rankCards, refreshTrends, readTrends, trendsPrompt } = await import('@shipcast/engine');

const RSS = `<?xml version="1.0"?><rss><channel><item><title>ai agents</title><ht:approx_traffic>50,000+</ht:approx_traffic><pubDate>Mon, 2 Nov 2026 08:00:00 -0800</pubDate></item><item><title><![CDATA[world series]]></title><ht:approx_traffic>2M+</ht:approx_traffic></item></channel></rss>`;
const REDDIT = `<feed><entry><title>Carousels doubled our reach</title><link href="https://www.reddit.com/r/marketing/comments/abc/x/" /><updated>2026-11-01T10:00:00+00:00</updated></entry><entry><title>offsite</title><link href="https://evil.example/x" /></entry></feed>`;
const HN = { hits: [{ title: 'Show HN: launch kit', objectID: '42', points: 230, created_at: '2026-11-01T10:00:00Z' }] };

const fakeFetch = (async (url: string) => {
  const body = url.includes('trends.google') ? RSS : url.includes('reddit') ? REDDIT : url.includes('algolia') ? JSON.stringify(HN) : '{}';
  return new Response(body, { status: 200 });
}) as typeof fetch;

test('sources parse into signals with links and numbers; off-site links are dropped', async () => {
  const g = parseTrendsRss(RSS, 'US');
  assert.equal(g.length, 2);
  assert.equal(g[0].metric, 50000);
  assert.equal(g[1].title, 'world series');
  assert.match(g[0].url, /^https:\/\/trends\.google\.com\/trends\/explore\?q=ai%20agents&geo=US$/);
  const r = await fromReddit(fakeFetch, ['marketing'], 0);
  assert.equal(r.length, 1);
  assert.equal(r[0].url, 'https://www.reddit.com/r/marketing/comments/abc/x/');
  assert.equal(r[0].metricLabel, '#1 this week');
  const h = await fromHN(fakeFetch, new Date('2026-11-03'), ['launch']);
  assert.equal(h[0].url, 'https://news.ycombinator.com/item?id=42');
});

const packs = new Set(['carousel', 'reel', 'social-post']);
const card = (over: object = {}) => ({ key: 'pdf-carousels', kind: 'format', platform: 'LinkedIn', title: 'PDF carousels lead LinkedIn', what: 'Document posts get the most engagement.', strength: 'rising', evidence: [{ url: 'https://buffer.com/resources/data', metric: '6.6% engagement', date: '2026-10-01' }], recipe: { pack: 'carousel', angle: 'a', hookPattern: 'h', structure: ['s1'] }, ...over });

test('cards without https evidence are dropped; unknown packs fall back to a social post', () => {
  assert.equal(cleanCard(card({ evidence: [] }), packs), null);
  assert.equal(cleanCard(card({ evidence: [{ url: 'javascript:alert(1)' }] }), packs), null);
  assert.equal(cleanCard(card({ recipe: { pack: 'nope' } }), packs)?.recipe.pack, 'social-post');
  assert.equal(cleanCard(card(), packs)?.platform, 'linkedin');
});

test('merging: seen again gains confidence, unseen three times is archived, rising cools first', () => {
  const t = (d: number) => new Date(Date.UTC(2026, 10, d));
  let cards = mergeCards([], [cleanCard(card(), packs), cleanCard(card({ key: 'faceless', title: 'Faceless reels' }), packs)], t(1));
  cards = mergeCards(cards, [cleanCard(card({ evidence: [{ url: 'https://socialinsider.io/x' }] }), packs)], t(2));
  const pdf = cards.find((c) => c.key === 'pdf-carousels')!;
  assert.equal(pdf.seen, 2);
  assert.equal(pdf.evidence.length, 2, 'evidence accumulates');
  assert.equal(pdf.firstSeen, t(1).toISOString());
  cards = mergeCards(cards, [cleanCard(card(), packs)], t(3));
  assert.equal(cards.find((c) => c.key === 'faceless')!.strength, 'steady');
  cards = mergeCards(cards, [cleanCard(card(), packs)], t(4));
  assert.equal(cards.find((c) => c.key === 'faceless')!.archived, true);
  assert.equal(rankCards(cards)[0].key, 'pdf-carousels');
});

test('a refresh collects, asks once, saves; yielding saves nothing and spends no run', async () => {
  let asked = '';
  const ask = async (p: string) => ((asked = p), JSON.stringify([card(), card({ key: 'bad', evidence: [] })]));
  const y = await refreshTrends({ now: new Date('2026-11-03'), fetch: fakeFetch, ask, shouldYield: async () => true });
  assert.equal(y.claudeRuns, 0);
  assert.equal(asked, '');
  const r = await refreshTrends({ now: new Date('2026-11-03'), fetch: fakeFetch, ask });
  assert.equal(r.claudeRuns, 1);
  assert.equal(r.fresh, 1);
  assert.match(asked, /Carousels doubled our reach/);
  assert.match(asked, /\[google-trends US\] ai agents/);
  const feed = await readTrends();
  assert.equal(feed.cards.length, 1);
  assert.ok(feed.refreshedAt);
  await assert.rejects(refreshTrends({ fetch: fakeFetch, ask: async () => 'sorry, no' }), /no usable cards/);
  assert.match(trendsPrompt([], [], [{ id: 'carousel', name: 'Carousel' }], new Date('2026-11-03')), /carousel \(Carousel\)/);
});
