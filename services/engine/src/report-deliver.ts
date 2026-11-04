import { randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { readFile, rename, writeFile, mkdir } from 'node:fs/promises';
import { isIP, Socket, connect as netConnect } from 'node:net';
import { join } from 'node:path';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { readPlan } from './calendar.ts';
import { withDirLock } from './filelock.ts';
import { notifyDesktop } from './hub.ts';
import { localParts, zonedToUtc } from './calendar.ts';
import { reportsDir, type PeriodKind } from './report-facts.ts';
import { reportEmailHtml, reportMarkdown } from './report-html.ts';
import { createShare, reportPdf } from './report-out.ts';
import { currentContext } from './context.ts';
import { isInstallOwnerSync } from './claude-account.ts';
import { AUDIENCES, createReport, getReport, markReportSent, type Audience, type Report } from './report.ts';
import { readSettings } from './store.ts';
import { getSecret, setSecret } from './voices.ts';

/**
 * Getting the report to people: on a weekly or monthly schedule, by email
 * (Shipcast's own small SMTP client — STARTTLS or TLS, no dependency) and to
 * Slack, Microsoft Teams, Discord or any webhook. By default a scheduled
 * report waits for a person to look at it ("review first"); "send
 * automatically" skips that. Sends are capped and logged.
 */

// ── settings ───────────────────────────────────────────────────────────

export type WebhookKind = 'slack' | 'teams' | 'discord' | 'generic';
export interface Webhook {
  kind: WebhookKind;
  url: string;
}

export interface Schedule {
  enabled: boolean;
  kind: Exclude<PeriodKind, 'custom'>;
  audience: Audience;
  /** 0 = Sunday … 6 = Saturday (weekly kinds); monthly and quarterly go out on the first such weekday of the month. */
  weekday: number;
  /** Local time in the content plan's zone. */
  time: string;
  mode: 'review' | 'auto';
  emails: string[];
  webhooks: Webhook[];
  /** Attach the PDF to emails. */
  attachPdf: boolean;
  lastRun?: string;
  /** The day the "numbers missing" reminder went out (one per period). */
  lastNudge?: string;
}

export const DEFAULT_SCHEDULE: Schedule = { enabled: false, kind: 'last7', audience: 'team', weekday: 5, time: '16:00', mode: 'review', emails: [], webhooks: [], attachPdf: true };

const EMAIL_RE = /^[^\s@<>()",;:]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,}$/i;

let chain: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = async () => {
    await mkdir(reportsDir(), { recursive: true });
    return withDirLock(reportsDir(), fn);
  };
  const next = chain.then(run, run);
  chain = next.catch(() => {});
  return next;
};
async function readJson<T>(f: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(f, 'utf8'));
  } catch {
    return fallback;
  }
}
async function writeJson(f: string, data: unknown) {
  const tmp = `${f}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(data));
  await rename(tmp, f);
}

const scheduleFile = () => join(reportsDir(), 'schedule.json');
export const readSchedule = async (): Promise<Schedule> => ({ ...DEFAULT_SCHEDULE, ...(await readJson<Partial<Schedule>>(scheduleFile(), {})) });

const bad = (msg: string) => Object.assign(new Error(msg), { status: 400 });

export function cleanWebhook(w: unknown): Webhook {
  const kind = (w as Webhook)?.kind;
  const url = String((w as Webhook)?.url ?? '').trim();
  if (!['slack', 'teams', 'discord', 'generic'].includes(kind)) throw bad('Pick Slack, Teams, Discord or Webhook.');
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw bad('That webhook address is not a URL.');
  }
  const local = process.env.SHIPCAST_ALLOW_PRIVATE_WEBHOOKS === '1';
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw bad('Webhooks must use https.');
  if (u.username || u.password) throw bad('Put no password in the webhook address.');
  const host = u.hostname.toLowerCase();
  if (kind === 'slack' && host !== 'hooks.slack.com') throw bad('A Slack webhook starts with https://hooks.slack.com/.');
  if (kind === 'discord' && !/^(discord|discordapp)\.com$/.test(host)) throw bad('A Discord webhook starts with https://discord.com/api/webhooks/.');
  if (kind === 'teams' && !/(\.webhook\.office\.com|\.logic\.azure\.com|\.powerplatform\.com|\.environment\.api\.powerplatform\.com)$/.test(host)) throw bad('A Teams webhook is on webhook.office.com or a Power Automate (logic.azure.com) address.');
  return { kind, url: u.toString() };
}

export function saveSchedule(patch: Partial<Schedule>): Promise<Schedule> {
  return serial(async () => {
    const cur = await readSchedule();
    const next: Schedule = { ...cur };
    if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
    if (patch.kind && ['last7', 'last30', 'lastMonth', 'lastQuarter'].includes(patch.kind)) next.kind = patch.kind;
    if (patch.audience && AUDIENCES[patch.audience]) next.audience = patch.audience;
    if (patch.weekday !== undefined && Number.isInteger(Number(patch.weekday)) && Number(patch.weekday) >= 0 && Number(patch.weekday) <= 6) next.weekday = Number(patch.weekday);
    if (patch.time !== undefined) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(patch.time))) throw bad('Time is HH:MM, e.g. 16:00.');
      next.time = String(patch.time);
    }
    if (patch.mode && ['review', 'auto'].includes(patch.mode)) next.mode = patch.mode;
    if (typeof patch.attachPdf === 'boolean') next.attachPdf = patch.attachPdf;
    if (Array.isArray(patch.emails)) {
      const emails = [...new Set(patch.emails.map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
      const wrong = emails.find((e) => !EMAIL_RE.test(e));
      if (wrong) throw bad(`“${wrong.slice(0, 80)}” is not an email address.`);
      if (emails.length > 20) throw bad('At most 20 email recipients.');
      next.emails = emails;
    }
    if (Array.isArray(patch.webhooks)) {
      if (patch.webhooks.length > 5) throw bad('At most 5 webhooks.');
      next.webhooks = patch.webhooks.map(cleanWebhook);
    }
    await writeJson(scheduleFile(), next);
    return next;
  });
}
const markSchedule = (patch: Pick<Schedule, 'lastRun'> | Pick<Schedule, 'lastNudge'>) => serial(async () => writeJson(scheduleFile(), { ...(await readSchedule()), ...patch }));

/** The schedule as the UI sees it: webhook addresses are secrets (anyone with one can post), so only their host shows. */
export function publicSchedule(s: Schedule) {
  return { ...s, webhooks: s.webhooks.map((w) => ({ kind: w.kind, host: new URL(w.url).hostname })) };
}

// ── email settings ─────────────────────────────────────────────────────

export interface SmtpConfig {
  host: string;
  port: number;
  /** true: TLS from the start (465); false: STARTTLS (587, 25, 2525). */
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}
const SMTP_SECRET = 'reports.smtp';
const SMTP_PORTS = [25, 465, 587, 2525];

export async function readSmtp(): Promise<SmtpConfig | null> {
  const raw = await getSecret(SMTP_SECRET);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
export async function publicSmtp() {
  const c = await readSmtp();
  return c ? { configured: true, host: c.host, port: c.port, secure: c.secure, user: c.user ?? '', from: c.from, hasPassword: !!c.pass } : { configured: false };
}

export async function saveSmtp(input: Partial<SmtpConfig> | null): Promise<void> {
  if (input === null) return setSecret(SMTP_SECRET, null);
  const cur = await readSmtp();
  const host = String(input.host ?? '').trim().toLowerCase();
  const port = Number(input.port ?? 587);
  const from = String(input.from ?? '').trim();
  if (!/^[a-z0-9.-]{3,253}$/.test(host)) throw bad('Enter the mail server’s host name, e.g. smtp.example.com.');
  const local = /^(localhost|127\.0\.0\.1)$/.test(host);
  // A relay on this machine is the machine owner's to point at (other people could otherwise probe local ports).
  const uid = currentContext()?.user;
  if (local && uid && !isInstallOwnerSync(uid)) throw bad('Only the person who set Shipcast up can use a mail relay on this machine.');
  if (!SMTP_PORTS.includes(port) && !(local && Number.isInteger(port) && port > 1024 && port < 65536)) throw bad('Mail servers use port 587, 465, 25 or 2525 (a relay on this machine may use any port above 1024).');
  const addr = /<([^>]+)>\s*$/.exec(from)?.[1] ?? from;
  if (!EMAIL_RE.test(addr) || /[\r\n]/.test(from)) throw bad('“From” must be an email address, optionally with a name: Acme Reports <reports@acme.com>.');
  const user = input.user === undefined ? cur?.user : String(input.user).trim() || undefined;
  // An empty password field keeps the saved one.
  const pass = input.pass ? String(input.pass) : cur?.pass;
  await setSecret(SMTP_SECRET, JSON.stringify({ host, port, secure: input.secure === undefined ? port === 465 : !!input.secure, from, ...(user ? { user } : {}), ...(pass ? { pass } : {}) } satisfies SmtpConfig));
}

// ── SMTP client ────────────────────────────────────────────────────────

export interface Mail {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: { name: string; type: string; data: Buffer }[];
}

const b64lines = (buf: Buffer) => buf.toString('base64').replace(/.{1,76}/g, '$&\r\n');
/** Header words outside ASCII as RFC 2047 encoded words. */
const encWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`);

export function buildMessage(from: string, m: Mail, now = new Date()): string {
  const id = randomBytes(12).toString('hex');
  const domain = (/@([^>\s]+)/.exec(from)?.[1] ?? 'shipcast.local').replace(/[^\w.-]/g, '');
  const alt = `alt-${id}`, mix = `mix-${id}`;
  const fromHdr = /^(.*?)\s*<([^>]+)>$/.exec(from);
  const head = [
    `From: ${fromHdr ? `${encWord(fromHdr[1].replace(/"/g, ''))} <${fromHdr[2]}>` : from}`,
    `To: ${m.to.join(', ')}`,
    `Subject: ${encWord(m.subject.replace(/[\r\n]+/g, ' ').slice(0, 200))}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${id}@${domain}>`,
    'MIME-Version: 1.0',
  ];
  const altPart = [`Content-Type: multipart/alternative; boundary="${alt}"`, '', `--${alt}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64lines(Buffer.from(m.text)), ...(m.html ? [`--${alt}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64lines(Buffer.from(m.html))] : []), `--${alt}--`, ''].join('\r\n');
  if (!m.attachments?.length) return [...head, altPart].join('\r\n');
  return [
    ...head,
    `Content-Type: multipart/mixed; boundary="${mix}"`,
    '',
    `--${mix}`,
    altPart,
    ...m.attachments.flatMap((a) => [`--${mix}`, `Content-Type: ${a.type}; name="${a.name.replace(/"/g, '')}"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${a.name.replace(/"/g, '')}"`, '', b64lines(a.data)]),
    `--${mix}--`,
    '',
  ].join('\r\n');
}

/** A line-oriented SMTP conversation over a socket that may be upgraded to TLS. */
class SmtpConn {
  private buf = '';
  private waiters: ((line: string) => void)[] = [];
  private lines: string[] = [];
  private err?: Error;
  sock: Socket | TLSSocket;
  constructor(sock: Socket | TLSSocket) {
    this.sock = sock;
    this.attach(sock);
  }
  attach(sock: Socket | TLSSocket) {
    this.sock = sock;
    sock.setEncoding('utf8');
    sock.on('data', (d: string) => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).replace(/\r$/, '');
        this.buf = this.buf.slice(i + 1);
        const w = this.waiters.shift();
        if (w) w(line);
        else this.lines.push(line);
      }
    });
    sock.on('error', (e) => {
      this.err = e;
      for (const w of this.waiters.splice(0)) w(`599 ${e.message}`);
    });
    sock.on('close', () => {
      for (const w of this.waiters.splice(0)) w('599 connection closed');
    });
  }
  private line(): Promise<string> {
    if (this.err) return Promise.resolve(`599 ${this.err.message}`);
    const l = this.lines.shift();
    return l !== undefined ? Promise.resolve(l) : new Promise((r) => this.waiters.push(r));
  }
  /** One reply (multi-line replies end at "NNN "). */
  async reply(): Promise<{ code: number; text: string }> {
    const parts: string[] = [];
    for (;;) {
      const l = await this.line();
      parts.push(l.slice(4));
      if (!/^\d{3}-/.test(l)) return { code: Number(l.slice(0, 3)) || 599, text: parts.join('\n') };
    }
  }
  async cmd(line: string, expect: number[], what = line.split(' ')[0]): Promise<string> {
    this.sock.write(`${line}\r\n`);
    const r = await this.reply();
    if (!expect.includes(r.code)) throw new Error(`Mail server refused ${what} (${r.code}): ${r.text.slice(0, 160)}`);
    return r.text;
  }
}

function openSocket(host: string, port: number, secure: boolean, timeoutMs: number): Promise<Socket | TLSSocket> {
  return new Promise((resolve, reject) => {
    const s = secure ? tlsConnect({ host, port, servername: isIP(host) ? undefined : host }) : netConnect({ host, port });
    const t = setTimeout(() => (s.destroy(), reject(new Error(`Couldn’t reach ${host}:${port}`))), timeoutMs);
    s.once(secure ? 'secureConnect' : 'connect', () => (clearTimeout(t), resolve(s)));
    s.once('error', (e) => (clearTimeout(t), reject(new Error(`Couldn’t reach ${host}:${port}: ${e.message}`))));
  });
}

export async function sendMail(cfg: SmtpConfig, m: Mail, opts: { timeoutMs?: number; tls?: { rejectUnauthorized?: boolean } } = {}): Promise<void> {
  if (!m.to.length) return;
  const sock = await openSocket(cfg.host, cfg.port, cfg.secure, opts.timeoutMs ?? 20_000);
  sock.setTimeout(opts.timeoutMs ?? 60_000, () => sock.destroy(new Error('mail server timed out')));
  const c = new SmtpConn(sock);
  try {
    const hello = await c.reply();
    if (hello.code !== 220) throw new Error(`Mail server said: ${hello.text.slice(0, 160)}`);
    let caps = await c.cmd('EHLO shipcast.local', [250]);
    // A relay on this machine (Mailpit, a local Postfix) may speak plain SMTP; anything else must offer TLS.
    const localRelay = /^(localhost|127\.0\.0\.1|::1)$/.test(cfg.host);
    if (!cfg.secure && !(localRelay && !/STARTTLS/i.test(caps))) {
      if (!/STARTTLS/i.test(caps)) throw new Error('This mail server doesn’t offer STARTTLS; use port 465 (TLS) instead.');
      await c.cmd('STARTTLS', [220]);
      const tls = await new Promise<TLSSocket>((resolve, reject) => {
        sock.removeAllListeners('data');
        const t = tlsConnect({ socket: sock, servername: isIP(cfg.host) ? undefined : cfg.host, ...(opts.tls ?? {}) });
        t.once('secureConnect', () => resolve(t));
        t.once('error', reject);
      });
      c.attach(tls);
      caps = await c.cmd('EHLO shipcast.local', [250]);
    }
    if (cfg.user && cfg.pass) {
      if (/AUTH[^\n]*PLAIN/i.test(caps)) await c.cmd(`AUTH PLAIN ${Buffer.from(`\0${cfg.user}\0${cfg.pass}`).toString('base64')}`, [235], 'the user name or password');
      else {
        await c.cmd('AUTH LOGIN', [334]);
        await c.cmd(Buffer.from(cfg.user).toString('base64'), [334], 'the user name');
        await c.cmd(Buffer.from(cfg.pass).toString('base64'), [235], 'the password');
      }
    }
    const addr = /<([^>]+)>\s*$/.exec(cfg.from)?.[1] ?? cfg.from;
    await c.cmd(`MAIL FROM:<${addr}>`, [250]);
    for (const to of m.to) await c.cmd(`RCPT TO:<${to}>`, [250, 251], `the recipient ${to}`);
    await c.cmd('DATA', [354]);
    // Dot-stuffing: a line starting with "." gets another.
    const body = buildMessage(cfg.from, m).replace(/\r\n\./g, '\r\n..');
    await c.cmd(`${body}\r\n.`, [250], 'the message');
    await c.cmd('QUIT', [221]).catch(() => {});
  } finally {
    c.sock.destroy();
  }
}

// ── webhooks ───────────────────────────────────────────────────────────

const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];
export const isPrivateAddress = (ip: string) => (isIP(ip) === 4 ? PRIVATE_V4.some((re) => re.test(ip)) : /^(::1?|f[cd]|fe80|::ffff:(10|127|169\.254|192\.168)\.)/i.test(ip));

/** Refuse webhooks that resolve into this machine or its network (they'd reach local services). */
async function assertPublic(url: string) {
  if (process.env.SHIPCAST_ALLOW_PRIVATE_WEBHOOKS === '1') return;
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (!addrs.length || addrs.some(isPrivateAddress)) throw new Error(`${host} is not a public address.`);
}

/** The JSON each chat app expects. */
export function webhookPayload(kind: WebhookKind, rIn: Report, link?: string): unknown {
  // Post titles and notes are people's text: in chat apps they must not ping @channel/@everyone or smuggle links.
  const r = kind === 'slack' ? mapText(rIn, (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')) : kind === 'discord' ? mapText(rIn, (t) => t.replace(/@/g, '@\u200b')) : rIn;
  const kpis = r.facts.kpis.slice(0, 4).map((k) => `${k.label}: ${k.unit === 'percent' ? `${k.value}%` : Math.round(k.value).toLocaleString('en-US')}${k.change !== undefined ? ` (${k.change >= 0 ? '+' : '−'}${Math.round(Math.abs(k.change) * 100)}%)` : ''}`);
  const summary = r.sections.find((s) => s.id === 'summary')?.lines ?? [];
  const next = r.recommendations.map((x, i) => `${i + 1}. ${x.text}`);
  switch (kind) {
    case 'slack':
      return {
        text: `${r.title}: ${r.headline}`,
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: r.headline.slice(0, 150) } },
          { type: 'context', elements: [{ type: 'mrkdwn', text: r.title }] },
          { type: 'section', fields: kpis.map((k) => ({ type: 'mrkdwn', text: `*${k.replace(/: /, ':*\n')}` })) },
          ...(summary.length ? [{ type: 'section', text: { type: 'mrkdwn', text: summary.map((l) => `• ${l}`).join('\n').slice(0, 2900) } }] : []),
          ...(next.length ? [{ type: 'section', text: { type: 'mrkdwn', text: `*Next steps*\n${next.join('\n')}`.slice(0, 2900) } }] : []),
          ...(link ? [{ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open the report' }, url: link }] }] : []),
        ],
      };
    case 'discord':
      return { allowed_mentions: { parse: [] }, content: `**${r.headline}**`.slice(0, 1900), embeds: [{ title: r.title, ...(link ? { url: link } : {}), description: [...summary, '', ...kpis, ...(next.length ? ['', '**Next steps**', ...next] : [])].join('\n').slice(0, 4000) }] };
    case 'teams':
      return { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: { $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4', body: [{ type: 'TextBlock', size: 'Large', weight: 'Bolder', wrap: true, text: r.headline }, { type: 'TextBlock', isSubtle: true, wrap: true, text: r.title }, { type: 'FactSet', facts: kpis.map((k) => ({ title: k.split(': ')[0], value: k.split(': ').slice(1).join(': ') })) }, ...summary.map((l) => ({ type: 'TextBlock', wrap: true, text: `• ${l}` })), ...(next.length ? [{ type: 'TextBlock', weight: 'Bolder', text: 'Next steps' }, ...next.map((l) => ({ type: 'TextBlock', wrap: true, text: l }))] : [])], ...(link ? { actions: [{ type: 'Action.OpenUrl', title: 'Open the report', url: link }] } : {}) } }] };
    default:
      return { title: r.title, headline: r.headline, period: r.facts.period.label, kpis: r.facts.kpis.map(({ key, label, value, prev, change, unit }) => ({ key, label, value, prev, change, unit })), summary, nextSteps: r.recommendations.map((x) => ({ text: x.text, why: x.why })), ...(link ? { link } : {}), markdown: reportMarkdown(r, link) };
  }
}

/** The report with its people-written text passed through `fn` (for chat apps' markup). */
function mapText(r: Report, fn: (t: string) => string): Report {
  return { ...r, title: fn(r.title), headline: fn(r.headline), sections: r.sections.map((s) => ({ ...s, lines: s.lines.map(fn) })), recommendations: r.recommendations.map((x) => ({ ...x, text: fn(x.text), why: fn(x.why) })) };
}

// Swappable for tests.
let http: typeof fetch = (i, init) => fetch(i, init);
export function setDeliverFetch(f: typeof fetch | null) {
  http = f ?? ((i, init) => fetch(i, init));
}

export async function postWebhook(w: Webhook, r: Report, link?: string): Promise<void> {
  await assertPublic(w.url);
  const res = await http(w.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(webhookPayload(w.kind, r, link)), redirect: 'error', signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${w.kind} answered ${res.status}`);
}

// ── sending ────────────────────────────────────────────────────────────

const sendsFile = () => join(reportsDir(), 'sends.json');
export const SENDS_PER_DAY = 30;

export interface ReportSendResult {
  sent: string[];
  failed: { to: string; error: string }[];
}

/** Email and post a report to the schedule's recipients (or the ones given). Capped per day; every attempt logged. */
export async function sendReport(id: string, o: { emails?: string[]; webhooks?: Webhook[]; link?: string; now?: Date; pdf?: (r: Report) => Promise<Buffer> } = {}): Promise<ReportSendResult> {
  const r = await getReport(id);
  if (!r) throw Object.assign(new Error('report not found'), { status: 404 });
  const s = await readSchedule();
  const emails = o.emails ?? s.emails;
  const hooks = o.webhooks ?? s.webhooks;
  if (!emails.length && !hooks.length) throw bad('Add someone to send it to: an email address or a webhook (Reports → Delivery).');
  const now = o.now ?? new Date();
  const day = now.toISOString().slice(0, 10);
  const log = await readJson<{ at: string; report: string; to: string; ok: boolean; error?: string }[]>(sendsFile(), []);
  const today = log.filter((x) => x.at.startsWith(day)).length;
  if (today + (emails.length ? 1 : 0) + hooks.length > SENDS_PER_DAY) throw Object.assign(new Error(`That would go over ${SENDS_PER_DAY} sends today — try again tomorrow.`), { status: 429 });

  // On a server people can reach (SHIPCAST_PUBLIC_URL), the message links to a 30-day share of the report.
  let link = o.link;
  const pub = process.env.SHIPCAST_PUBLIC_URL?.replace(/\/+$/, '');
  const ws = currentContext()?.workspace;
  if (link === undefined && pub && /^https?:\/\//.test(pub) && ws) link = `${pub}/r/${(await createShare(ws, id, { expiresDays: 30, by: 'delivery' })).token}`;
  const out: ReportSendResult = { sent: [], failed: [] };
  const entries: typeof log = [];
  const note = (to: string, err?: unknown) => {
    const error = err ? String((err as Error).message ?? err).slice(0, 200) : undefined;
    entries.push({ at: now.toISOString(), report: id, to, ok: !err, ...(error ? { error } : {}) });
    if (err) out.failed.push({ to, error: error! });
    else out.sent.push(to);
  };

  if (emails.length) {
    const cfg = await readSmtp();
    if (!cfg) for (const e of emails) note(e, new Error('Email isn’t set up (Reports → Delivery → Email).'));
    else {
      let attachments: Mail['attachments'] = [];
      if (s.attachPdf) {
        try {
          attachments = [{ name: `${r.title.replace(/ · /, ' - ').replace(/[^\w .-]+/g, '')}.pdf`, type: 'application/pdf', data: await (o.pdf ?? reportPdf)(r) }];
        } catch {}
      }
      try {
        // One message, every recipient on it: the report is the same for all.
        await sendMail(cfg, { to: emails, subject: `${r.title}: ${r.headline}`, text: reportMarkdown(r, link), html: reportEmailHtml(r, link), attachments });
        for (const e of emails) note(e);
      } catch (e) {
        for (const to of emails) note(to, e);
      }
    }
  }
  for (const w of hooks) {
    const label = `${w.kind} (${new URL(w.url).hostname})`;
    try {
      await postWebhook(w, r, link);
      note(label);
    } catch (e) {
      note(label, e);
    }
  }
  await serial(async () => writeJson(sendsFile(), [...(await readJson<typeof log>(sendsFile(), [])), ...entries].slice(-500)));
  if (out.sent.length) await markReportSent(id, now);
  return out;
}

export async function testEmail(to: string): Promise<void> {
  if (!EMAIL_RE.test(to)) throw bad('Enter an email address to send the test to.');
  const cfg = await readSmtp();
  if (!cfg) throw bad('Save the mail server settings first.');
  await sendMail(cfg, { to: [to], subject: 'Shipcast test email', text: 'Email from Shipcast works. Reports will arrive like this.', html: '<p>Email from <b>Shipcast</b> works. Reports will arrive like this.</p>' });
}

// ── the schedule ───────────────────────────────────────────────────────

/** The most recent scheduled moment at or before `now` (in the plan's zone). */
export function lastSlot(s: Pick<Schedule, 'kind' | 'weekday' | 'time'>, now: Date, tz: string): Date {
  const today = localParts(now.toISOString(), tz).date;
  for (let back = 0; back < 120; back++) {
    const d = new Date(Date.parse(`${today}T12:00:00Z`) - back * 86_400_000).toISOString().slice(0, 10);
    if (new Date(`${d}T12:00:00Z`).getUTCDay() !== s.weekday) continue;
    const dom = Number(d.slice(8, 10));
    const month = Number(d.slice(5, 7));
    // Monthly: the first such weekday of the month; quarterly: of Jan/Apr/Jul/Oct.
    if ((s.kind === 'lastMonth' || s.kind === 'lastQuarter') && dom > 7) continue;
    if (s.kind === 'lastQuarter' && (month - 1) % 3 !== 0) continue;
    const at = new Date(zonedToUtc(d, s.time, tz));
    if (at <= now) return at;
  }
  return new Date(0);
}

export interface ReportTickDeps {
  now?: Date;
  ask?: ((p: string) => Promise<string>) | null;
  send?: typeof sendReport;
  notify?: (title: string, text: string) => Promise<void>;
}

/**
 * The background step: when a scheduled slot has passed since the last run, make the
 * report; send it ("auto") or tell the team it's ready to look at ("review"). The day
 * before, if posts in the coming report have no numbers, say so once.
 */
export async function reportTick(deps: ReportTickDeps = {}): Promise<{ made?: string; sent?: ReportSendResult; nudged?: boolean } | undefined> {
  const s = await readSchedule();
  if (!s.enabled) return undefined;
  if ((await readSettings()).agentsPaused) return undefined;
  const now = deps.now ?? new Date();
  const tz = (await readPlan()).tz;
  const notify = deps.notify ?? notifyDesktop;
  const slot = lastSlot(s, now, tz);
  if (slot.getTime() > 0 && (!s.lastRun || Date.parse(s.lastRun) < slot.getTime()) && now.getTime() - slot.getTime() < 2 * 86_400_000) {
    await markSchedule({ lastRun: now.toISOString() });
    const r = await createReport({ kind: s.kind, audience: s.audience, asOf: now, ...(deps.ask !== undefined ? { ask: deps.ask } : {}) });
    if (s.mode === 'auto' && (s.emails.length || s.webhooks.length)) return { made: r.id, sent: await (deps.send ?? sendReport)(r.id, { now }) };
    await notify('Your report is ready', `${r.title}: ${r.headline}. Have a look, then send it.`);
    return { made: r.id };
  }
  // The reminder: within a day before the next slot, once.
  const next = lastSlot(s, new Date(now.getTime() + 86_400_000), tz);
  if (next > now && s.lastNudge !== localParts(next.toISOString(), tz).date) {
    const { pendingNumbers } = await import('./collectors.ts');
    const missing = await pendingNumbers(now).catch(() => []);
    await markSchedule({ lastNudge: localParts(next.toISOString(), tz).date });
    if (missing.length) {
      await notify('Numbers wanted before tomorrow’s report', `${missing.length} post${missing.length === 1 ? '' : 's'} still need${missing.length === 1 ? 's' : ''} numbers — add them so the report sees everything.`);
      return { nudged: true };
    }
  }
  return undefined;
}

