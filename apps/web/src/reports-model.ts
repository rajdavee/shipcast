// Pure Reports logic for the web app: the report and fact-sheet types (mirroring
// services/engine/src/report.ts and report-facts.ts), how changes, sparklines, the channel
// waterfall and goals read, the create form's choices, who may do what, and a few small
// helpers (suggested questions, time saved, where a next step goes). No DOM, no React.
import type { ChannelId } from './calendar-model.ts';
import type { Perms } from './auth-model.ts';
import { fmtCount, fmtX } from './pulse-model.ts';

// ── types (mirror the engine's JSON) ───────────────────────────────────

export type PeriodKind = 'last7' | 'last30' | 'lastMonth' | 'lastQuarter' | 'custom';
export type Audience = 'boss' | 'client' | 'team';
export const KPI_KEYS = ['posts', 'audience', 'engagement', 'rate', 'clicks', 'follows', 'sessions', 'keyEvents', 'searchClicks'] as const;
export type KpiKey = (typeof KPI_KEYS)[number];
export type SectionId = 'summary' | 'work' | 'results' | 'why' | 'website' | 'goals' | 'notable' | 'next' | 'coverage';
export type RecKind = 'more-like-this' | 'remix' | 'slots' | 'double-down' | 'numbers' | 'pace' | 'plan';

export interface Period { kind: PeriodKind; start: string; end: string; tz: string; label: string }
export interface Totals { posts: number; measured: number; audience: number; engagement: number; rate?: number; clicks: number; follows: number }
export interface ChannelFacts extends Totals { channel: ChannelId; name: string; prev: Totals }
export interface Kpi { key: KpiKey; label: string; value: number; prev?: number; change?: number; series: number[]; unit?: 'percent' }
export interface PostFact {
  post: string; title: string; channel: ChannelId; at: string; url?: string; format?: string; pillar?: string; media?: string; experiment?: string;
  audience?: number; engagement?: number; lift?: number; why: string[]; visits?: number; keyEvents?: number;
}
export interface Goal { id: string; metric: KpiKey; target: number; per: 'week' | 'month' | 'quarter'; channel?: ChannelId; label?: string }
export interface GoalFact extends Goal {
  label: string; window: { start: string; end: string; label: string }; actual: number; elapsed: number;
  projected?: number; onTrack?: boolean; needPerWeek?: number; done: boolean;
}
export interface Notable { kind: 'high' | 'low' | 'streak-up' | 'streak-down'; key: KpiKey; channel?: ChannelId; text: string; value: number; n: number }
export interface Note { id: string; date: string; text: string; by?: string }
export interface WorkFacts {
  published: number; byChannel: Partial<Record<ChannelId, number>>; posts: PostFact[];
  experiments: { post: string; title: string; experiment: string; lift?: number }[];
  campaigns: { id: string; name: string; created: boolean; pieces: number }[]; pieces: number; upcoming: number;
}
export interface SiteFacts {
  sessions: number; users: number; keyEvents: number; prev: { sessions: number; users: number; keyEvents: number };
  social: { channel: ChannelId; sessions: number; keyEvents: number }[];
  search?: { clicks: number; impressions: number; ctr?: number; position?: number; prev: { clicks: number; impressions: number } };
  topQueries: { query: string; clicks: number; impressions: number }[];
  days: number;
}
export interface Facts {
  version: 1; period: Period; prevPeriod: Period; asOf: string; totals: Totals; prev: Totals; kpis: Kpi[]; channels: ChannelFacts[];
  waterfall: { channel: ChannelId; name: string; delta: number }[];
  split?: { volume: number; quality: number; perPost: number; prevPerPost: number };
  top: PostFact[]; bottom: PostFact[]; work: WorkFacts; goals: GoalFact[]; notable: Notable[]; site?: SiteFacts; notes: Note[];
  playbook: { channel: ChannelId; wins: string[]; losses: string[] }[];
  coverage: { missing: { post: string; title: string; channel: ChannelId }[]; sources: Record<string, number>; site: 'connected' | 'none'; messages: string[] };
}
export interface Section { id: SectionId; title: string; lines: string[]; hidden?: boolean; edited?: boolean }
export interface Recommendation {
  id: string; kind: RecKind; text: string; why: string;
  action: { label: string; post?: string; channel?: ChannelId; to?: ChannelId[]; slots?: string[]; format?: string; pillar?: string; navigate?: string };
  done?: { at: string; result: string };
}
export type ReportStatus = 'draft' | 'ready' | 'sent';
export interface Report {
  /** Someone changed the written words since they were checked. */
  edited?: boolean;
  id: string; title: string; headline: string; audience: Audience; kind: PeriodKind; facts: Facts; sections: Section[]; recommendations: Recommendation[];
  writer: 'claude' | 'template' | 'mixed'; createdAt: string; updatedAt: string; by?: string; status: ReportStatus; sentAt?: string; intro?: string; version: number;
}
export interface ReportSummary {
  id: string; title: string; headline: string; audience: Audience; kind: PeriodKind; period: string; createdAt: string; status: ReportStatus; sentAt?: string;
  kpis: Pick<Kpi, 'key' | 'label' | 'value' | 'change' | 'unit'>[];
}
export interface ReportVersion { version: number; updatedAt: string; headline: string }
export interface GoalInput { id?: string; metric: KpiKey; target: number; per: Goal['per']; channel?: ChannelId; label?: string }
export interface ShareInfo { id: string; createdAt: string; expiresAt?: string; views: number; lastViewedAt?: string }
export interface AskChart { title: string; labels: string[]; series: { name: string; values: number[] }[] }
export interface AskAnswer { answer: string[]; chart?: AskChart }
export type WebhookKind = 'slack' | 'teams' | 'discord' | 'generic';
export interface ReportSchedule { enabled: boolean; kind: PeriodKind; audience: Audience; weekday: number; time: string; mode: 'review' | 'auto'; emails: string[]; /** New ones carry their address; saved ones come back with only their host (the address is a secret). */
  webhooks: { kind: WebhookKind; url?: string; host?: string }[]; attachPdf?: boolean }
export interface EmailSettings { host: string; port: number; secure: boolean; user: string; from: string; pass?: string; configured: boolean }
export interface RollupItem { workspace: { id: string; name: string }; report?: ReportSummary; needsAttention: boolean; why?: string }
export interface SiteState {
  ga4Property?: string; ga4Name?: string; gscSite?: string; domains: string[]; utm: boolean; lastSync?: string; lastError?: string;
  connected: boolean; days: number; firstDay: string | null; lastDay: string | null;
}
export interface SiteChoices { properties: { id: string; name: string; account: string }[] | { error: string }; sites: { id: string; permission: string }[] | { error: string } }

// ── choices for the create form ────────────────────────────────────────

export const PERIOD_CHOICES: { kind: PeriodKind; label: string; hint: string }[] = [
  { kind: 'last7', label: 'This week', hint: 'The last 7 days' },
  { kind: 'last30', label: 'Last 30 days', hint: 'A rolling month' },
  { kind: 'lastMonth', label: 'Last month', hint: 'The previous calendar month' },
  { kind: 'lastQuarter', label: 'Last quarter', hint: 'The previous three months' },
  { kind: 'custom', label: 'Custom dates', hint: 'Pick a start and end' },
];
export const periodLabel = (k: PeriodKind) => PERIOD_CHOICES.find((p) => p.kind === k)?.label ?? k;

export const AUDIENCE_CHOICES: { id: Audience; label: string; hint: string }[] = [
  { id: 'team', label: 'Team', hint: 'Tactical: which posts, formats and slots' },
  { id: 'boss', label: 'Boss', hint: 'Outcomes first, short' },
  { id: 'client', label: 'Client', hint: 'Wins first, warm, no jargon' },
];
export const audienceLabel = (a: Audience) => AUDIENCE_CHOICES.find((x) => x.id === a)?.label ?? a;

export const WRITER_LABEL: Record<Report['writer'], string> = {
  claude: 'Written for you · checked against your numbers',
  mixed: 'Partly written for you · checked against your numbers',
  template: 'From your numbers',
};

/** A custom range is valid when both dates are set, start comes before end, and it isn't more than a year. */
export function customRangeProblem(start: string, end: string): string | null {
  if (!start || !end) return 'Pick a start and an end date.';
  const a = Date.parse(start), b = Date.parse(end);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 'Those dates don’t look right.';
  if (a >= b) return 'The start has to be before the end.';
  if (b - a > 366 * 86_400_000) return 'Pick a range of a year or less.';
  return null;
}

/** The request body for POST /api/reports. Custom ends are inclusive in the form, exclusive on the wire. */
export function createBody(kind: PeriodKind, audience: Audience, start?: string, end?: string): { kind: PeriodKind; audience: Audience; start?: string; end?: string } {
  if (kind !== 'custom' || !start || !end) return { kind, audience };
  const endEx = new Date(Date.parse(`${end}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return { kind, audience, start, end: endEx };
}

/** Progress lines shown while the report is made (it can take a couple of minutes when the writer runs). */
export const MAKING_STEPS = ['Reading your numbers…', 'Comparing with the period before…', 'Finding what changed and why…', 'Writing it up…', 'Checking every number against your data…'];
export const makingStep = (elapsedMs: number) => MAKING_STEPS[Math.min(MAKING_STEPS.length - 1, Math.floor(Math.max(0, elapsedMs) / 9000))];

// ── who may do what (the server enforces it; this only hides what would fail) ──

export interface ReportGates { read: boolean; create: boolean; edit: boolean; act: boolean; ask: boolean; share: boolean; send: boolean; delivery: boolean; website: boolean; remove: boolean }
export function reportGates(p: Pick<Perms, 'read' | 'write' | 'manage'>): ReportGates {
  return { read: p.read, create: p.write, edit: p.write, act: p.write, ask: p.read, remove: p.write, share: p.manage, send: p.manage, delivery: p.manage, website: p.manage };
}

// ── numbers ────────────────────────────────────────────────────────────

export type Tone = 'up' | 'down' | 'flat' | 'none';

/** "+23%" / "−8%" / "±0%" with a tone; `invert` for metrics where down is good. Absent change reads "new" or "—". */
export function fmtChange(change: number | undefined, o: { invert?: boolean } = {}): { text: string; tone: Tone; arrow: string; label: string } {
  if (change === undefined || !Number.isFinite(change)) return { text: '—', tone: 'none', arrow: '', label: 'No earlier period to compare with' };
  const p = change * 100;
  const r = Math.abs(p) >= 10 ? Math.round(p) : Math.round(p * 10) / 10;
  if (Math.abs(p) < 0.5) return { text: '±0%', tone: 'flat', arrow: '→', label: 'About the same as the period before' };
  const up = p > 0;
  const tone: Tone = up !== !!o.invert ? 'up' : 'down';
  const mag = `${Math.abs(r)}%`;
  return { text: `${up ? '+' : '−'}${mag}`, tone, arrow: up ? '↑' : '↓', label: `${up ? 'Up' : 'Down'} ${mag} on the period before` };
}

/** A KPI value as shown on a tile: rates already come in percent points (4.21 → "4.2%"), counts are compact. */
export function fmtKpi(value: number | undefined, unit?: 'percent'): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  if (unit === 'percent') return `${value >= 10 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, '')}%`;
  return fmtCount(value);
}

/** Exact count with thousands separators: 12,345. */
export const fmtExact = (n: number | undefined) => (n === undefined || !Number.isFinite(n) ? '—' : Math.round(n).toLocaleString('en-US'));
/** A signed delta: +3,200 / −410. */
export const fmtDelta = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${fmtExact(Math.abs(n))}`;

/** A playbook win as a short chip: "Format · Carousel: 2.1× usual" → "Carousel". */
export const whyChip = (label: string) => label.replace(/^[^·]+· /, '').replace(/:.*$/, '').trim();

/** "2.1× your usual" — a real result against the channel's usual. */
export const liftText = (lift?: number) => (lift === undefined || !Number.isFinite(lift) || lift <= 0 ? 'No baseline yet' : `${fmtX(lift)} your usual`);

// ── charts ─────────────────────────────────────────────────────────────

export interface Spark { line: string; area: string; last: { x: number; y: number } | null; min: number; max: number }

/** A sparkline in a w×h box: oldest first, the last point marked. Flat series draw mid-height. */
export function sparkPath(series: number[], w = 120, h = 32, pad = 2): Spark {
  const v = series.filter((x) => Number.isFinite(x));
  if (v.length === 0) return { line: '', area: '', last: null, min: 0, max: 0 };
  const min = Math.min(...v), max = Math.max(...v);
  const span = max - min;
  const pts = v.map((y, i) => {
    const x = v.length === 1 ? w / 2 : pad + (i / (v.length - 1)) * (w - 2 * pad);
    const yy = span === 0 ? h / 2 : pad + (1 - (y - min) / span) * (h - 2 * pad);
    return { x: round(x), y: round(yy) };
  });
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
  const area = pts.length > 1 ? `${line} L${pts[pts.length - 1].x} ${h} L${pts[0].x} ${h} Z` : '';
  return { line, area, last: pts[pts.length - 1], min, max };
}
const round = (x: number) => Math.round(x * 100) / 100;

export interface WaterBar { channel: ChannelId; name: string; delta: number; tone: 'up' | 'down' | 'flat'; left: number; width: number }

/**
 * Horizontal bars for the change by channel, on one shared scale. With both gains and losses
 * the axis sits where zero falls between the biggest loss and biggest gain; otherwise at an edge.
 * Positions are percentages of the track.
 */
export function waterfallBars(rows: { channel: ChannelId; name: string; delta: number }[]): { zero: number; bars: WaterBar[]; total: number } {
  const total = rows.reduce((s, r) => s + r.delta, 0);
  const maxUp = Math.max(0, ...rows.map((r) => r.delta));
  const maxDown = Math.max(0, ...rows.map((r) => -r.delta));
  const span = maxUp + maxDown;
  const zero = span === 0 ? 0 : (maxDown / span) * 100;
  const sorted = [...rows].sort((a, b) => b.delta - a.delta);
  const bars = sorted.map((r) => {
    const width = span === 0 ? 0 : (Math.abs(r.delta) / span) * 100;
    const tone: WaterBar['tone'] = r.delta > 0 ? 'up' : r.delta < 0 ? 'down' : 'flat';
    return { ...r, tone, left: round(r.delta < 0 ? zero - width : zero), width: round(width) };
  });
  return { zero: round(zero), bars, total };
}

/** The reach change split into "more posts" and "more per post": two shares of one bar, and a sentence. */
export function splitView(split: Facts['split']): { volume: number; quality: number; caption: string; total: number } | null {
  if (!split) return null;
  const a = Math.abs(split.volume), b = Math.abs(split.quality);
  const total = split.volume + split.quality;
  if (a + b === 0) return { volume: 50, quality: 50, total, caption: 'Reach held steady: the same number of posts reached about as many people each.' };
  const volume = round((a / (a + b)) * 100);
  const quality = round(100 - volume);
  const part = (n: number, more: string, less: string) => `${n >= 0 ? more : less} ${fmtDelta(n)}`;
  const lead = total >= 0 ? `Reach ${total === 0 ? 'held' : 'rose'} ${fmtDelta(total)}` : `Reach fell ${fmtDelta(total)}`;
  const caption = `${lead}: ${part(split.volume, 'posting more', 'posting less')}, ${part(split.quality, 'more per post', 'less per post')} (${fmtExact(split.prevPerPost)} → ${fmtExact(split.perPost)} a post).`;
  return { volume, quality, total, caption };
}

/** A goal as a bar: how far along it is, where it should be by now (pace), and the forecast end. */
export function goalBar(g: Pick<GoalFact, 'actual' | 'target' | 'elapsed' | 'projected' | 'onTrack' | 'done'>): { pct: number; pace: number; projected?: number; tone: 'done' | 'ok' | 'behind' | 'early'; text: string } {
  const t = g.target > 0 ? g.target : 1;
  const pct = clamp((g.actual / t) * 100);
  const pace = clamp(g.elapsed * 100);
  const projected = g.projected === undefined ? undefined : clamp((g.projected / t) * 100);
  const tone = g.done || g.actual >= g.target ? 'done' : g.onTrack === undefined ? 'early' : g.onTrack ? 'ok' : 'behind';
  const text = tone === 'done' ? 'Reached' : tone === 'early' ? 'Too early to call' : tone === 'ok' ? 'On pace' : 'Behind pace';
  return { pct: round(pct), pace: round(pace), ...(projected === undefined ? {} : { projected: round(projected) }), tone, text };
}
const clamp = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(100, x)) : 0);

/** Bars for an ask answer's chart: each value as a share of the biggest. */
export function chartBars(chart: AskChart): { label: string; values: { name: string; value: number; pct: number }[] }[] {
  const max = Math.max(0, ...chart.series.flatMap((s) => s.values.map((v) => Math.abs(v)).filter(Number.isFinite)));
  return chart.labels.map((label, i) => ({ label, values: chart.series.map((s) => ({ name: s.name, value: s.values[i] ?? 0, pct: max ? round((Math.abs(s.values[i] ?? 0) / max) * 100) : 0 })) }));
}

// ── words ──────────────────────────────────────────────────────────────

const CHANNELS: Record<ChannelId, string> = { linkedin: 'LinkedIn', instagram: 'Instagram', youtube: 'YouTube', x: 'X', tiktok: 'TikTok', threads: 'Threads', facebook: 'Facebook', pinterest: 'Pinterest', newsletter: 'Newsletter', blog: 'Blog' };
export const channelLabel = (id: string) => CHANNELS[id as ChannelId] ?? id;

/** Up to four questions worth asking this report, built from what's actually in it. */
export function suggestedQuestions(f: Pick<Facts, 'kpis' | 'waterfall' | 'top' | 'goals' | 'site' | 'channels' | 'notable'>): string[] {
  const q: string[] = [];
  const reach = f.kpis.find((k) => k.key === 'audience');
  if (reach?.change !== undefined && Math.abs(reach.change) >= 0.05) q.push(`Why did reach ${reach.change > 0 ? 'go up' : 'drop'}?`);
  else if (reach) q.push('Why did reach change?');
  if (f.waterfall.length > 1 || f.channels.length > 1) q.push('Which channel grew most?');
  if (f.top[0]) q.push(`Why did “${short(f.top[0].title)}” do so well?`);
  const behind = f.goals.find((g) => g.onTrack === false);
  if (behind) q.push(`How do we get back on pace for ${behind.label.toLowerCase()}?`);
  if (f.site && f.site.keyEvents > 0) q.push('Which posts brought signups?');
  q.push('What should we post next week?');
  return [...new Set(q)].slice(0, 4);
}
const short = (s: string) => (s.length > 40 ? `${s.slice(0, 38).trimEnd()}…` : s);

/** Estimated hours of manual reporting a report saves, from the research's per-report figures. */
export function timeSaved(kind: PeriodKind, period?: Pick<Period, 'start' | 'end'>): number {
  if (kind === 'last7') return 2.5;
  if (kind === 'last30' || kind === 'lastMonth') return 4;
  if (kind === 'lastQuarter') return 6;
  const days = period ? (Date.parse(period.end) - Date.parse(period.start)) / 86_400_000 : 7;
  return days <= 10 ? 2.5 : days <= 45 ? 4 : 6;
}
export const timeSavedText = (hours: number) => `Time saved: about ${hours % 1 ? hours.toFixed(1) : hours} hours (estimate)`;

/**
 * Where a next step's `navigate` goes in this app. The engine speaks in plain paths
 * ('/calendar?plan=1', '/insights?tab=numbers'); the app routes by hash.
 */
export function mapNavigate(nav: string | undefined): string | null {
  if (!nav) return null;
  const [rawPath, query = ''] = nav.replace(/^#/, '').split('?');
  const path = `/${rawPath.replace(/^\/+|\/+$/g, '')}`;
  const qs = new URLSearchParams(query);
  const top = path.split('/')[1] ?? '';
  if (top === 'calendar') return qs.get('plan') ? '/calendar/plan' : qs.get('post') ? `/calendar/post/${qs.get('post')}` : path;
  if (top === 'insights') return qs.get('tab') === 'quality' ? '/insights/quality' : '/insights/performance';
  if (top === 'settings') return qs.get('tab') ? `/settings/${qs.get('tab')}` : path;
  if (['reports', 'library', 'ideas', 'brand', 'new', 'account'].includes(top)) return path;
  return null;
}

/** What to do about the gaps the report admits to: add numbers, connect the website. */
export function coverageFixes(c: Facts['coverage'], canManage: boolean): { label: string; href: string }[] {
  const out: { label: string; href: string }[] = [];
  if (c.missing.length) out.push({ label: c.missing.length === 1 ? 'Add numbers for 1 post' : `Add numbers for ${c.missing.length} posts`, href: c.missing.length === 1 ? `#/calendar/post/${c.missing[0].post}` : '#/insights/performance' });
  if (c.site === 'none') out.push(canManage ? { label: 'Connect your website', href: '#/settings/website' } : { label: 'Ask an admin to connect your website', href: '#/settings/website' });
  return out;
}

/** Visible sections in order, and the ones hidden from this audience. */
export function splitSections(sections: Section[]): { shown: Section[]; hidden: Section[] } {
  return { shown: sections.filter((s) => !s.hidden), hidden: sections.filter((s) => s.hidden) };
}

/** Lines typed into a textarea: one per line, blanks dropped. */
export const linesFrom = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);

/** The download links a report offers. */
export function exportLinks(id: string): { id: string; label: string; hint: string; href: string }[] {
  const base = `/api/reports/${encodeURIComponent(id)}`;
  return [
    { id: 'pdf', label: 'PDF', hint: 'To print or attach', href: `${base}/export/pdf` },
    { id: 'pptx', label: 'PowerPoint', hint: 'Slides for the meeting', href: `${base}/export/pptx` },
    { id: 'csv', label: 'CSV', hint: 'The numbers, for a spreadsheet', href: `${base}/export/csv` },
    { id: 'md', label: 'Markdown', hint: 'Paste into docs or Notion', href: `${base}/export/md` },
    { id: 'card', label: 'Week card image', hint: '1080×1350, for Slack or a post', href: `${base}/card.png` },
  ];
}

/** A share link's full address from the path the server returns. */
export const shareLink = (origin: string, path: string) => (/^https?:\/\//.test(path) ? path : `${origin.replace(/\/$/, '')}/${path.replace(/^\//, '')}`);
export const EXPIRY_CHOICES: { days: number | null; label: string }[] = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: null, label: 'Never' },
];

/** Which chat app a webhook URL belongs to. */
export function webhookKind(url: string): WebhookKind {
  const u = url.trim().toLowerCase();
  if (/hooks\.slack\.com/.test(u)) return 'slack';
  if (/webhook\.office\.com|\.logic\.azure\.com|outlook\.office\.com/.test(u)) return 'teams';
  if (/discord(app)?\.com\/api\/webhooks/.test(u)) return 'discord';
  return 'generic';
}
export const WEBHOOK_LABEL: Record<WebhookKind, string> = { slack: 'Slack', teams: 'Microsoft Teams', discord: 'Discord', generic: 'Webhook' };

const EMAIL = /^[^\s@,;]{1,64}@[^\s@,;]{1,190}\.[^\s@,;]{2,}$/;
/** Addresses from a comma/space/newline-separated list: the valid ones (deduped, lowercased) and the rest. */
export function parseEmails(text: string): { ok: string[]; bad: string[] } {
  const parts = text.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const ok = [...new Set(parts.filter((p) => EMAIL.test(p)))];
  return { ok, bad: parts.filter((p) => !EMAIL.test(p)) };
}

export const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The agency rollup: workspaces that need attention first, then by name. */
export function rollupOrder(items: RollupItem[]): RollupItem[] {
  return [...items].sort((a, b) => Number(b.needsAttention) - Number(a.needsAttention) || a.workspace.name.localeCompare(b.workspace.name));
}

/** Goal metric labels, mirroring the engine's KPI labels. */
export const METRIC_LABEL: Record<KpiKey, string> = {
  posts: 'Posts published', audience: 'People reached', engagement: 'Engagement', rate: 'Engagement rate', clicks: 'Link clicks',
  follows: 'New followers', sessions: 'Website visits', keyEvents: 'Key events', searchClicks: 'Search clicks',
};
export const PER_LABEL: Record<Goal['per'], string> = { week: 'a week', month: 'a month', quarter: 'a quarter' };
export const goalTitle = (g: Pick<Goal, 'metric' | 'target' | 'per' | 'channel' | 'label'>) =>
  g.label?.trim() || `${fmtKpi(g.target, g.metric === 'rate' ? 'percent' : undefined)} ${METRIC_LABEL[g.metric].toLowerCase()} ${PER_LABEL[g.per]}${g.channel ? ` on ${channelLabel(g.channel)}` : ''}`;

/** "3 min ago", "5 h ago", "12 Oct". */
export function ago(iso: string | undefined, now = Date.now()): string {
  if (!iso) return '';
  const m = (now - Date.parse(iso)) / 60_000;
  if (!Number.isFinite(m)) return '';
  if (m < 1.5) return 'just now';
  if (m < 90) return `${Math.round(m)} min ago`;
  if (m < 36 * 60) return `${Math.round(m / 60)} h ago`;
  if (m < 14 * 1440) return `${Math.round(m / 1440)} days ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
