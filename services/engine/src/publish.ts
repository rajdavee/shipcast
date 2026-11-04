import { randomBytes } from 'node:crypto';
import { createReadStream, realpathSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, extname, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { channel as channelInfo, claimChannel, listPosts, savePost, updateChannel, type ChannelId, type Post, type PostChannel, type PublishVia } from './calendar.ts';
import { notifyDesktop } from './hub.ts';
import { home } from './paths.ts';
import { readSettings } from './store.ts';
import { tagChannel } from './utm.ts';
import { getSecret, setSecret } from './voices.ts';

/**
 * Publishing: each post channel goes out one of three ways — a manual post
 * kit plus a reminder, a direct connection with the user's own LinkedIn or
 * Google app, or the user's self-hosted Postiz (plain HTTP to its public API;
 * none of its code is used). Tokens and keys live only in secrets.json and
 * are never logged, returned or put into errors.
 */

export interface SendResult {
  url?: string;
  id?: string;
  note?: string;
}
export interface Adapter {
  send(post: Post, channel: PostChannel, files: string[]): Promise<SendResult>;
}

/** An error retrying won't fix (not connected, unsupported media): fail at once instead of three times. */
export class PublishError extends Error {
  permanent: boolean;
  constructor(message: string, permanent = false) {
    super(message);
    this.permanent = permanent;
  }
}

// Swappable for tests, which must never reach the network.
let http: typeof fetch = (input, init) => fetch(input, init);
export function setPublishFetch(f: typeof fetch | null) {
  http = f ?? ((input, init) => fetch(input, init));
}
/** The same swappable fetch, for the collectors that read numbers back over these connections. */
export const providerFetch: typeof fetch = (input, init) => http(input, init);

const SECRET = { linkedinClient: 'publish.linkedin.client', linkedinToken: 'publish.linkedin.token', youtubeClient: 'publish.youtube.client', youtubeToken: 'publish.youtube.token', postiz: 'publish.postiz', googleToken: 'site.google.token' };

async function secretJson<T>(name: string): Promise<T | undefined> {
  const raw = await getSecret(name);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}
const saveSecretJson = (name: string, v: unknown) => setSecret(name, v === null ? null : JSON.stringify(v));

interface ClientKeys {
  id: string;
  secret: string;
}
interface LinkedinToken {
  access: string;
  expiresAt: string;
  sub: string;
  name?: string;
}
interface YoutubeToken {
  access: string;
  refresh?: string;
  expiresAt: string;
  /** Scopes Google granted (space-separated); absent on connections made before stats were read. */
  scope?: string;
}
export interface PostizConfig {
  url: string;
  key: string;
}

/** Strip every stored credential (and anything token-shaped) from text bound for errors, logs or the UI. */
export async function redactSecrets(text: string): Promise<string> {
  const vals: string[] = [];
  const add = (v?: string) => v && v.length >= 6 && vals.push(v);
  const li = await secretJson<LinkedinToken>(SECRET.linkedinToken);
  const yt = await secretJson<YoutubeToken>(SECRET.youtubeToken);
  add(li?.access), add(yt?.access), add(yt?.refresh);
  add((await secretJson<ClientKeys>(SECRET.linkedinClient))?.secret);
  add((await secretJson<ClientKeys>(SECRET.youtubeClient))?.secret);
  add((await secretJson<PostizConfig>(SECRET.postiz))?.key);
  const g = await secretJson<YoutubeToken>(SECRET.googleToken);
  add(g?.access), add(g?.refresh);
  let out = text;
  for (const v of vals) out = out.split(v).join('***');
  return out.replace(/(Bearer|access_token|refresh_token|client_secret)(["':=\s]+)[\w.~+/-]{8,}/gi, '$1$2***').slice(0, 400);
}

/** A readable error from a provider's response body (message fields only, cut short). */
async function failure(name: string, r: Response, what: string): Promise<PublishError> {
  let detail = '';
  try {
    const t = await r.text();
    try {
      const j = JSON.parse(t);
      detail = String(j.message ?? j.error?.message ?? j.error_description ?? j.error ?? '').slice(0, 200);
    } catch {
      detail = t.slice(0, 200);
    }
  } catch {}
  // 4xx other than rate limits and timeouts means the request itself is wrong; trying again won't help.
  const permanent = r.status >= 400 && r.status < 500 && r.status !== 429 && r.status !== 408;
  return new PublishError(`${name} ${what} failed (${r.status})${detail ? `: ${detail}` : ''}`, permanent);
}

export const providerFailure = failure;

// ── media and copy ─────────────────────────────────────────────────────

const MEDIA_EXT = /\.(png|jpe?g|gif|webp|mp4|mov|webm|pdf)$/i;
export const isImage = (f: string) => /\.(png|jpe?g|gif|webp)$/i.test(f);
export const isVideo = (f: string) => /\.(mp4|mov|webm)$/i.test(f);
export const isPdf = (f: string) => /\.pdf$/i.test(f);
const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.pdf': 'application/pdf' };
const mime = (f: string) => MIME[extname(f).toLowerCase()] ?? 'application/octet-stream';

/**
 * A channel's media as absolute paths. Only media files inside the Shipcast
 * home are ever uploaded or zipped — a post can't be pointed at an arbitrary
 * file on the machine and have it published.
 */
export function mediaFiles(c: PostChannel): string[] {
  const root = realpathSync(home());
  return c.media.map((m) => {
    const abs = resolve(root, m);
    let real: string;
    try {
      real = realpathSync(abs);
      if (!statSync(real).isFile()) throw new Error();
    } catch {
      throw new PublishError(`Media file missing: ${basename(m)}`, true);
    }
    if (!real.startsWith(root + sep) || !MEDIA_EXT.test(real)) throw new PublishError(`Not a publishable media file: ${basename(m)}`, true);
    return real;
  });
}

/** Caption, a blank line, then the hashtags — what every platform gets as the post text. */
export const fullCaption = (c: PostChannel) => [c.caption.trim(), c.hashtags.join(' ')].filter(Boolean).join('\n\n');
const nameOf = (ch: ChannelId) => channelInfo(ch)?.name ?? ch;

// ── OAuth (LinkedIn, Google) ───────────────────────────────────────────

/** "google" is the website connection (Analytics + Search Console, read-only); it shares the YouTube Google app. */
export type OAuthProvider = 'linkedin' | 'youtube' | 'google';
export const OAUTH_PROVIDERS: OAuthProvider[] = ['linkedin', 'youtube', 'google'];
export const PROVIDER_NAMES: Record<OAuthProvider, string> = { linkedin: 'LinkedIn', youtube: 'YouTube', google: 'Google Analytics and Search Console' };

const OAUTH = {
  linkedin: { authorize: 'https://www.linkedin.com/oauth/v2/authorization', token: 'https://www.linkedin.com/oauth/v2/accessToken', scope: 'openid profile w_member_social', client: SECRET.linkedinClient, extra: {} as Record<string, string> },
  youtube: { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly', client: SECRET.youtubeClient, extra: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' } as Record<string, string> },
  google: { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', scope: 'https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly', client: SECRET.youtubeClient, extra: { access_type: 'offline', prompt: 'consent' } as Record<string, string> },
};

// In memory on purpose: a restart simply means clicking Connect again.
const pending = new Map<string, { provider: OAuthProvider; redirect: string; expires: number }>();
const STATE_TTL = 10 * 60_000;

export const redirectUri = (provider: OAuthProvider, port: number) => `http://localhost:${port}/oauth/${provider}/callback`;

export async function saveClientKeys(provider: OAuthProvider, id: string, secret: string): Promise<void> {
  if (!/^[\w.\-]{4,200}$/.test(id) || secret.length < 4 || secret.length > 500 || /\s/.test(secret)) throw new PublishError('Enter the client ID and client secret from your app.', true);
  await saveSecretJson(OAUTH[provider].client, { id, secret });
}

/** The URL that starts the authorization-code flow; the state token is single-use and expires in 10 minutes. */
export async function oauthStart(provider: OAuthProvider, port: number, now = Date.now()): Promise<{ url: string; redirect: string }> {
  const keys = await secretJson<ClientKeys>(OAUTH[provider].client);
  if (!keys) throw new PublishError(`Add your ${provider === 'linkedin' ? 'LinkedIn' : 'Google'} app's client ID and secret first.`, true);
  for (const [k, v] of pending) if (v.expires < now) pending.delete(k);
  const state = randomBytes(24).toString('base64url');
  const redirect = redirectUri(provider, port);
  pending.set(state, { provider, redirect, expires: now + STATE_TTL });
  const q = new URLSearchParams({ response_type: 'code', client_id: keys.id, redirect_uri: redirect, scope: OAUTH[provider].scope, state, ...OAUTH[provider].extra });
  return { url: `${OAUTH[provider].authorize}?${q}`, redirect };
}

/** Finish the flow: check the state, swap the code for tokens, store them. Returns the account name when known. */
export async function oauthFinish(provider: OAuthProvider, state: string, code: string, now = Date.now()): Promise<{ account?: string }> {
  const st = pending.get(state);
  if (st) pending.delete(state);
  if (!st || st.provider !== provider || st.expires < now) throw new PublishError('This sign-in link expired or was not started here. Go back to Shipcast and click Connect again.', true);
  if (!code) throw new PublishError('No authorization code came back.', true);
  const keys = await secretJson<ClientKeys>(OAUTH[provider].client);
  if (!keys) throw new PublishError('The app keys were removed; add them again.', true);
  const r = await http(OAUTH[provider].token, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: st.redirect, client_id: keys.id, client_secret: keys.secret }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw await failure(provider === 'linkedin' ? 'LinkedIn' : 'Google', r, 'sign-in');
  const tok = (await r.json()) as { access_token?: string; expires_in?: number; refresh_token?: string; scope?: string };
  if (!tok.access_token) throw new PublishError('No access token came back.', true);
  const expiresAt = new Date(now + (Number(tok.expires_in) || 3600) * 1000).toISOString();
  if (provider === 'linkedin') {
    const me = await http('https://api.linkedin.com/v2/userinfo', { headers: { authorization: `Bearer ${tok.access_token}` }, signal: AbortSignal.timeout(15_000) });
    if (!me.ok) throw await failure('LinkedIn', me, 'profile lookup');
    const u = (await me.json()) as { sub?: string; name?: string };
    if (!u.sub) throw new PublishError('LinkedIn did not return your member id.', true);
    await saveSecretJson(SECRET.linkedinToken, { access: tok.access_token, expiresAt, sub: u.sub, name: u.name } satisfies LinkedinToken);
    return { account: u.name };
  }
  // Google only sends a refresh token on first consent; keep the old one if this grant has none.
  const slot = provider === 'google' ? SECRET.googleToken : SECRET.youtubeToken;
  const old = await secretJson<YoutubeToken>(slot);
  await saveSecretJson(slot, { access: tok.access_token, refresh: tok.refresh_token ?? old?.refresh, expiresAt, ...(tok.scope ? { scope: tok.scope } : {}) } satisfies YoutubeToken);
  return {};
}

/** Forget a connection (and with `keys`, the app's client ID/secret too). */
export async function disconnect(provider: OAuthProvider | 'postiz', keys = false): Promise<void> {
  if (provider === 'postiz') return setSecret(SECRET.postiz, null);
  await setSecret(provider === 'linkedin' ? SECRET.linkedinToken : provider === 'google' ? SECRET.googleToken : SECRET.youtubeToken, null);
  if (keys) await setSecret(OAUTH[provider].client, null);
}

/** What is set up, never the secrets themselves. */
export async function connections(now = Date.now()) {
  const li = await secretJson<LinkedinToken>(SECRET.linkedinToken);
  const yt = await secretJson<YoutubeToken>(SECRET.youtubeToken);
  const pz = await secretJson<PostizConfig>(SECRET.postiz);
  const gs = await secretJson<YoutubeToken>(SECRET.googleToken);
  return {
    linkedin: { configured: !!(await getSecret(SECRET.linkedinClient)), connected: !!li && Date.parse(li.expiresAt) > now, expired: !!li && Date.parse(li.expiresAt) <= now, account: li?.name ?? null, expiresAt: li?.expiresAt ?? null },
    youtube: { configured: !!(await getSecret(SECRET.youtubeClient)), connected: !!yt && (!!yt.refresh || Date.parse(yt.expiresAt) > now), stats: youtubeStatsAccess(yt), note: 'Uploads from a Google project that has not passed its audit are kept private by YouTube.' },
    postiz: { configured: !!pz, url: pz?.url ?? null, note: 'Postiz posts at the scheduled time; Shipcast marks the channel sent once Postiz accepts it.' },
    google: { configured: !!(await getSecret(SECRET.youtubeClient)), connected: !!gs && (!!gs.refresh || Date.parse(gs.expiresAt) > now), note: 'Read-only: website visits and key events (Google Analytics) and search clicks (Search Console). Uses the same Google app as YouTube.' },
  };
}

/** Can this YouTube connection read numbers back? Connections made before stats were added lack the read scopes. */
function youtubeStatsAccess(t?: YoutubeToken): { stats: boolean; analytics: boolean; needsReconnect: boolean } {
  const has = (s: string) => !!t?.scope?.split(/[\s,]+/).includes(`https://www.googleapis.com/auth/${s}`);
  const stats = has('youtube.readonly') || has('youtube');
  return { stats, analytics: has('yt-analytics.readonly'), needsReconnect: !!t && !stats };
}
export const youtubeStats = async () => youtubeStatsAccess(await secretJson<YoutubeToken>(SECRET.youtubeToken));

// ── LinkedIn (personal profile, Share on LinkedIn) ──────────────────────

const LI = 'https://api.linkedin.com/rest';
const liHeaders = (token: string) => ({ authorization: `Bearer ${token}`, 'LinkedIn-Version': '202608', 'X-Restli-Protocol-Version': '2.0.0', 'content-type': 'application/json' });

/** LinkedIn's "little text" treats these characters as markup; plain text must escape them. */
export const liEscape = (s: string) => s.replace(/[\\|{}@[\]()<>#*_~]/g, (m) => `\\${m}`);
export function liCommentary(c: PostChannel): string {
  // A tag the hashtag template can't hold (e.g. "#dev-tools") still goes out, as plain escaped text.
  const tags = c.hashtags.map((h) => h.replace(/^#/, '')).map((t) => (/^[\p{L}\p{N}_]+$/u.test(t) ? `{hashtag|\\#|${t}}` : liEscape(`#${t}`)));
  return [liEscape(c.caption.trim()), tags.join(' ')].filter(Boolean).join('\n\n');
}

async function linkedinToken(): Promise<LinkedinToken> {
  const t = await secretJson<LinkedinToken>(SECRET.linkedinToken);
  if (!t) throw new PublishError('LinkedIn is not connected — connect it in Settings → Connections, or post this one by hand.', true);
  // Self-serve apps get no refresh token: after ~60 days the member signs in again.
  if (Date.parse(t.expiresAt) <= Date.now() + 60_000) throw new PublishError('The LinkedIn connection expired — reconnect it in Settings → Connections.', true);
  return t;
}

async function liUpload(kind: 'images' | 'documents', file: string, t: LinkedinToken): Promise<string> {
  const r = await http(`${LI}/${kind}?action=initializeUpload`, { method: 'POST', headers: liHeaders(t.access), body: JSON.stringify({ initializeUploadRequest: { owner: `urn:li:person:${t.sub}` } }), signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw await failure('LinkedIn', r, `${kind === 'images' ? 'image' : 'document'} upload setup`);
  const v = ((await r.json()) as { value?: { uploadUrl?: string; image?: string; document?: string } }).value;
  const urn = kind === 'images' ? v?.image : v?.document;
  if (!v?.uploadUrl || !urn) throw new PublishError('LinkedIn did not return an upload address.');
  const put = await http(v.uploadUrl, { method: 'PUT', headers: { authorization: `Bearer ${t.access}`, 'content-type': 'application/octet-stream' }, body: await readFile(file), signal: AbortSignal.timeout(300_000) });
  if (!put.ok) throw await failure('LinkedIn', put, `${basename(file)} upload`);
  return urn;
}

export const linkedinAdapter: Adapter = {
  async send(post, c, files) {
    const t = await linkedinToken();
    if (files.some(isVideo)) throw new PublishError('Direct LinkedIn posting here covers text, images and PDF documents. For a video, post it by hand (download the post kit) or send it through Postiz.', true);
    const pdfs = files.filter(isPdf);
    const images = files.filter(isImage);
    if (pdfs.length > 1 || (pdfs.length && images.length)) throw new PublishError('LinkedIn takes one PDF document or images in a post, not both.', true);
    if (images.length > 20) throw new PublishError('LinkedIn takes up to 20 images in a post.', true);
    let content: unknown;
    if (pdfs.length) content = { media: { id: await liUpload('documents', pdfs[0], t), title: (c.title || post.title).slice(0, 200) } };
    else if (images.length === 1) content = { media: { id: await liUpload('images', images[0], t) } };
    else if (images.length > 1) {
      const ids = [];
      for (const f of images) ids.push(await liUpload('images', f, t));
      content = { multiImage: { images: ids.map((id) => ({ id })) } };
    }
    const body = {
      author: `urn:li:person:${t.sub}`,
      commentary: liCommentary(c),
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      ...(content ? { content } : {}),
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };
    const r = await http(`${LI}/posts`, { method: 'POST', headers: liHeaders(t.access), body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw await failure('LinkedIn', r, 'post');
    const urn = r.headers.get('x-restli-id') ?? '';
    const out: SendResult = { id: urn || undefined, url: urn ? `https://www.linkedin.com/feed/update/${urn}/` : undefined };
    if (c.firstComment?.trim() && urn) {
      // Best-effort: the post is already live, so a failed comment only leaves a note.
      try {
        const cr = await http(`${LI}/socialActions/${encodeURIComponent(urn)}/comments`, { method: 'POST', headers: liHeaders(t.access), body: JSON.stringify({ actor: `urn:li:person:${t.sub}`, object: urn, message: { text: c.firstComment.trim() } }), signal: AbortSignal.timeout(30_000) });
        if (!cr.ok) out.note = `Posted, but the first comment failed (${cr.status}) — add it by hand.`;
      } catch {
        out.note = 'Posted, but the first comment failed — add it by hand.';
      }
    }
    return out;
  },
};

// ── YouTube (Data API videos.insert, resumable) ────────────────────────

export async function youtubeAccess(): Promise<string> {
  const t = await secretJson<YoutubeToken>(SECRET.youtubeToken);
  if (!t) throw new PublishError('YouTube is not connected — connect it in Settings → Connections, or upload this one by hand.', true);
  if (Date.parse(t.expiresAt) > Date.now() + 60_000) return t.access;
  const keys = await secretJson<ClientKeys>(SECRET.youtubeClient);
  if (!t.refresh || !keys) throw new PublishError('The YouTube connection expired — reconnect it in Settings → Connections.', true);
  const r = await http(OAUTH.youtube.token, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: keys.id, client_secret: keys.secret }),
    signal: AbortSignal.timeout(20_000),
  });
  if (r.status === 400 || r.status === 401) throw new PublishError('Google no longer accepts the YouTube connection — reconnect it in Settings → Connections.', true);
  if (!r.ok) throw await failure('Google', r, 'token refresh');
  const tok = (await r.json()) as { access_token?: string; expires_in?: number; refresh_token?: string; scope?: string };
  if (!tok.access_token) throw new PublishError('Google did not return an access token.');
  await saveSecretJson(SECRET.youtubeToken, { access: tok.access_token, refresh: tok.refresh_token ?? t.refresh, expiresAt: new Date(Date.now() + (Number(tok.expires_in) || 3600) * 1000).toISOString(), scope: tok.scope ?? t.scope } satisfies YoutubeToken);
  return tok.access_token;
}

/** A fresh access token for the website connection; concurrent callers share one refresh (per workspace). */
const siteRefresh = new Map<string, Promise<string>>();
export function googleSiteAccess(): Promise<string> {
  const key = home();
  const cur = siteRefresh.get(key);
  if (cur) return cur;
  const p = googleSiteAccessOnce().finally(() => siteRefresh.delete(key));
  siteRefresh.set(key, p);
  return p;
}
async function googleSiteAccessOnce(): Promise<string> {
  const t = await secretJson<YoutubeToken>(SECRET.googleToken);
  if (!t) throw new PublishError('Google Analytics is not connected — connect it in Settings → Website.', true);
  if (Date.parse(t.expiresAt) > Date.now() + 60_000) return t.access;
  const keys = await secretJson<ClientKeys>(SECRET.youtubeClient);
  if (!t.refresh || !keys) throw new PublishError('The Google Analytics connection expired — reconnect it in Settings → Website.', true);
  const r = await http(OAUTH.google.token, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: keys.id, client_secret: keys.secret }),
    signal: AbortSignal.timeout(20_000),
  });
  if (r.status === 400 || r.status === 401) throw new PublishError('Google no longer accepts the website connection — reconnect it in Settings → Website.', true);
  if (!r.ok) throw await failure('Google', r, 'token refresh');
  const tok = (await r.json()) as { access_token?: string; expires_in?: number; refresh_token?: string; scope?: string };
  if (!tok.access_token) throw new PublishError('Google did not return an access token.');
  await saveSecretJson(SECRET.googleToken, { access: tok.access_token, refresh: tok.refresh_token ?? t.refresh, expiresAt: new Date(Date.now() + (Number(tok.expires_in) || 3600) * 1000).toISOString(), scope: tok.scope ?? t.scope } satisfies YoutubeToken);
  return tok.access_token;
}
export const googleSiteConnected = async () => !!(await secretJson<YoutubeToken>(SECRET.googleToken));

// YouTube rejects angle brackets in titles and descriptions.
const ytText = (s: string, max: number) => s.replace(/[<>]/g, '').slice(0, max);

export const youtubeAdapter: Adapter = {
  async send(post, c, files) {
    const video = files.find(isVideo);
    if (!video) throw new PublishError('YouTube needs a video file on this channel.', true);
    const access = await youtubeAccess();
    const size = statSync(video).size;
    const meta = {
      snippet: { title: ytText((c.title || post.title).trim(), 100), description: ytText(fullCaption(c), 5000), tags: c.hashtags.map((h) => h.replace(/^#/, '')).slice(0, 15), categoryId: '22' },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
    };
    const init = await http('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
      method: 'POST',
      headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-length': String(size), 'x-upload-content-type': mime(video) },
      body: JSON.stringify(meta),
      signal: AbortSignal.timeout(30_000),
    });
    if (!init.ok) throw await failure('YouTube', init, 'upload setup');
    const session = init.headers.get('location');
    if (!session) throw new PublishError('YouTube did not return an upload address.');
    const put = await http(session, {
      method: 'PUT',
      headers: { 'content-type': mime(video), 'content-length': String(size) },
      body: Readable.toWeb(createReadStream(video)) as unknown as BodyInit,
      duplex: 'half',
      signal: AbortSignal.timeout(60 * 60_000),
    } as RequestInit);
    if (!put.ok) throw await failure('YouTube', put, 'upload');
    const v = (await put.json()) as { id?: string; status?: { privacyStatus?: string } };
    if (!v.id) throw new PublishError('YouTube did not return a video id.');
    const kept = v.status?.privacyStatus && v.status.privacyStatus !== 'public';
    return { id: v.id, url: `https://youtu.be/${v.id}`, note: kept ? `YouTube set this video to ${v.status!.privacyStatus}: uploads from a Google project that hasn't passed Google's audit stay private. Make it public in YouTube Studio.` : undefined };
  },
};

// ── Postiz (the user's own instance, public API over HTTP) ──────────────

/** Accepts the instance's address in any common form and returns its public-API base. */
export function postizBase(url: string): string {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    throw new PublishError('Enter your Postiz address, like http://localhost:4007 or https://postiz.example.com', true);
  }
  if (!/^https?:$/.test(u.protocol)) throw new PublishError('The Postiz address must start with http:// or https://', true);
  const path = u.pathname.replace(/\/+$/, '');
  if (/\/public\/v1$/.test(path)) return `${u.origin}${path}`;
  // Postiz Cloud serves the API on its own host; a self-hosted instance under /api.
  return u.hostname === 'api.postiz.com' ? `${u.origin}/public/v1` : `${u.origin}${path.replace(/\/api$/, '')}/api/public/v1`;
}

export interface PostizIntegration {
  id: string;
  name: string;
  identifier: string;
  profile?: string;
  disabled?: boolean;
  picture?: string;
}

export async function postizConfig(): Promise<PostizConfig> {
  const c = await secretJson<PostizConfig>(SECRET.postiz);
  if (!c) throw new PublishError('Postiz is not set up — add its address and API key in Settings → Connections.', true);
  return c;
}

export async function postizIntegrations(cfg?: PostizConfig): Promise<PostizIntegration[]> {
  const c = cfg ?? (await postizConfig());
  const r = await http(`${postizBase(c.url)}/integrations`, { headers: { authorization: c.key }, signal: AbortSignal.timeout(15_000) });
  if (r.status === 401) throw new PublishError('Postiz rejected that API key.', true);
  if (!r.ok) throw await failure('Postiz', r, 'channel list');
  const list = (await r.json()) as PostizIntegration[];
  if (!Array.isArray(list)) throw new PublishError('That address did not answer like a Postiz API.', true);
  return list.map((i) => ({ id: String(i.id), name: String(i.name ?? ''), identifier: String(i.identifier ?? ''), ...(i.profile ? { profile: String(i.profile) } : {}), disabled: !!i.disabled, ...(i.picture ? { picture: String(i.picture) } : {}) }));
}

/** Check the address and key by listing channels, then store them. */
export async function savePostiz(url: string, key: string): Promise<PostizIntegration[]> {
  const cfg = { url: url.trim().replace(/\/+$/, ''), key: key.trim() };
  if (!cfg.key) throw new PublishError('Enter your Postiz API key (Postiz → Settings → Public API).', true);
  postizBase(cfg.url);
  const list = await postizIntegrations(cfg);
  await saveSecretJson(SECRET.postiz, cfg);
  return list;
}

/** Postiz provider identifiers per calendar channel. */
export const POSTIZ_PROVIDERS: Partial<Record<ChannelId, string[]>> = { linkedin: ['linkedin', 'linkedin-page'], instagram: ['instagram', 'instagram-standalone'], youtube: ['youtube'], x: ['x'], tiktok: ['tiktok'], threads: ['threads'], facebook: ['facebook'], pinterest: ['pinterest'] };

const norm = (s = '') => s.trim().replace(/^@/, '').toLowerCase();
/** The Postiz channel a post channel goes to: by provider, then by account name or handle when there are several. */
export function matchIntegration(list: PostizIntegration[], c: PostChannel): PostizIntegration {
  const ids = POSTIZ_PROVIDERS[c.channel] ?? [];
  const live = list.filter((i) => ids.includes(i.identifier) && !i.disabled);
  const name = nameOf(c.channel);
  if (!live.length) throw new PublishError(`No ${name} channel is connected in Postiz.`, true);
  if (c.account) {
    const hit = live.filter((i) => norm(i.name) === norm(c.account) || norm(i.profile) === norm(c.account));
    if (hit.length === 1) return hit[0];
    throw new PublishError(`No single ${name} channel in Postiz matches "${c.account}".`, true);
  }
  if (live.length > 1) throw new PublishError(`Postiz has ${live.length} ${name} channels — set the account on this post to pick one (${live.map((i) => i.profile || i.name).join(', ')}).`, true);
  return live[0];
}

function postizSettings(identifier: string, post: Post, c: PostChannel, media: number): Record<string, unknown> {
  switch (identifier) {
    case 'x':
      return { __type: 'x', who_can_reply_post: 'everyone' };
    case 'linkedin':
    case 'linkedin-page':
      return { __type: identifier, post_as_images_carousel: media > 1 };
    case 'instagram':
    case 'instagram-standalone':
      return { __type: identifier, post_type: 'post', collaborators: [] };
    case 'youtube':
      return { __type: 'youtube', title: ytText((c.title || post.title).trim(), 100), type: 'public', selfDeclaredMadeForKids: 'no', tags: c.hashtags.map((h) => h.replace(/^#/, '')).slice(0, 15).map((t) => ({ value: t, label: t })) };
    case 'tiktok':
      return { __type: 'tiktok', privacy_level: 'PUBLIC_TO_EVERYONE', duet: false, stitch: false, comment: true, autoAddMusic: 'no', brand_content_toggle: false, brand_organic_toggle: false, content_posting_method: 'DIRECT_POST' };
    case 'pinterest':
      throw new PublishError('Pinterest through Postiz needs a board, which Shipcast does not pick yet — schedule this pin in Postiz or post it by hand.', true);
    default:
      return { __type: identifier };
  }
}

async function postizUpload(cfg: PostizConfig, file: string): Promise<{ id: string; path: string }> {
  const form = new FormData();
  form.append('file', new Blob([await readFile(file)], { type: mime(file) }), basename(file));
  const r = await http(`${postizBase(cfg.url)}/upload`, { method: 'POST', headers: { authorization: cfg.key }, body: form, signal: AbortSignal.timeout(600_000) });
  if (!r.ok) throw await failure('Postiz', r, `${basename(file)} upload`);
  const j = (await r.json()) as { id?: string; path?: string };
  if (!j.id || !j.path) throw new PublishError('Postiz did not return the uploaded file.');
  return { id: String(j.id), path: String(j.path) };
}

/** Postiz takes the post ahead of its time and publishes it itself, so a short lead keeps its own scheduler in charge of the minute. */
export const POSTIZ_LEAD_MS = 10 * 60_000;

export function postizAdapter(now: () => Date = () => new Date()): Adapter {
  return {
    async send(post, c, files) {
      const cfg = await postizConfig();
      if (files.some(isPdf)) throw new PublishError('Postiz does not accept PDF files — post the document carousel through direct LinkedIn or by hand.', true);
      const target = matchIntegration(await postizIntegrations(cfg), c);
      const settings = postizSettings(target.identifier, post, c, files.length);
      const image = [];
      for (const f of files) image.push(await postizUpload(cfg, f));
      const at = Date.parse(post.at ?? '');
      const future = at > now().getTime() + 60_000;
      // Extra items in `value` become comments under the first one (a thread on X).
      const value = [{ content: fullCaption(c), image }, ...(c.firstComment?.trim() ? [{ content: c.firstComment.trim(), image: [] }] : [])];
      const body = { type: future ? 'schedule' : 'now', date: new Date(future ? at : now().getTime()).toISOString(), shortLink: false, tags: [], posts: [{ integration: { id: target.id }, value, settings }] };
      const r = await http(`${postizBase(cfg.url)}/posts`, { method: 'POST', headers: { authorization: cfg.key, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
      if (!r.ok) throw await failure('Postiz', r, 'post');
      const out = (await r.json()) as { postId?: string }[];
      const id = Array.isArray(out) ? out[0]?.postId : undefined;
      return { id, note: future ? `Handed to Postiz, which posts it at ${new Date(at).toISOString().slice(11, 16)} UTC.` : 'Handed to Postiz to post now.' };
    },
  };
}

/** Take back a post Postiz is holding (it deletes the whole group); 404 means it's already gone. */
export async function postizWithdraw(id: string): Promise<void> {
  const cfg = await postizConfig();
  const r = await http(`${postizBase(cfg.url)}/posts/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { authorization: cfg.key }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok && r.status !== 404) throw await failure('Postiz', r, 'withdraw');
}

/**
 * Channels Postiz is holding for a time that hasn't come yet. When the post is moved, unscheduled or
 * deleted they are withdrawn there first, so Postiz never posts the old version at the old time.
 */
export const heldByPostiz = (p: Post, now = Date.now()) => p.channels.filter((c) => c.via === 'postiz' && c.state === 'sent' && c.remoteId && p.at && Date.parse(p.at) > now);

export function adapterFor(c: PostChannel, now?: () => Date): Adapter | undefined {
  if (c.via === 'postiz') return postizAdapter(now);
  if (c.via === 'direct' && c.channel === 'linkedin') return linkedinAdapter;
  if (c.via === 'direct' && c.channel === 'youtube') return youtubeAdapter;
  return undefined;
}

// ── the publisher loop ─────────────────────────────────────────────────

/** Gaps before the 2nd and 3rd tries: three attempts over ~15 minutes. */
export const RETRY_GAPS_MIN = [5, 10];
export const MAX_ATTEMPTS = RETRY_GAPS_MIN.length + 1;
/** Older than this (the Mac was asleep or off) and nothing is sent automatically: you get a reminder instead. */
export const MISSED_AFTER_MS = 6 * 60 * 60_000;
/** A send that has said nothing for this long was cut off (crash, restart). */
const STUCK_AFTER_MS = 30 * 60_000;

export interface PublisherDeps {
  now?: () => Date;
  notify?: (title: string, message: string) => Promise<void>;
  /** Pick the adapter for a channel (tests swap in fakes). */
  adapter?: (c: PostChannel) => Adapter | undefined;
  log?: (text: string) => void;
  /** Go through the motions without sending anything (also SHIPCAST_PUBLISH_DRY_RUN=1). */
  dryRun?: boolean;
}
export interface PublisherReport {
  skipped?: string;
  sent: string[];
  failed: string[];
  retrying: string[];
  due: string[];
}

let inFlight: Promise<PublisherReport> | null = null;

/** One publisher pass. If a pass is still going (a slow upload), the next tick returns at once instead of overlapping it. */
export function runPublisher(deps: PublisherDeps = {}): Promise<PublisherReport> {
  if (inFlight) return Promise.resolve({ skipped: 'A publishing pass is still running.', sent: [], failed: [], retrying: [], due: [] });
  inFlight = publishOnce(deps).finally(() => (inFlight = null));
  return inFlight;
}

async function publishOnce(deps: PublisherDeps): Promise<PublisherReport> {
  const clock = deps.now ?? (() => new Date());
  const notify = deps.notify ?? notifyDesktop;
  const log = deps.log ?? ((t: string) => console.log(`[publisher] ${t}`));
  const dryRun = deps.dryRun ?? process.env.SHIPCAST_PUBLISH_DRY_RUN === '1';
  const report: PublisherReport = { sent: [], failed: [], retrying: [], due: [] };
  if ((await readSettings()).publishingPaused) return { ...report, skipped: 'Publishing is paused.' };
  for (const post of await listPosts({ status: ['scheduled'] })) {
    const at = Date.parse(post.at ?? '');
    if (Number.isNaN(at)) continue;
    for (const c of post.channels) {
      const now = clock();
      const label = `${post.title} → ${nameOf(c.channel)}`;
      const mark = (patch: Partial<PostChannel>) => updateChannel(post.id, c.channel, patch, c.account);
      if (c.state === 'sending' && c.lastAttemptAt && now.getTime() - Date.parse(c.lastAttemptAt) > STUCK_AFTER_MS) {
        await mark({ state: 'due', error: `Sending was interrupted. Check ${nameOf(c.channel)} before posting again — it may already be up.` });
        await notify(`Check ${nameOf(c.channel)}: ${post.title}`, 'A send was interrupted; it may or may not have gone out.');
        report.due.push(label);
        continue;
      }
      // Only channels the scheduling step marked pending go out: never a sent, failed or untouched one.
      if (c.state !== 'pending') continue;
      const lead = c.via === 'postiz' ? POSTIZ_LEAD_MS : 0;
      if (now.getTime() < at - lead) continue;
      if (c.retryAt && now.getTime() < Date.parse(c.retryAt)) continue;
      if (now.getTime() - at > MISSED_AFTER_MS) {
        await mark({ state: 'due', retryAt: undefined, error: 'Missed its time (Shipcast was not running) — post it now or reschedule.' });
        await notify(`Missed post on ${nameOf(c.channel)}`, `${post.title} — it was due ${new Date(at).toLocaleString()}. Post it now or reschedule.`);
        report.due.push(label);
        continue;
      }
      const adapter = c.via === 'manual' ? undefined : (deps.adapter ?? ((x: PostChannel) => adapterFor(x, clock)))(c);
      if (!adapter) {
        await mark({ state: 'due', error: c.via === 'manual' ? undefined : `${nameOf(c.channel)} can't be posted ${c.via} — post it by hand.` });
        await notify(`Time to post on ${nameOf(c.channel)}: ${post.title}`, 'Open Shipcast for the post kit, then mark it posted.');
        report.due.push(label);
        continue;
      }
      const claimed = await claimChannel(post.id, c.channel, c.account, now);
      if (!claimed) continue;
      const tries = (claimed.channel.attempts ?? 0) + 1;
      try {
        const result = dryRun ? { note: 'Dry run — nothing was posted.' } : await adapter.send(claimed.post, await tagChannel(claimed.post.id, claimed.channel), mediaFiles(claimed.channel));
        await mark({ state: 'sent', url: result.url, remoteId: result.id, note: result.note, sentAt: clock().toISOString(), error: undefined, retryAt: undefined, attempts: tries });
        log(`${label}: sent`);
        report.sent.push(label);
      } catch (e) {
        const attempts = tries;
        const msg = await redactSecrets((e as Error).message || 'Unknown error');
        const permanent = e instanceof PublishError && e.permanent;
        if (permanent || attempts >= MAX_ATTEMPTS) {
          await mark({ state: 'failed', attempts, retryAt: undefined, error: msg });
          await notify(`Couldn't post on ${nameOf(c.channel)}`, `${post.title}: ${msg}`);
          log(`${label}: failed`);
          report.failed.push(label);
        } else {
          const retryAt = new Date(clock().getTime() + RETRY_GAPS_MIN[attempts - 1] * 60_000);
          await mark({ state: 'pending', attempts, retryAt: retryAt.toISOString(), error: `Attempt ${attempts} of ${MAX_ATTEMPTS} failed: ${msg} Trying again at ${retryAt.toISOString().slice(11, 16)} UTC.` });
          log(`${label}: attempt ${attempts} failed, retrying`);
          report.retrying.push(label);
        }
      }
    }
  }
  return report;
}

/** "Send now" on a scheduled post: its time becomes now and every channel not yet sent is queued for the next tick. */
export async function queueSendNow(post: Post, now = new Date()): Promise<Post> {
  if (post.status !== 'scheduled') throw new PublishError('Only a scheduled post can be sent now — schedule it first.', true);
  const channels = post.channels.map((c) => (c.state === 'sent' || c.state === 'sending' ? c : { ...c, state: 'pending' as const, attempts: undefined, retryAt: undefined, error: undefined }));
  return savePost({ id: post.id, at: now.toISOString(), channels });
}

// ── manual post kit ────────────────────────────────────────────────────

/** The text files of a post kit (the media files are added alongside). */
export function kitTexts(post: Post, c: PostChannel): Record<string, string> {
  const out: Record<string, string> = { 'caption.txt': fullCaption(c) + '\n' };
  if (c.title) out['title.txt'] = c.title + '\n';
  if (c.firstComment?.trim()) out['first-comment.txt'] = c.firstComment.trim() + '\n';
  if (c.hashtags.length) out['hashtags.txt'] = c.hashtags.join(' ') + '\n';
  const when = post.at ? new Date(post.at).toLocaleString('en-GB', { timeZone: post.tz, dateStyle: 'full', timeStyle: 'short' }) : 'not scheduled';
  out['README.txt'] = `${post.title}\n${nameOf(c.channel)} · ${when} (${post.tz})\n\n1. Upload the media files in order.\n2. Paste caption.txt.${c.firstComment ? '\n3. After posting, add first-comment.txt as the first comment.' : ''}\nThen mark it posted in Shipcast (paste the post's link if you like).\n`;
  return out;
}

export type { PublishVia };
