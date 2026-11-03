import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

const home = mkdtempSync(join(tmpdir(), 'collectors-'));
process.env.SHIPCAST_HOME = home;
process.env.SHIPCAST_NOTIFY = 'off';
process.env.SHIPCAST_SKILLHUB = 'off';

// Tests never reach the network: only this machine's test server may be fetched for real.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const u = new URL(input instanceof Request ? input.url : String(input));
  if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') throw new Error(`network call in a test: ${u.host}`);
  return realFetch(input, init);
}) as typeof fetch;

const E = await import('@shipcast/engine');
const { createApp } = await import('@shipcast/api');
const { setSecret, savePost, listPosts, deletePost, writeSettings, setPublishFetch, connections, addSnapshot, readSnapshots, PublishError } = E;
const { videoIdOf, readYoutube, readPostiz, mapPostizAnalytics, PostizBusy, postizTokens, postizNextSlot, readPostizQueue, POSTIZ_PER_HOUR, runMetrics, pendingNumbers, collectNow, readMetricsFromImage, validateReading, setScreenshotAsk } = E;
type Post = import('@shipcast/engine').Post;
type PostChannel = import('@shipcast/engine').PostChannel;

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}
type Route = (c: Call) => Response | Promise<Response>;
let calls: Call[] = [];
let routes: [RegExp, Route][] = [];
const jsonRes = (v: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json', ...headers } });
async function fake(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input);
  const h: Record<string, string> = {};
  new Headers(init.headers).forEach((v, k) => (h[k] = v));
  const b = init.body as unknown;
  const call = { url, method: init.method ?? 'GET', headers: h, body: typeof b === 'string' ? b : b instanceof URLSearchParams ? b.toString() : '' };
  calls.push(call);
  const hit = routes.find(([re]) => re.test(`${call.method} ${url}`));
  return hit ? hit[1](call) : new Response('no route', { status: 404 });
}
setPublishFetch(fake as typeof fetch);
const use = (...r: [RegExp, Route][]) => ((routes = r), (calls = []));

const YT_ACCESS = 'ya29.yt-access-TOKEN-0123456789';
const YT_NEW = 'ya29.yt-fresh-TOKEN-9876543210';
const YT_REFRESH = '1//yt-refresh-TOKEN-0123456789';
const CLIENT_SECRET = 'client-SECRET-0123456789';
const POSTIZ_KEY = 'postiz-KEY-0123456789';
const SECRETS = [YT_ACCESS, YT_NEW, YT_REFRESH, CLIENT_SECRET, POSTIZ_KEY];
const POSTIZ = 'http://postiz.test:5000';
const SCOPES = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly';
const VID = 'dQw4w9WgXcQ';
const future = () => new Date(Date.now() + 86400_000).toISOString();

const T0 = Date.parse('2026-11-02T09:00:00.000Z');
const at = (h: number) => new Date(T0 + h * 3_600_000);

async function youtubeConnected(scope: string | null = SCOPES, expired = false) {
  await setSecret('publish.youtube.client', JSON.stringify({ id: 'yt-client.apps.googleusercontent.com', secret: CLIENT_SECRET }));
  await setSecret('publish.youtube.token', JSON.stringify({ access: YT_ACCESS, refresh: YT_REFRESH, expiresAt: expired ? new Date(Date.now() - 1000).toISOString() : future(), ...(scope ? { scope } : {}) }));
}
const postizConnected = () => setSecret('publish.postiz', JSON.stringify({ url: POSTIZ, key: POSTIZ_KEY }));

const sentCh = (over: Partial<PostChannel>): PostChannel => ({ channel: 'linkedin', caption: 'x', hashtags: [], media: [], via: 'manual', state: 'sent', sentAt: at(0).toISOString(), ...over }) as PostChannel;
const published = (title: string, channels: Partial<PostChannel>[], over: Partial<Post> = {}) => savePost({ title, status: 'published', at: at(0).toISOString(), tz: 'UTC', format: 'carousel', channels: channels.map(sentCh), ...over });

let base = '';
const app = createApp({ serveWeb: false });
before(async () => {
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  base = `http://localhost:${(app.address() as AddressInfo).port}`;
});
after(() => {
  app.close();
  setPublishFetch(null);
  setScreenshotAsk(null);
  globalThis.fetch = realFetch;
  rmSync(home, { recursive: true, force: true });
});
beforeEach(async () => {
  for (const p of await listPosts()) await deletePost(p.id);
  rmSync(join(home, 'metrics'), { recursive: true, force: true });
  // No quiet hours unless a test sets them.
  await writeSettings({ metricsPaused: false, agentsQuietStart: '00:00', agentsQuietEnd: '00:00' });
  await youtubeConnected();
  await postizConnected();
  use();
});

const seen: string[] = [];
const api = async (path: string, init: RequestInit & { json?: unknown } = {}) => {
  const res = await fetch(base + path, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) }, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
  const text = await res.text();
  seen.push(text);
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {}
  return { status: res.status, body, text };
};

const ytRoutes = (): [RegExp, Route][] => [
  [/^POST https:\/\/oauth2\.googleapis\.com\/token$/, () => jsonRes({ access_token: YT_NEW, expires_in: 3599, scope: SCOPES })],
  [/^GET https:\/\/www\.googleapis\.com\/youtube\/v3\/videos\?/, () => jsonRes({ items: [{ id: VID, statistics: { viewCount: '1520', likeCount: '87', favoriteCount: '0', commentCount: '12' } }] })],
  [/^GET https:\/\/youtubeanalytics\.googleapis\.com\/v2\/reports\?/, () => jsonRes({ columnHeaders: [{ name: 'averageViewPercentage' }, { name: 'subscribersGained' }], rows: [[41.37, 6]] })],
];

test('video ids come from the stored id or any YouTube link', () => {
  assert.equal(videoIdOf({ remoteId: VID }), VID);
  assert.equal(videoIdOf({ url: `https://youtu.be/${VID}` }), VID);
  assert.equal(videoIdOf({ url: `https://www.youtube.com/watch?feature=share&v=${VID}` }), VID);
  assert.equal(videoIdOf({ url: `https://youtube.com/shorts/${VID}?si=x` }), VID);
  assert.equal(videoIdOf({ remoteId: 'postiz-123', url: 'https://example.com' }), undefined);
});

test('YouTube: stats and analytics map onto snapshot fields, after refreshing an expired token', async () => {
  await youtubeConnected(SCOPES, true);
  use(...ytRoutes());
  const v = await readYoutube({ remoteId: VID }, at(0).toISOString(), at(30));
  assert.deepEqual(v, { views: 1520, likes: 87, comments: 12, avgViewPct: 41.37, follows: 6 });
  assert.equal(calls[0].url, 'https://oauth2.googleapis.com/token');
  assert.equal(new URLSearchParams(calls[0].body).get('grant_type'), 'refresh_token');
  const stats = new URL(calls[1].url);
  assert.equal(stats.searchParams.get('part'), 'statistics');
  assert.equal(stats.searchParams.get('id'), VID);
  assert.equal(calls[1].headers.authorization, `Bearer ${YT_NEW}`);
  const rep = new URL(calls[2].url);
  assert.equal(rep.searchParams.get('ids'), 'channel==MINE');
  assert.equal(rep.searchParams.get('filters'), `video==${VID}`);
  assert.equal(rep.searchParams.get('startDate'), '2026-11-02');
  assert.equal(rep.searchParams.get('endDate'), '2026-11-03');
  assert.match(rep.searchParams.get('metrics')!, /averageViewPercentage/);
  // The refreshed grant keeps its scopes, so stats stay readable.
  assert.equal((await connections()).youtube.stats.needsReconnect, false);

  // Analytics failing (or lagging) leaves the public counts standing.
  use(ytRoutes()[1], [/youtubeanalytics/, () => jsonRes({ error: { message: 'quota' } }, 403)]);
  assert.deepEqual(await readYoutube({ url: `https://youtu.be/${VID}` }, at(0).toISOString(), at(30)), { views: 1520, likes: 87, comments: 12 });
  // A deleted video is a permanent failure.
  use([/videos\?/, () => jsonRes({ items: [] })]);
  await assert.rejects(readYoutube({ remoteId: VID }, at(0).toISOString(), at(30)), (e: InstanceType<typeof PublishError>) => e.permanent && /no such video/.test(e.message));
});

test('YouTube: a connection made before stats were added needs a reconnect, and only reads what its scopes allow', async () => {
  await youtubeConnected(null);
  const c = (await connections()).youtube;
  assert.equal(c.connected, true, 'uploads still work');
  assert.deepEqual(c.stats, { stats: false, analytics: false, needsReconnect: true });
  assert.equal((await api('/api/publish/connections')).body.youtube.stats.needsReconnect, true);
  use(...ytRoutes());
  await assert.rejects(readYoutube({ remoteId: VID }, at(0).toISOString(), at(30)), /Reconnect YouTube/);
  assert.equal(calls.filter((x) => /googleapis\.com\/youtube/.test(x.url)).length, 0);

  // Without a collector the scheduler asks for the numbers instead.
  await published('Old grant video', [{ channel: 'youtube', via: 'direct', remoteId: VID }]);
  const r = await runMetrics({ now: () => at(25), notify: async () => {} });
  assert.equal(r.collected.length, 0);
  assert.equal(r.nudged.length, 1);

  // Read scope but no analytics: stats only, no reports call.
  await youtubeConnected('https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly');
  assert.deepEqual((await connections()).youtube.stats, { stats: true, analytics: false, needsReconnect: false });
  use(...ytRoutes());
  assert.deepEqual(await readYoutube({ remoteId: VID }, at(0).toISOString(), at(30)), { views: 1520, likes: 87, comments: 12 });
  assert.equal(calls.some((x) => /youtubeanalytics/.test(x.url)), false);
});

test('Postiz: analytics labels map onto snapshot fields; not-yet-published and rate limits are told apart', async () => {
  assert.deepEqual(
    mapPostizAnalytics([
      { label: 'Likes', data: [{ total: '150', date: '2026-11-03' }], percentageChange: 0 },
      { label: 'Comments', data: [{ total: '25', date: '2026-11-03' }] },
      { label: 'Reposts', data: [{ total: '4', date: '2026-11-03' }] },
      { label: 'Impressions', data: [{ total: '1,000', date: '2026-11-02' }, { total: '200', date: '2026-11-03' }] },
      { label: 'Unique Impressions', data: [{ total: 800, date: '2026-11-03' }] },
      { label: 'Saves', data: [{ total: '9', date: '2026-11-03' }] },
      { label: 'Engagement', data: [{ total: '188', date: '2026-11-03' }] },
      { label: 'Mystery', data: [{ total: '5', date: '2026-11-03' }] },
      { label: 'Views', data: [] },
    ]),
    { likes: 150, comments: 25, shares: 4, impressions: 1200, reach: 800, saves: 9 },
  );
  assert.deepEqual(mapPostizAnalytics({ missing: true }), {});

  use([/^GET http:\/\/postiz\.test:5000\/api\/public\/v1\/analytics\/post\/pz-1\?date=3$/, () => jsonRes([{ label: 'Likes', data: [{ total: '7', date: '2026-11-04' }] }])]);
  assert.deepEqual(await readPostiz('pz-1', at(0).toISOString(), at(40)), { likes: 7 });
  assert.equal(calls[0].headers.authorization, POSTIZ_KEY);
  use([/analytics/, () => jsonRes({ missing: true })]);
  await assert.rejects(readPostiz('pz-1', at(0).toISOString(), at(40)), (e: InstanceType<typeof PublishError>) => !e.permanent && /not published/.test(e.message));
  use([/analytics/, () => jsonRes({ message: 'slow down' }, 429, { 'retry-after': '120' })]);
  await assert.rejects(readPostiz('pz-1', at(0).toISOString(), at(40)), (e: InstanceType<typeof PostizBusy>) => e instanceof PostizBusy && e.until === at(40).getTime() + 120_000);
});

test('Postiz queue: 25 reads an hour, the 26th waits for the oldest to age out, oldest first', async () => {
  const empty = { reads: [], items: [] };
  assert.equal(postizTokens(empty, at(0)), POSTIZ_PER_HOUR);
  const full = { reads: Array.from({ length: 25 }, (_, i) => at(i / 60).toISOString()), items: [] };
  assert.equal(postizTokens(full, at(0.5)), 0);
  assert.equal(postizNextSlot(full, at(0.5)).getTime(), at(1).getTime());
  assert.equal(postizTokens(full, at(1.01)), 1);

  const posts = [];
  for (let i = 0; i < 26; i++) posts.push(await published(`Postiz ${i}`, [{ channel: 'instagram', via: 'postiz', remoteId: `pz-${i}` }]));
  for (const p of posts) await collectNow(p, at(2));
  const read: string[] = [];
  const postiz = async (c: PostChannel) => (read.push(c.remoteId!), { likes: 10 });
  const r1 = await runMetrics({ now: () => at(2), readers: { postiz }, maxReads: 40, notify: async () => {} });
  assert.equal(read.length, 25);
  assert.deepEqual(read.slice(0, 3), ['pz-0', 'pz-1', 'pz-2'], 'oldest first');
  assert.equal(r1.waiting, 1);
  assert.equal(JSON.parse(readFileSync(join(home, 'metrics', 'postiz-queue.json'), 'utf8')).items[0].remoteId, 'pz-25');
  await runMetrics({ now: () => at(2.5), readers: { postiz }, maxReads: 40, notify: async () => {} });
  assert.equal(read.length, 25, 'still inside the hour: the 26th waits');
  const r3 = await runMetrics({ now: () => at(3.01), readers: { postiz }, maxReads: 40, notify: async () => {} });
  assert.equal(read.length, 26);
  assert.equal(r3.waiting, 0);
  assert.equal((await readSnapshots()).filter((s) => s.source === 'postiz').length, 26);

  // A 429 pauses the queue and keeps the read.
  await collectNow(posts[0], at(4.5));
  const busy = async () => Promise.reject(new PostizBusy(at(5.5).getTime()));
  await runMetrics({ now: () => at(4.5), readers: { postiz: busy }, notify: async () => {} });
  const q = await readPostizQueue();
  assert.equal(q.items.length, 1);
  assert.equal(postizTokens(q, at(5)), 0);
  assert.ok(postizTokens(q, at(5.6)) > 0);
});

test('schedule: each published channel is read or asked about once per bucket, from the right collector', async () => {
  const yt = await published('Launch video', [{ channel: 'youtube', via: 'direct', remoteId: VID }], { format: 'youtube-video' });
  const pz = await published('IG carousel', [{ channel: 'instagram', via: 'postiz', remoteId: 'pz-9' }]);
  const li = await published('LinkedIn carousel', [{ channel: 'linkedin', via: 'direct', url: 'https://www.linkedin.com/feed/update/urn:li:share:1/' }]);
  await savePost({ title: 'Not sent', status: 'scheduled', at: at(0).toISOString(), tz: 'UTC', channels: [{ ...sentCh({}), state: 'pending', sentAt: undefined }] });
  const reads: string[] = [];
  const readers = { youtube: async (c: PostChannel) => (reads.push(`yt:${c.remoteId}`), { views: 100 }), postiz: async (c: PostChannel) => (reads.push(`pz:${c.remoteId}`), { likes: 5 }) };
  const pings: string[] = [];
  const run = (h: number) => runMetrics({ now: () => at(h), readers, notify: async (t) => void pings.push(t) });

  const early = await run(12);
  assert.deepEqual([early.collected, early.queued, early.nudged], [[], [], []], 'nothing is due before a day');
  const d1 = await run(24.2);
  assert.deepEqual(reads, [`yt:${VID}`, 'pz:pz-9']);
  assert.equal(d1.collected.length, 2);
  assert.deepEqual(d1.nudged, ['LinkedIn carousel → LinkedIn (1d)']);
  assert.deepEqual(pings, ["How did Monday's LinkedIn carousel do?"]);
  for (const h of [25, 30, 33]) {
    const again = await run(h);
    assert.deepEqual([again.collected, again.queued, again.nudged, again.notified], [[], [], [], []], `once per bucket (${h} h)`);
  }
  await run(72.5);
  await run(169);
  await run(721);
  await run(722);
  assert.equal(reads.filter((r) => r.startsWith('yt:')).length, 4);
  assert.equal(reads.filter((r) => r.startsWith('pz:')).length, 4);
  const snaps = await readSnapshots();
  assert.deepEqual(snaps.filter((s) => s.post === yt.id).map((s) => E.bucketOf(s.ageHours)), ['1d', '3d', '7d', '30d']);
  assert.ok(snaps.filter((s) => s.post === yt.id).every((s) => s.source === 'youtube'));
  assert.ok(snaps.filter((s) => s.post === pz.id).every((s) => s.source === 'postiz'));
  assert.equal(snaps.filter((s) => s.post === li.id).length, 0, 'LinkedIn direct has no collector');
  assert.equal(pings.length, 4, 'one ask per bucket for LinkedIn');
  assert.match(pings[3], /How did your LinkedIn carousel from 2 Nov do\?/);

  // The real YouTube reader on the same path, through the fake network.
  rmSync(join(home, 'metrics'), { recursive: true, force: true });
  use(...ytRoutes());
  await runMetrics({ now: () => at(24.5), readers: { postiz: readers.postiz }, notify: async () => {} });
  assert.equal(calls.filter((c) => /youtube\/v3\/videos/.test(c.url)).length, 1);
});

test('catch-up: a window missed while the computer was off is read on the next pass if still open, else skipped', async () => {
  const a = await published('A', [{ channel: 'youtube', via: 'direct', remoteId: VID }]);
  const reads: number[] = [];
  const readers = { youtube: async () => (reads.push(1), { views: 50 }) };
  await runMetrics({ now: () => at(31), readers, notify: async () => {} });
  assert.equal(reads.length, 1, 'off at 24 h, on at 31 h: the 1-day read still happens');
  assert.equal(E.bucketOf((await readSnapshots())[0].ageHours), '1d');
  await runMetrics({ now: () => at(40), readers, notify: async () => {} });
  assert.equal(reads.length, 1);
  await deletePost(a.id);

  await published('B', [{ channel: 'youtube', via: 'direct', remoteId: VID }]);
  await runMetrics({ now: () => at(50), readers, notify: async () => {} });
  assert.equal(reads.length, 1, 'off until 50 h: the 1-day window closed, no reading at the wrong age');
  await runMetrics({ now: () => at(90), readers, notify: async () => {} });
  assert.equal(reads.length, 2, 'the 3-day read comes on time');

  // A failing read is retried, then turns into an ask.
  rmSync(join(home, 'metrics'), { recursive: true, force: true });
  let n = 0;
  const flaky = { youtube: async () => (n++, Promise.reject(new Error('Google 503'))) };
  for (const h of [72.1, 72.2, 73.2, 75.3]) await runMetrics({ now: () => at(h), readers: flaky, notify: async () => {} });
  assert.equal(n, 3, 'second try waits an hour, third two');
  assert.equal((await pendingNumbers(at(76))).length, 1);
});

test('nudges: at most once per post per bucket and 3 a day, held in quiet hours; pending lists what is still wanted', async () => {
  const posts = [];
  for (const [i, ch] of (['linkedin', 'linkedin', 'x', 'newsletter', 'linkedin'] as const).entries()) posts.push(await published(`Manual ${i}`, [{ channel: ch, via: ch === 'linkedin' ? 'direct' : 'manual' }]));
  const pings: string[] = [];
  const notify = async (t: string) => void pings.push(t);
  const r = await runMetrics({ now: () => at(170), notify });
  assert.equal(r.nudged.length, 5);
  assert.equal(r.notified.length, 3);
  const pending = await pendingNumbers(at(170));
  assert.equal(pending.length, 5);
  assert.deepEqual(Object.keys(pending[0]).sort(), ['bucket', 'channel', 'notified', 'post', 'since', 'title']);
  assert.equal(pending.filter((x) => x.notified).length, 3);
  assert.equal(pending[0].bucket, '7d');
  assert.equal((await runMetrics({ now: () => at(171), notify })).notified.length, 0, 'the daily cap holds');
  assert.equal(pings.length, 3);

  // Numbers added for one not yet pinged: it's no longer wanted, so it never will be.
  const quiet = pending.find((x) => !x.notified)!;
  await addSnapshot({ post: quiet.post, channel: quiet.channel, source: 'manual', clicks: 40 }, at(172));
  assert.equal((await pendingNumbers(at(172))).length, 4);

  // Quiet hours hold the rest even on a new day.
  const local = at(194);
  const hh = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  await writeSettings({ agentsQuietStart: hh(new Date(local.getTime() - 3_600_000)), agentsQuietEnd: hh(new Date(local.getTime() + 3_600_000)) });
  assert.equal((await runMetrics({ now: () => local, notify })).notified.length, 0);
  await writeSettings({ agentsQuietStart: '00:00', agentsQuietEnd: '00:00' });
  const next = await runMetrics({ now: () => local, notify });
  assert.equal(next.notified.length, 1, 'next day: the one still wanted and not yet pinged');
  assert.equal(pings.length, 4);
  assert.equal((await pendingNumbers(at(240))).length, 0, 'the 7-day window closed');

  // Paused: nothing is read or asked.
  await writeSettings({ metricsPaused: true });
  assert.equal((await runMetrics({ now: () => at(721), notify })).skipped, 'Collecting numbers is paused.');
});

test('screenshot reading: one vision call on a copy of the image; keeps known keys, platform formats, nothing absurd', async () => {
  const img = join(home, 'shot.png');
  writeFileSync(img, Buffer.from('89504e470d0a1a0a', 'hex'));
  let seenCwd = '';
  const ask = async (prompt: string, cwd: string, image: string) => {
    seenCwd = cwd;
    assert.deepEqual(readdirSync(cwd), [image], 'only the image is in the folder Claude can read');
    assert.match(prompt, /LinkedIn post's statistics/);
    assert.match(prompt, new RegExp(image.replace('.', '\\.')));
    return 'Here you go:\n```json\n{"values": {"impressions": "1.2K", "likes": "3,410", "reach": 900, "bogus": 5, "views": "5000000000", "comments": "-3", "avgViewPct": "140%", "shares": "lots"}, "date": "Nov 3", "title": "We shipped\\u0007 it"}\n```';
  };
  const r = await readMetricsFromImage(img, { channel: 'linkedin', ask });
  assert.deepEqual(r.values, { impressions: 1200, likes: 3410, reach: 900 });
  assert.deepEqual(r.dropped.sort(), ['avgViewPct', 'bogus', 'comments', 'shares', 'views']);
  assert.deepEqual(r.seen, { date: 'Nov 3', title: 'We shipped  it' });
  assert.equal(existsSync(seenCwd), false, 'the temp copy is removed');
  assert.equal((await readSnapshots()).length, 0, 'a proposal only: nothing saved');

  assert.deepEqual(validateReading('{"likes": 12, "date": "Oct 1"}').values, { likes: 12 }, 'flat answers are accepted too');
  assert.throws(() => validateReading('I cannot see any numbers'), /Couldn't read/);
  await assert.rejects(readMetricsFromImage(join(home, 'notes.txt'), { channel: 'linkedin', ask }), /PNG, JPEG/);
  await assert.rejects(readMetricsFromImage(join(home, 'missing.png'), { channel: 'linkedin', ask }), /missing/);
});

test('API: pending, collect-now, read-screenshot, metricsPaused — and no secret in any response, log or file', async () => {
  const logs: string[] = [];
  const orig = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = (...a: unknown[]) => void logs.push(a.map(String).join(' '));
  try {
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    const li = await published('Tuesday carousel', [{ channel: 'linkedin', via: 'direct', sentAt: hoursAgo(25) }], { at: hoursAgo(25) });
    const yt = await published('Video', [{ channel: 'youtube', via: 'direct', remoteId: VID, sentAt: hoursAgo(1) }]);
    const pz = await published('Thread', [{ channel: 'x', via: 'postiz', remoteId: 'pz-x', sentAt: hoursAgo(1) }]);
    await savePost({ title: 'Idea', status: 'idea', tz: 'UTC', channels: [] }).then((p) => api(`/api/metrics/collect-now/${p.id}`, { method: 'POST' })).then((r) => assert.equal(r.status, 400));

    const cn = await api(`/api/metrics/collect-now/${yt.id}`, { method: 'POST' });
    assert.deepEqual(cn.body.queued, ['youtube']);
    assert.deepEqual((await api(`/api/metrics/collect-now/${pz.id}`, { method: 'POST' })).body.queued, ['x']);
    assert.deepEqual((await api(`/api/metrics/collect-now/${li.id}`, { method: 'POST' })).body.manual, ['linkedin']);
    assert.equal((await api('/api/metrics/collect-now/nope', { method: 'POST' })).status, 404);

    // Every read fails with a secret in its error: logged and stored masked.
    use([/./, () => jsonRes({ error: { message: `bad token ${YT_ACCESS} key ${POSTIZ_KEY}` } }, 500)]);
    const bad = await runMetrics({ notify: async () => {} });
    assert.equal(bad.failed.length, 2);
    assert.ok(logs.some((l) => /\*\*\*/.test(l)), 'the failure was logged, masked');

    const pend = await api('/api/metrics/pending');
    assert.equal(pend.status, 200);
    assert.deepEqual(pend.body.map((x: any) => [x.title, x.channel, x.bucket]), [['Tuesday carousel', 'linkedin', '1d']]);

    // Ask again: the YouTube read was used up; the Postiz one stays queued and is tried again after 15 minutes.
    await api(`/api/metrics/collect-now/${yt.id}`, { method: 'POST' });
    use(...ytRoutes(), [/analytics\/post\/pz-x/, () => jsonRes([{ label: 'Retweets', data: [{ total: '3', date: '2026-11-04' }] }])]);
    const r = await runMetrics({ now: () => new Date(Date.now() + 20 * 60_000), notify: async () => {} });
    assert.equal(r.collected.length, 2);
    const snaps = await readSnapshots();
    assert.equal(snaps.find((s) => s.post === yt.id)?.views, 1520);
    assert.equal(snaps.find((s) => s.post === pz.id)?.shares, 3);

    assert.equal((await api('/api/settings', { method: 'PUT', json: { metricsPaused: true } })).body.metricsPaused, true);
    assert.match((await runMetrics()).skipped ?? '', /paused/);
    await api('/api/settings', { method: 'PUT', json: { metricsPaused: false } });

    setScreenshotAsk(async () => `{"values": {"impressions": "2.5K", "likes": "61", "token": "${YT_ACCESS}"}, "title": "Tuesday carousel"}`);
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    const up = await api('/api/metrics/read-screenshot?channel=linkedin&name=stats.png', { method: 'POST', headers: { 'content-type': 'image/png' }, body: png });
    assert.equal(up.status, 200);
    assert.deepEqual(up.body.values, { impressions: 2500, likes: 61 });
    assert.deepEqual(up.body.seen, { title: 'Tuesday carousel' });
    assert.deepEqual(readdirSync(join(home, 'metrics', 'screenshots')), [], 'the upload is not kept');
    mkdirSync(join(home, 'uploads'), { recursive: true });
    writeFileSync(join(home, 'uploads', 'ig.jpg'), png);
    assert.equal((await api('/api/metrics/read-screenshot', { method: 'POST', json: { path: 'uploads/ig.jpg', channel: 'instagram' } })).status, 200);
    assert.equal((await api('/api/metrics/read-screenshot', { method: 'POST', json: { path: '/etc/hosts', channel: 'instagram' } })).status, 403);
    assert.equal((await api('/api/metrics/read-screenshot', { method: 'POST', json: { path: 'uploads/ig.jpg' } })).status, 400);
    assert.equal((await api('/api/metrics/read-screenshot?channel=linkedin&name=x.txt', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'hi' })).status, 400);
    // The confirmed proposal is saved as a screenshot snapshot.
    const saved = await api('/api/metrics/snapshots', { method: 'POST', json: { post: li.id, channel: 'linkedin', source: 'screenshot', ...up.body.values } });
    assert.equal(saved.body.source, 'screenshot');
    assert.equal((await api('/api/metrics/pending')).body.length, 0);
  } finally {
    Object.assign(console, orig);
    setScreenshotAsk(null);
  }
  const files = ['collect-state.json', 'postiz-queue.json', 'snapshots.json'].map((f) => readFileSync(join(home, 'metrics', f), 'utf8'));
  const everything = [...seen, ...logs, ...files].join('\n');
  for (const s of SECRETS) assert.equal(everything.includes(s), false, `secret leaked: ${s.slice(0, 8)}…`);
});
