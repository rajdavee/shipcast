import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

const home = mkdtempSync(join(tmpdir(), 'publish-'));
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
const { setSecret, getSecret, savePost, getPost, listPosts, deletePost, writeSettings, setPublishFetch, runPublisher, oauthStart, oauthFinish, connections, linkedinAdapter, youtubeAdapter, postizAdapter, postizBase, matchIntegration, mediaFiles, PublishError } = E;

// ── a fake fetch that records requests and answers with recorded-shape responses ──
interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  form?: FormData;
}
type Route = (c: Call) => Response | Promise<Response>;
let calls: Call[] = [];
let routes: [RegExp, Route][] = [];
const jsonRes = (v: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json', ...headers } });
async function fake(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input);
  const h: Record<string, string> = {};
  new Headers(init.headers).forEach((v, k) => (h[k] = v));
  let body = '';
  let form: FormData | undefined;
  const b = init.body as unknown;
  if (typeof b === 'string') body = b;
  else if (b instanceof URLSearchParams) body = b.toString();
  else if (b instanceof FormData) form = b;
  else if (b instanceof Uint8Array) body = `<${b.length} bytes>`;
  else if (b && typeof (b as ReadableStream).getReader === 'function') {
    let n = 0;
    for await (const chunk of b as AsyncIterable<Uint8Array>) n += chunk.length;
    body = `<${n} bytes streamed>`;
  }
  const call = { url, method: init.method ?? 'GET', headers: h, body, form };
  calls.push(call);
  const hit = routes.find(([re]) => re.test(`${call.method} ${url}`));
  if (!hit) return new Response('no route', { status: 404 });
  return hit[1](call);
}
setPublishFetch(fake as typeof fetch);
const use = (...r: [RegExp, Route][]) => ((routes = r), (calls = []));

const LI_TOKEN = 'li-access-TOKEN-0123456789';
const YT_ACCESS = 'ya29.yt-access-TOKEN-0123456789';
const YT_REFRESH = '1//yt-refresh-TOKEN-0123456789';
const CLIENT_SECRET = 'client-SECRET-0123456789';
const POSTIZ_KEY = 'postiz-KEY-0123456789';
const SECRETS = [LI_TOKEN, YT_ACCESS, YT_REFRESH, CLIENT_SECRET, POSTIZ_KEY];
const future = () => new Date(Date.now() + 30 * 86400_000).toISOString();

const outDir = join(home, 'campaigns', 'c1', 'deliverables', 's1', 'out');
mkdirSync(outDir, { recursive: true });
for (const f of ['a.png', 'b.png', 'c.png']) writeFileSync(join(outDir, f), Buffer.alloc(64, 1));
writeFileSync(join(outDir, 'deck.pdf'), '%PDF-1.4 test');
writeFileSync(join(outDir, 'video.mp4'), Buffer.alloc(2048, 2));
const rel = (f: string) => `campaigns/c1/deliverables/s1/out/${f}`;

const basePost = (over: Partial<import('@shipcast/engine').Post> = {}) =>
  ({ id: 'p1', title: 'Launch day', status: 'scheduled', at: '2026-11-10T09:00:00.000Z', tz: 'UTC', channels: [], notes: '', createdAt: '', updatedAt: '', ...over }) as import('@shipcast/engine').Post;
const ch = (over: Partial<import('@shipcast/engine').PostChannel> = {}) => ({ channel: 'linkedin', caption: 'We shipped (finally) — 2x faster #builds', hashtags: ['#shipcast', '#devtools'], media: [], via: 'direct', ...over }) as import('@shipcast/engine').PostChannel;

async function linkedinConnected() {
  await setSecret('publish.linkedin.token', JSON.stringify({ access: LI_TOKEN, expiresAt: future(), sub: 'abc123', name: 'Raj Dave' }));
}

// ── LinkedIn ───────────────────────────────────────────────────────────

const liRoutes = (): [RegExp, Route][] => {
  let n = 0;
  return [
    [/^POST https:\/\/api\.linkedin\.com\/rest\/images\?action=initializeUpload$/, () => jsonRes({ value: { uploadUrlExpiresAt: 1, uploadUrl: `https://www.linkedin.com/dms-uploads/img${++n}`, image: `urn:li:image:I${n}` } })],
    [/^POST https:\/\/api\.linkedin\.com\/rest\/documents\?action=initializeUpload$/, () => jsonRes({ value: { uploadUrlExpiresAt: 1, uploadUrl: 'https://www.linkedin.com/dms-uploads/doc1', document: 'urn:li:document:D1' } })],
    [/^PUT https:\/\/www\.linkedin\.com\/dms-uploads\//, () => new Response(null, { status: 201 })],
    [/^POST https:\/\/api\.linkedin\.com\/rest\/posts$/, () => new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:7000' } })],
    [/^POST https:\/\/api\.linkedin\.com\/rest\/socialActions\//, () => jsonRes({}, 201)],
  ];
};
const liPost = () => JSON.parse(calls.find((c) => c.url.endsWith('/rest/posts'))!.body);

test('LinkedIn text post: versioned headers, escaped commentary, hashtags, URL from x-restli-id, first comment after', async () => {
  await linkedinConnected();
  use(...liRoutes());
  assert.equal(E.liCommentary(ch({ caption: 'a_b', hashtags: ['#dev-tools'] })), 'a\\_b\n\n\\#dev-tools');
  const r = await linkedinAdapter.send(basePost(), ch({ firstComment: 'Docs: https://shipcast.dev' }), []);
  assert.equal(r.url, 'https://www.linkedin.com/feed/update/urn:li:share:7000/');
  assert.equal(r.id, 'urn:li:share:7000');
  const post = calls.find((c) => c.url.endsWith('/rest/posts'))!;
  assert.equal(post.headers['linkedin-version'], '202608');
  assert.equal(post.headers['x-restli-protocol-version'], '2.0.0');
  assert.equal(post.headers.authorization, `Bearer ${LI_TOKEN}`);
  const body = liPost();
  assert.equal(body.author, 'urn:li:person:abc123');
  assert.equal(body.visibility, 'PUBLIC');
  assert.equal(body.lifecycleState, 'PUBLISHED');
  assert.equal(body.content, undefined);
  assert.equal(body.commentary, 'We shipped \\(finally\\) — 2x faster \\#builds\n\n{hashtag|\\#|shipcast} {hashtag|\\#|devtools}');
  const comment = calls.find((c) => c.url.includes('/socialActions/'))!;
  assert.equal(comment.url, `https://api.linkedin.com/rest/socialActions/${encodeURIComponent('urn:li:share:7000')}/comments`);
  assert.deepEqual(JSON.parse(comment.body), { actor: 'urn:li:person:abc123', object: 'urn:li:share:7000', message: { text: 'Docs: https://shipcast.dev' } });
  assert.ok(calls.findIndex((c) => c.url.includes('/socialActions/')) > calls.findIndex((c) => c.url.endsWith('/rest/posts')));
});

test('LinkedIn single image: initializeUpload, PUT the bytes, then content.media', async () => {
  await linkedinConnected();
  use(...liRoutes());
  const files = mediaFiles(ch({ media: [rel('a.png')] }));
  await linkedinAdapter.send(basePost(), ch(), files);
  const init = calls[0];
  assert.match(init.url, /\/rest\/images\?action=initializeUpload$/);
  assert.deepEqual(JSON.parse(init.body), { initializeUploadRequest: { owner: 'urn:li:person:abc123' } });
  assert.equal(init.headers['linkedin-version'], '202608');
  const put = calls[1];
  assert.equal(put.method, 'PUT');
  assert.equal(put.url, 'https://www.linkedin.com/dms-uploads/img1');
  assert.equal(put.body, '<64 bytes>');
  assert.equal(put.headers.authorization, `Bearer ${LI_TOKEN}`);
  assert.deepEqual(liPost().content, { media: { id: 'urn:li:image:I1' } });
});

test('LinkedIn multi-image: one upload per image, then content.multiImage in order', async () => {
  await linkedinConnected();
  use(...liRoutes());
  await linkedinAdapter.send(basePost(), ch(), mediaFiles(ch({ media: [rel('a.png'), rel('b.png'), rel('c.png')] })));
  assert.equal(calls.filter((c) => c.method === 'PUT').length, 3);
  assert.deepEqual(liPost().content, { multiImage: { images: [{ id: 'urn:li:image:I1' }, { id: 'urn:li:image:I2' }, { id: 'urn:li:image:I3' }] } });
});

test('LinkedIn PDF document carousel: documents upload, then content.media with a title', async () => {
  await linkedinConnected();
  use(...liRoutes());
  await linkedinAdapter.send(basePost(), ch({ title: 'Five lessons' }), mediaFiles(ch({ media: [rel('deck.pdf')] })));
  assert.match(calls[0].url, /\/rest\/documents\?action=initializeUpload$/);
  assert.equal(calls[1].url, 'https://www.linkedin.com/dms-uploads/doc1');
  assert.deepEqual(liPost().content, { media: { id: 'urn:li:document:D1', title: 'Five lessons' } });
});

test('LinkedIn: video is refused with a pointer to manual/Postiz; a failed first comment does not fail the post; expiry and disconnection are clear', async () => {
  await linkedinConnected();
  use(...liRoutes());
  await assert.rejects(linkedinAdapter.send(basePost(), ch(), mediaFiles(ch({ media: [rel('video.mp4')] }))), (e: any) => e instanceof PublishError && e.permanent && /Postiz/.test(e.message));
  assert.equal(calls.length, 0);
  use(...liRoutes().filter(([re]) => !/socialActions/.test(re.source)), [/socialActions/, () => jsonRes({ message: 'nope' }, 403)]);
  const r = await linkedinAdapter.send(basePost(), ch({ firstComment: 'hi' }), []);
  assert.ok(r.url);
  assert.match(r.note ?? '', /first comment failed/);
  await setSecret('publish.linkedin.token', JSON.stringify({ access: LI_TOKEN, expiresAt: new Date(Date.now() - 1000).toISOString(), sub: 'abc123' }));
  await assert.rejects(linkedinAdapter.send(basePost(), ch(), []), /expired/);
  await setSecret('publish.linkedin.token', null);
  await assert.rejects(linkedinAdapter.send(basePost(), ch(), []), /not connected/);
});

// ── YouTube ────────────────────────────────────────────────────────────

test('YouTube: refreshes an expired token, resumable upload with metadata, youtu.be URL, and says when Google kept it private', async () => {
  await setSecret('publish.youtube.client', JSON.stringify({ id: 'yt-client.apps.googleusercontent.com', secret: CLIENT_SECRET }));
  await setSecret('publish.youtube.token', JSON.stringify({ access: 'old-access-xxxxxxxx', refresh: YT_REFRESH, expiresAt: new Date(Date.now() - 1000).toISOString() }));
  use(
    [/^POST https:\/\/oauth2\.googleapis\.com\/token$/, () => jsonRes({ access_token: YT_ACCESS, expires_in: 3599 })],
    [/^POST https:\/\/www\.googleapis\.com\/upload\/youtube\/v3\/videos\?uploadType=resumable&part=snippet,status$/, () => new Response(null, { status: 200, headers: { location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=U1' } })],
    [/^PUT https:\/\/www\.googleapis\.com\/upload\/youtube\/v3\/videos\?upload_id=U1$/, () => jsonRes({ id: 'vid123', status: { privacyStatus: 'private' } })],
  );
  const r = await youtubeAdapter.send(basePost(), ch({ channel: 'youtube', title: 'Ship <faster>', caption: 'How we did it', hashtags: ['#dev'] }), mediaFiles(ch({ media: [rel('video.mp4')] })));
  assert.equal(r.url, 'https://youtu.be/vid123');
  assert.match(r.note ?? '', /private.*audit/);
  const refresh = new URLSearchParams(calls[0].body);
  assert.equal(refresh.get('grant_type'), 'refresh_token');
  assert.equal(refresh.get('refresh_token'), YT_REFRESH);
  const init = calls[1];
  assert.equal(init.headers.authorization, `Bearer ${YT_ACCESS}`);
  assert.equal(init.headers['x-upload-content-length'], '2048');
  assert.equal(init.headers['x-upload-content-type'], 'video/mp4');
  const meta = JSON.parse(init.body);
  assert.equal(meta.snippet.title, 'Ship faster');
  assert.equal(meta.snippet.description, 'How we did it\n\n#dev');
  assert.equal(meta.status.privacyStatus, 'public');
  assert.equal(calls[2].method, 'PUT');
  assert.equal(calls[2].body, '<2048 bytes streamed>');
  // The refreshed token was stored, and the refresh token kept.
  const stored = JSON.parse((await getSecret('publish.youtube.token'))!);
  assert.equal(stored.access, YT_ACCESS);
  assert.equal(stored.refresh, YT_REFRESH);
  await assert.rejects(youtubeAdapter.send(basePost(), ch({ channel: 'youtube' }), []), /needs a video/);
});

// ── Postiz ─────────────────────────────────────────────────────────────

const POSTIZ = 'http://localhost:4007';
const integrations = [
  { id: 'int-li', name: 'Raj Dave', identifier: 'linkedin', picture: '', disabled: false, profile: 'rajdave' },
  { id: 'int-x1', name: 'Shipcast', identifier: 'x', disabled: false, profile: 'shipcast' },
  { id: 'int-x2', name: 'Raj', identifier: 'x', disabled: false, profile: 'rajdavee' },
  { id: 'int-ig', name: 'shipcast.studio', identifier: 'instagram-standalone', disabled: false, profile: 'shipcast.studio' },
  { id: 'int-tt', name: 'old', identifier: 'tiktok', disabled: true },
];
const postizRoutes = (): [RegExp, Route][] => {
  let n = 0;
  return [
    [/^GET http:\/\/localhost:4007\/api\/public\/v1\/integrations$/, (c) => (c.headers.authorization === POSTIZ_KEY ? jsonRes(integrations) : jsonRes({ message: 'Unauthorized' }, 401))],
    [/^POST http:\/\/localhost:4007\/api\/public\/v1\/upload$/, () => (n++, jsonRes({ id: `m${n}`, name: `f${n}.png`, path: `https://uploads.example/f${n}.png`, status: 'ready' }))],
    [/^POST http:\/\/localhost:4007\/api\/public\/v1\/posts$/, () => jsonRes([{ postId: 'pz-post-1', integration: 'int-li' }])],
  ];
};

test('Postiz: base URL forms, channel matching by provider and account', () => {
  assert.equal(postizBase('http://localhost:4007'), 'http://localhost:4007/api/public/v1');
  assert.equal(postizBase('https://postiz.example.com/'), 'https://postiz.example.com/api/public/v1');
  assert.equal(postizBase('https://postiz.example.com/api'), 'https://postiz.example.com/api/public/v1');
  assert.equal(postizBase('https://api.postiz.com'), 'https://api.postiz.com/public/v1');
  assert.equal(postizBase('https://x.example/api/public/v1/'), 'https://x.example/api/public/v1');
  assert.throws(() => postizBase('ftp://x'), /http/);
  assert.equal(matchIntegration(integrations, ch()).id, 'int-li');
  assert.equal(matchIntegration(integrations, ch({ channel: 'instagram' })).id, 'int-ig');
  assert.throws(() => matchIntegration(integrations, ch({ channel: 'x' })), /2 X channels/);
  assert.equal(matchIntegration(integrations, ch({ channel: 'x', account: '@RajDavee' })).id, 'int-x2');
  assert.throws(() => matchIntegration(integrations, ch({ channel: 'tiktok' })), /No TikTok channel/);
});

test('Postiz: lists channels, uploads media as multipart, creates a scheduled post with the first comment and records its id', async () => {
  await setSecret('publish.postiz', JSON.stringify({ url: POSTIZ, key: POSTIZ_KEY }));
  use(...postizRoutes());
  const now = new Date('2026-11-10T08:55:00Z');
  const r = await postizAdapter(() => now).send(basePost(), ch({ via: 'postiz', firstComment: 'Link in here' }), mediaFiles(ch({ media: [rel('a.png'), rel('b.png')] })));
  assert.equal(r.id, 'pz-post-1');
  assert.match(r.note ?? '', /Postiz.*09:00/);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url.replace(POSTIZ, '')}`), ['GET /api/public/v1/integrations', 'POST /api/public/v1/upload', 'POST /api/public/v1/upload', 'POST /api/public/v1/posts']);
  assert.ok(calls.every((c) => c.headers.authorization === POSTIZ_KEY));
  const file = calls[1].form!.get('file') as File;
  assert.equal(file.name, 'a.png');
  assert.equal(file.type, 'image/png');
  const body = JSON.parse(calls[3].body);
  assert.equal(body.type, 'schedule');
  assert.equal(body.date, '2026-11-10T09:00:00.000Z');
  assert.equal(body.shortLink, false);
  assert.deepEqual(body.tags, []);
  assert.deepEqual(body.posts[0].integration, { id: 'int-li' });
  assert.deepEqual(body.posts[0].settings, { __type: 'linkedin', post_as_images_carousel: true });
  assert.deepEqual(body.posts[0].value, [
    { content: 'We shipped (finally) — 2x faster #builds\n\n#shipcast #devtools', image: [{ id: 'm1', path: 'https://uploads.example/f1.png' }, { id: 'm2', path: 'https://uploads.example/f2.png' }] },
    { content: 'Link in here', image: [] },
  ]);
  // Past its time: "now".
  use(...postizRoutes());
  await postizAdapter(() => new Date('2026-11-10T09:30:00Z')).send(basePost(), ch({ via: 'postiz' }), []);
  assert.equal(JSON.parse(calls.at(-1)!.body).type, 'now');
  // PDFs never reach Postiz (it rejects them).
  use(...postizRoutes());
  await assert.rejects(postizAdapter().send(basePost(), ch({ via: 'postiz' }), mediaFiles(ch({ media: [rel('deck.pdf')] }))), /PDF/);
  assert.equal(calls.length, 0);
});

test('media outside the Shipcast home, or not media, is never published', () => {
  const outside = join(tmpdir(), `outside-${process.pid}.png`);
  writeFileSync(outside, 'x');
  assert.throws(() => mediaFiles(ch({ media: [outside] })), /Not a publishable/);
  writeFileSync(join(home, 'notes.txt'), 'x');
  assert.throws(() => mediaFiles(ch({ media: ['notes.txt'] })), /Not a publishable/);
  assert.throws(() => mediaFiles(ch({ media: ['secrets.json'] })), /Not a publishable|missing/);
  assert.throws(() => mediaFiles(ch({ media: ['../../etc/hosts'] })), /Not a publishable|missing/);
  rmSync(outside);
});

// ── the publisher loop ─────────────────────────────────────────────────

const T0 = Date.parse('2026-11-10T09:00:00Z');
let clockMs = T0;
const clock = () => new Date(clockMs);
let notes: string[] = [];
let sends: string[] = [];
let fail: (c: { channel: string }) => Error | null = () => null;
const fakeAdapter = {
  send: async (_p: any, c: any) => {
    sends.push(c.channel);
    const e = fail(c);
    if (e) throw e;
    return { url: `https://example.com/${c.channel}`, id: `id-${c.channel}` };
  },
};
const run = (extra: Record<string, unknown> = {}) => runPublisher({ now: clock, notify: async (t, m) => void notes.push(`${t} | ${m}`), adapter: () => fakeAdapter, log: () => {}, ...extra });

async function schedule(over: Partial<import('@shipcast/engine').Post> = {}, channels = [ch({ state: 'pending' })]) {
  return savePost({ title: 'Launch day', status: 'scheduled', at: new Date(T0).toISOString(), tz: 'UTC', channels, ...over });
}
beforeEach(async () => {
  for (const p of await listPosts()) await deletePost(p.id);
  await writeSettings({ publishingPaused: false });
  clockMs = T0;
  notes = [];
  sends = [];
  fail = () => null;
});

test('loop: nothing before its time; at its time a pending channel is sent and the post published', async () => {
  const p = await schedule();
  clockMs = T0 - 60_000;
  assert.deepEqual((await run()).sent, []);
  clockMs = T0 + 1000;
  const r = await run();
  assert.deepEqual(r.sent, ['Launch day → LinkedIn']);
  const after = (await getPost(p.id))!;
  assert.equal(after.status, 'published');
  assert.equal(after.channels[0].state, 'sent');
  assert.equal(after.channels[0].url, 'https://example.com/linkedin');
  assert.equal(after.channels[0].remoteId, 'id-linkedin');
  assert.ok(after.channels[0].sentAt);
  // Never sent twice.
  clockMs += 60 * 60_000;
  await run();
  assert.deepEqual(sends, ['linkedin']);
});

test('loop: failures retry with backoff (pending + note), then fail after 3 attempts with a notification', async () => {
  const p = await schedule();
  fail = () => new Error('LinkedIn post failed (503)');
  clockMs = T0;
  assert.deepEqual((await run()).retrying, ['Launch day → LinkedIn']);
  let c = (await getPost(p.id))!.channels[0];
  assert.equal(c.state, 'pending');
  assert.equal(c.attempts, 1);
  assert.match(c.error ?? '', /Attempt 1 of 3 failed: LinkedIn post failed \(503\)/);
  assert.equal(c.retryAt, new Date(T0 + 5 * 60_000).toISOString());
  clockMs = T0 + 4 * 60_000;
  await run();
  assert.equal(sends.length, 1, 'waits for the retry time');
  clockMs = T0 + 5 * 60_000;
  await run();
  c = (await getPost(p.id))!.channels[0];
  assert.equal(c.attempts, 2);
  assert.equal(c.retryAt, new Date(T0 + 15 * 60_000).toISOString());
  clockMs = T0 + 15 * 60_000;
  assert.deepEqual((await run()).failed, ['Launch day → LinkedIn']);
  const post = (await getPost(p.id))!;
  assert.equal(post.channels[0].state, 'failed');
  assert.equal(post.status, 'failed');
  assert.equal(sends.length, 3);
  assert.match(notes.join('\n'), /Couldn't post on LinkedIn/);
  clockMs += 3600_000;
  await run();
  assert.equal(sends.length, 3);
});

test('loop: a permanent error fails at once; a retry that succeeds is sent', async () => {
  const a = await schedule({ title: 'A' });
  fail = () => new PublishError('LinkedIn is not connected', true);
  await run();
  assert.equal((await getPost(a.id))!.channels[0].state, 'failed');
  assert.equal(sends.length, 1);
  await deletePost(a.id);
  const b = await schedule({ title: 'B' });
  let n = 0;
  fail = () => (n++ === 0 ? new Error('timeout') : null);
  await run();
  clockMs += 5 * 60_000;
  await run();
  const c = (await getPost(b.id))!.channels[0];
  assert.equal(c.state, 'sent');
  assert.equal(c.attempts, 2);
  assert.equal(c.error, undefined);
});

test('loop: missed by more than 6 hours → due with a notification, not sent', async () => {
  const p = await schedule();
  clockMs = T0 + 7 * 3600_000;
  assert.deepEqual((await run()).due, ['Launch day → LinkedIn']);
  assert.equal(sends.length, 0);
  assert.equal((await getPost(p.id))!.channels[0].state, 'due');
  assert.match(notes[0], /Missed post on LinkedIn/);
});

test('loop: manual channels become due with a "Time to post" reminder, once', async () => {
  const p = await schedule({}, [ch({ via: 'manual', state: 'pending' })]);
  await run();
  await run();
  assert.equal(sends.length, 0);
  assert.equal((await getPost(p.id))!.channels[0].state, 'due');
  assert.deepEqual(notes, ['Time to post on LinkedIn: Launch day | Open Shipcast for the post kit, then mark it posted.']);
});

test('loop: paused sends nothing; drafts, unarmed channels and sent channels are never sent', async () => {
  await schedule();
  await writeSettings({ publishingPaused: true });
  assert.match((await run()).skipped ?? '', /paused/);
  assert.equal(sends.length, 0);
  await writeSettings({ publishingPaused: false });
  for (const p of await listPosts()) await deletePost(p.id);
  await savePost({ title: 'Draft', status: 'ready', at: new Date(T0).toISOString(), tz: 'UTC', channels: [ch({ state: 'pending' })] });
  await schedule({ title: 'Imported' }, [ch()]); // scheduled without going through scheduling: no state
  await schedule({ title: 'Done' }, [ch({ state: 'sent', url: 'https://x' })]);
  await run();
  assert.deepEqual(sends, []);
});

test('loop: overlapping ticks never send twice', async () => {
  await schedule();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const slow = { send: async (_p: any, c: any) => (sends.push(c.channel), await gate, { url: 'https://example.com/x' }) };
  const first = runPublisher({ now: clock, notify: async () => {}, adapter: () => slow, log: () => {} });
  await new Promise((r) => setTimeout(r, 50));
  const second = await runPublisher({ now: clock, notify: async () => {}, adapter: () => slow, log: () => {} });
  assert.match(second.skipped ?? '', /still running/);
  release();
  assert.deepEqual((await first).sent.length, 1);
  await run();
  assert.deepEqual(sends, ['linkedin']);
});

test('loop: a stale editor copy cannot re-arm a sent channel; dry run posts nothing', async () => {
  const p = await schedule();
  await run();
  await savePost({ id: p.id, status: 'scheduled', channels: [ch({ state: 'pending' })] });
  assert.equal((await getPost(p.id))!.channels[0].state, 'sent');
  const q = await schedule({ title: 'Dry' });
  await run({ dryRun: true, adapter: () => ({ send: async () => assert.fail('dry run must not send') }) });
  assert.match((await getPost(q.id))!.channels[0].note ?? '', /Dry run/);
});

// ── OAuth ──────────────────────────────────────────────────────────────

test('OAuth: state is single-use, provider-bound and expires after 10 minutes; a good code stores the token', async () => {
  await setSecret('publish.linkedin.client', JSON.stringify({ id: 'li-client-id', secret: CLIENT_SECRET }));
  const t = Date.now();
  const { url, redirect } = await oauthStart('linkedin', 4317, t);
  assert.equal(redirect, 'http://localhost:4317/oauth/linkedin/callback');
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, 'https://www.linkedin.com/oauth/v2/authorization');
  assert.equal(u.searchParams.get('scope'), 'openid profile w_member_social');
  assert.equal(u.searchParams.get('client_id'), 'li-client-id');
  assert.ok(!url.includes(CLIENT_SECRET));
  const state = u.searchParams.get('state')!;
  assert.ok(state.length >= 30);
  await assert.rejects(oauthFinish('linkedin', 'forged', 'code'), /expired or was not started/);
  await assert.rejects(oauthFinish('youtube', state, 'code'), /expired or was not started/, 'bound to its provider');
  await assert.rejects(oauthFinish('linkedin', state, 'code'), /expired or was not started/, 'single use');
  const late = new URL((await oauthStart('linkedin', 4317, t)).url).searchParams.get('state')!;
  await assert.rejects(oauthFinish('linkedin', late, 'code', t + 11 * 60_000), /expired/);

  const ok = new URL((await oauthStart('linkedin', 4317)).url).searchParams.get('state')!;
  use(
    [/^POST https:\/\/www\.linkedin\.com\/oauth\/v2\/accessToken$/, () => jsonRes({ access_token: LI_TOKEN, expires_in: 5184000, scope: 'openid,profile,w_member_social' })],
    [/^GET https:\/\/api\.linkedin\.com\/v2\/userinfo$/, (c) => (c.headers.authorization === `Bearer ${LI_TOKEN}` ? jsonRes({ sub: 'xyz789', name: 'Raj Dave' }) : jsonRes({}, 401))],
  );
  assert.deepEqual(await oauthFinish('linkedin', ok, 'the-code'), { account: 'Raj Dave' });
  const form = new URLSearchParams(calls[0].body);
  assert.equal(form.get('grant_type'), 'authorization_code');
  assert.equal(form.get('redirect_uri'), 'http://localhost:4317/oauth/linkedin/callback');
  assert.equal(JSON.parse((await getSecret('publish.linkedin.token'))!).sub, 'xyz789');
  const conn = await connections();
  assert.equal(conn.linkedin.connected, true);
  assert.equal(conn.linkedin.account, 'Raj Dave');
  for (const s of SECRETS) assert.ok(!JSON.stringify(conn).includes(s));
});

// ── API ────────────────────────────────────────────────────────────────

let base = '';
const app = createApp({ serveWeb: false });
before(async () => {
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  base = `http://localhost:${(app.address() as AddressInfo).port}`;
});
after(() => {
  app.close();
  setPublishFetch(null);
  globalThis.fetch = realFetch;
  rmSync(home, { recursive: true, force: true });
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

test('API: connections and keys, connect URL, callback pages — never a secret in any response or log', async () => {
  const logs: string[] = [];
  const orig = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = (...a: unknown[]) => void logs.push(a.map(String).join(' '));
  try {
    assert.equal((await api('/api/publish/linkedin', { method: 'PUT', json: { clientId: 'li-client-id', clientSecret: 'x y' } })).status, 400);
    const put = await api('/api/publish/linkedin', { method: 'PUT', json: { clientId: 'li-client-id', clientSecret: CLIENT_SECRET } });
    assert.equal(put.status, 200);
    assert.equal(put.body.linkedin.configured, true);
    assert.equal((await api('/api/publish/youtube', { method: 'PUT', json: { clientId: 'yt-client.apps.googleusercontent.com', clientSecret: CLIENT_SECRET } })).status, 200);
    const conn = await api('/api/publish/connections');
    assert.deepEqual(Object.keys(conn.body).sort(), ['linkedin', 'postiz', 'youtube']);
    const go = await api('/api/publish/youtube/connect');
    const u = new URL(go.body.url);
    assert.equal(u.searchParams.get('redirect_uri'), `${base}/oauth/youtube/callback`);
    assert.equal(u.searchParams.get('access_type'), 'offline');
    assert.equal(u.searchParams.get('scope'), 'https://www.googleapis.com/auth/youtube.upload');
    assert.equal((await api('/api/publish/nope/connect')).status, 404);

    // A forged callback is refused with a page, not a stack.
    const bad = await api('/oauth/youtube/callback?state=forged&code=abc');
    assert.equal(bad.status, 400);
    assert.match(bad.text, /Not connected/);
    // The real one connects; Google's answer (with tokens) is stored, never shown.
    use([/^POST https:\/\/oauth2\.googleapis\.com\/token$/, () => jsonRes({ access_token: YT_ACCESS, refresh_token: YT_REFRESH, expires_in: 3599 })]);
    const good = await api(`/oauth/youtube/callback?state=${u.searchParams.get('state')}&code=abc`);
    assert.equal(good.status, 200);
    assert.match(good.text, /Connected — you can close this tab/);
    assert.equal(new URLSearchParams(calls[0].body).get('redirect_uri'), `${base}/oauth/youtube/callback`);
    assert.equal((await api('/api/publish/connections')).body.youtube.connected, true);

    // A provider error that echoes a token comes back masked.
    const li = await api('/api/publish/linkedin/connect');
    use([/accessToken/, () => jsonRes({ error: 'invalid_grant', error_description: `bad code for ${CLIENT_SECRET}` }, 400)]);
    const echoed = await api(`/oauth/linkedin/callback?state=${new URL(li.body.url).searchParams.get('state')}&code=abc`);
    assert.equal(echoed.status, 400);
    assert.match(echoed.text, /\*\*\*/);

    // Postiz: verified by listing channels before it is saved.
    use(...postizRoutes());
    assert.equal((await api('/api/publish/postiz', { method: 'PUT', json: { url: POSTIZ, apiKey: 'wrong' } })).status, 400);
    const pz = await api('/api/publish/postiz', { method: 'PUT', json: { url: POSTIZ, apiKey: POSTIZ_KEY } });
    assert.equal(pz.status, 200);
    assert.equal(pz.body.integrations.length, 5);
    assert.equal(pz.body.postiz.url, POSTIZ);
    assert.equal((await api('/api/publish/postiz/integrations')).body[0].identifier, 'linkedin');

    // A failing send whose error carries the token: stored, logged and returned masked.
    await linkedinConnected();
    for (const p of await listPosts()) await deletePost(p.id);
    const p = await savePost({ title: 'Leak test', status: 'scheduled', at: new Date(Date.now() - 1000).toISOString(), tz: 'UTC', channels: [ch({ state: 'pending' })] });
    await runPublisher({ notify: async (t, m) => void logs.push(`${t} ${m}`), adapter: () => ({ send: async () => Promise.reject(new PublishError(`rejected Bearer ${LI_TOKEN} and key ${POSTIZ_KEY}`, true)) }) });
    const stored = (await api(`/api/calendar/posts`)).body.find((x: any) => x.id === p.id);
    assert.equal(stored.channels[0].state, 'failed');
    assert.match(stored.channels[0].error, /\*\*\*/);

    assert.equal((await api('/api/publish/linkedin', { method: 'DELETE' })).body.linkedin.connected, false);
    assert.equal((await api('/api/publish/postiz', { method: 'DELETE' })).body.postiz.configured, false);
  } finally {
    Object.assign(console, orig);
  }
  const everything = [...seen, ...logs, readFileSync(join(home, 'calendar', 'posts.json'), 'utf8')].join('\n');
  for (const s of SECRETS) assert.ok(!everything.includes(s), `a secret leaked: ${s.slice(0, 8)}…`);
  // …and they are in the secrets store where they belong.
  assert.ok(readFileSync(join(home, 'secrets.json'), 'utf8').includes(CLIENT_SECRET));
});

test('API: mark sent, send now, post kit zip, publishingPaused setting', async () => {
  for (const p of await listPosts()) await deletePost(p.id);
  const draft = await savePost({ title: 'Kit post', status: 'ready', at: future(), tz: 'UTC', channels: [ch({ via: 'manual', media: [rel('a.png'), rel('deck.pdf')], firstComment: 'First!' })] });
  assert.equal((await api(`/api/calendar/posts/${draft.id}/send-now`, { method: 'POST' })).status, 400);

  const res = await fetch(`${base}/api/calendar/posts/${draft.id}/kit/linkedin`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/zip');
  const zip = join(home, 'kit.zip');
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  const listing = execFileSync('unzip', ['-l', zip], { encoding: 'utf8' });
  for (const f of ['caption.txt', 'first-comment.txt', 'hashtags.txt', 'README.txt', '01-a.png', '02-deck.pdf']) assert.match(listing, new RegExp(f.replace('.', '\\.')));
  const caption = execFileSync('unzip', ['-p', zip, 'caption.txt'], { encoding: 'utf8' });
  assert.equal(caption, 'We shipped (finally) — 2x faster #builds\n\n#shipcast #devtools\n');
  assert.equal((await api(`/api/calendar/posts/${draft.id}/kit/youtube`)).status, 404);

  const sched = await api(`/api/calendar/posts/${draft.id}`, { method: 'PUT', json: { status: 'scheduled' } });
  assert.equal(sched.status, 200);
  assert.equal(sched.body.channels[0].state, 'pending');
  const now = await api(`/api/calendar/posts/${draft.id}/send-now`, { method: 'POST' });
  assert.equal(now.status, 200);
  assert.ok(Date.parse(now.body.post.at) <= Date.now());
  assert.equal(now.body.post.channels[0].state, 'pending');

  assert.equal((await api(`/api/calendar/posts/${draft.id}/channels/linkedin/sent`, { method: 'POST', json: { url: 'javascript:alert(1)' } })).status, 400);
  const sent = await api(`/api/calendar/posts/${draft.id}/channels/linkedin/sent`, { method: 'POST', json: { url: 'https://www.linkedin.com/feed/update/urn:li:share:1/' } });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.status, 'published');
  assert.equal(sent.body.channels[0].url, 'https://www.linkedin.com/feed/update/urn:li:share:1/');
  assert.equal((await api(`/api/calendar/posts/${draft.id}/channels/x/sent`, { method: 'POST', json: {} })).status, 404);

  assert.equal((await api('/api/settings', { method: 'PUT', json: { publishingPaused: true } })).body.publishingPaused, true);
  assert.equal((await api('/api/settings')).body.publishingPaused, true);
  await api('/api/settings', { method: 'PUT', json: { publishingPaused: false } });
});
