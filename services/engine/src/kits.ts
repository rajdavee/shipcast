import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { BANNED_PHRASES } from './specs.ts';
import { parseFrontMatter } from './longform.ts';
import { callService } from './service.ts';
import { run } from './exec.ts';

/**
 * The last kits of sprint v6 — press kit, event kit, release notes, pins and
 * end screens. They reuse the document, landing, slides, graphics and email
 * specs; what is new is checked here: facts that must match across pieces,
 * people that must come from the brief, and the press kit's zip.
 */

/** Speakers and quote givers the brief doesn't name are written as clearly marked placeholders. */
export const PLACEHOLDER_NAME = /placeholder|to confirm|to be confirmed|\btb[ca]\b|^\[.*\]$|speaker name|your name/i;
/** A role label ("Founder, Shipcast") names a seat, not a person, so it can't be a made-up human. */
const ROLE = /^(the\s+)?(co-?founder|founder|ceo|cto|coo|cmo|cpo|chief|head|vp|vice president|director|lead|principal|senior|staff|product|engineering|marketing|design|developer|engineer|manager|host|moderator|team|spokesperson|community|customer|guest)\b/i;

/** True when a person's name is a placeholder or a role label, or appears in the brief; false = possibly invented. */
export function knownPerson(name: string, brief: string): boolean {
  const n = name.trim();
  if (!n) return false;
  if (PLACEHOLDER_NAME.test(n) || ROLE.test(n)) return true;
  const flat = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return ` ${flat(brief)} `.includes(` ${flat(n.split(',')[0])} `);
}

/** Everything the user and the research gave as facts: the brief files plus the format's own options. */
export async function briefText(briefDir: string, options: Record<string, unknown> = {}): Promise<string> {
  const files = await Promise.all(['brief.md', 'product-facts.md', 'CAMPAIGN-BRIEF.md', 'brand.json'].map((f) => readFile(join(briefDir, f), 'utf8').catch(() => '')));
  return [...files, ...Object.values(options).map((v) => (typeof v === 'string' ? v : ''))].join('\n');
}

const texts = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(texts) : v && typeof v === 'object' ? Object.values(v).flatMap(texts) : []);
const wordCount = (s: string) => s.replace(/[*_#>=`]/g, ' ').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const banned = (where: string, s: string) => BANNED_PHRASES.filter((p) => s.toLowerCase().includes(p)).map((p) => `${where}: uses "${p}" — rewrite it in plain, specific words.`);
const SUPERLATIVE = /\b(the (?:best|fastest|easiest|cheapest|leading|largest|biggest|most (?:advanced|powerful|trusted|popular|complete))|best-in-class|industry-leading|world-leading|world-class|market-leading|first-ever|world'?s first|the (?:only|first) \w+ (?:to|that)|unmatched|unparalleled|unrivall?ed|#1|number one)\b/i;
const SOURCED = /\[\d+\]|according to|\bsource\b|survey|study|report(ed)? by|\bper\b \w+ (?:data|research)|\(\d{4}\)/i;

/** Superlatives a journalist would ask "says who?" about: flagged unless the sentence cites where it comes from. */
export function unsourcedSuperlatives(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .filter((s) => SUPERLATIVE.test(s) && !SOURCED.test(s))
    .map((s) => s.match(SUPERLATIVE)![0]);
}

// ── press kit ───────────────────────────────────────────────────────────

export interface PressKitManifest {
  screenshots?: (string | { file: string; caption?: string })[];
  logos?: string[];
}

const file = (x: unknown) => String(typeof x === 'object' && x ? (x as { file?: string }).file ?? '' : x ?? '').trim();

/**
 * Press release (document.json, press-release pages), fact sheet
 * (fact-sheet.json) and the zip manifest (press-kit.json): the parts a
 * newsroom looks for, ≤ 800 words, quotes only from people the brief names.
 */
export function checkPressKit(doc: any, fact: any, kit: PressKitManifest | null, brief: string, exists: (p: string) => boolean = () => true): string[] {
  const out: string[] = [];
  const pages: any[] = Array.isArray(doc?.pages) ? doc.pages : [];
  const pr = pages.filter((p) => p?.layout === 'press-release').map((p) => p.fields ?? {});
  if (!pr.length || pr.length !== pages.length) out.push('document.json: a press release is press-release pages only (1–2 of them).');
  const first = pr[0] ?? {};
  const headline = String(first.headline ?? '').replace(/[*=]/g, '').trim();
  if (!headline) out.push('document.json: page 1 needs the headline.');
  else if (headline.length > 120) out.push(`document.json: the headline is ${headline.length} characters; keep it ≤ 120.`);
  const dateline = String(first.dateline ?? '').trim();
  if (!dateline) out.push('document.json: page 1 needs a dateline ("CITY, 3 November 2026").');
  else if (!/\b(19|20)\d{2}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.test(dateline)) out.push(`document.json: the dateline "${dateline}" has no date — "CITY, 3 November 2026".`);
  if (!String(first.lead ?? '').trim()) out.push('document.json: page 1 needs the lead paragraph — who, what, when, where and why in ≤ 60 words.');
  const story = pr.flatMap((f) => [f.headline, f.subhead, f.lead, f.body, ...texts(f.quotes)]).filter(Boolean).join('\n');
  const n = wordCount(story);
  if (n > 800) out.push(`document.json: the release is ${n} words; keep it ≤ 800 (boilerplate and contact not counted).`);
  else if (n < 250) out.push(`document.json: the release is only ${n} words — give the facts a journalist needs (300–600 words).`);
  const about = pr.map((f) => String(f.about ?? '')).find((s) => s.trim());
  if (!about || wordCount(about) < 30) out.push('document.json: add the boilerplate — "about" on the last page, 50–100 words on what the company is and does.');
  const contact = pr.flatMap((f) => texts(f.contact)).join(' ');
  if (!/@|\+?\d[\d ()-]{6,}/.test(contact)) out.push('document.json: add the media contact on the last page — a name or role and a press email or phone.');
  if (pages.length && pages[pages.length - 1]?.layout !== 'press-release') out.push('document.json: end on a press-release page so the release closes with ###.');
  const quotes = pr.flatMap((f) => texts(f.quotes));
  if (quotes.length > 2) out.push(`document.json: ${quotes.length} quotes — a release carries 1–2.`);
  for (const q of quotes) {
    const [, ...who] = q.split('|').map((x) => x.trim());
    const by = who.join(', ');
    if (!by) out.push(`document.json: the quote "${q.slice(0, 40)}…" has no attribution — "exact words | Name, Role, Company".`);
    else if (!knownPerson(by, brief)) out.push(`document.json: "${by.split(',')[0]}" isn't named in the brief — quote only people the brief names, or set the name to "[Placeholder — quote from a named spokesperson]".`);
  }
  const all = [story, about ?? ''].join('\n');
  out.push(...banned('document.json', all));
  for (const s of [...new Set(unsourcedSuperlatives(all))]) out.push(`document.json: "${s}" is a superlative with no source — cite one in the same sentence ("according to …", "[1]") or say what is measurably true.`);
  const fs: any[] = Array.isArray(fact?.pages) ? fact.pages : [];
  if (!fact) out.push('out/fact-sheet.json was not written (a one-page document with the fact-sheet layout).');
  else if (fs.length !== 1 || fs[0]?.layout !== 'fact-sheet') out.push('fact-sheet.json: one page, layout fact-sheet.');
  else {
    if (texts(fs[0].fields?.facts).length < 4) out.push('fact-sheet.json: list at least 4 facts ("label | value").');
    for (const x of texts(fs[0].fields?.numbers)) if (!(x.split('|')[2] ?? '').trim()) out.push(`fact-sheet.json: the number "${x.split('|')[0].trim()}" needs its source ("value | label | source").`);
    out.push(...banned('fact-sheet.json', texts(fs[0].fields).join(' ')));
  }
  if (!kit) out.push('out/press-kit.json was not written ({"screenshots": [{"file", "caption"}], "logos": [...]}).');
  else {
    const shots = (kit.screenshots ?? []).map(file).filter(Boolean);
    if (shots.length < 3 || shots.length > 6) out.push(`press-kit.json: include 3–6 product screenshots, not ${shots.length}.`);
    for (const s of shots) {
      if (s.includes('#')) out.push(`press-kit.json: ${s} — the press kit ships screenshots at full resolution; drop the #crop.`);
      else if (!exists(s)) out.push(`press-kit.json: ${s} doesn't exist — use real files from the brief's assets/.`);
    }
    for (const l of kit.logos ?? []) if (!exists(file(l))) out.push(`press-kit.json: logo ${file(l)} doesn't exist — list the logo files in the brief.`);
  }
  return out.slice(0, 16);
}

/** Pixel size from a PNG or JPEG header, for the press kit's README. */
export async function imageSize(path: string): Promise<{ w: number; h: number } | null> {
  const b = await readFile(path).catch(() => null);
  if (!b) return null;
  if (b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i < b.length - 9; ) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}

/**
 * out/press-kit.zip: the release and fact sheet PDFs, the brief's logo files,
 * the screenshots untouched at full resolution and a README of what's inside.
 */
export async function buildPressKit(out: string, briefDir: string, kit: PressKitManifest, opts: { company?: string; contact?: string } = {}): Promise<string[]> {
  const stage = join(out, '..', 'work', 'press-kit');
  await rm(stage, { recursive: true, force: true });
  await mkdir(join(stage, 'logos'), { recursive: true });
  await mkdir(join(stage, 'screenshots'), { recursive: true });
  const problems: string[] = [];
  const rows: string[] = [];
  const add = async (from: string, to: string, what: string) => {
    if (!existsSync(from)) return void problems.push(`press kit: ${what} (${basename(from)}) is missing.`);
    await copyFile(from, join(stage, to));
    const sz = await imageSize(from);
    rows.push(`| ${to} | ${what}${sz ? ` · ${sz.w}×${sz.h}` : ''} · ${Math.max(1, Math.round((await stat(from)).size / 1024))} KB |`);
  };
  await add(join(out, 'document.pdf'), 'press-release.pdf', 'Press release');
  await add(join(out, 'fact-sheet', 'fact-sheet.pdf'), 'fact-sheet.pdf', 'Fact sheet');
  const logos = (kit.logos ?? []).map(file).filter(Boolean);
  for (const l of logos) await add(join(briefDir, l), `logos/${basename(l)}`, 'Logo');
  for (const [i, s] of (kit.screenshots ?? []).entries()) {
    const f = file(s);
    if (!f || f.includes('#')) continue;
    const cap = typeof s === 'object' && s?.caption ? s.caption : 'Product screenshot';
    await add(join(briefDir, f), `screenshots/${String(i + 1).padStart(2, '0')}-${basename(f).replace(/[^\w.-]/g, '_')}`, cap);
  }
  const readme = [
    `# ${opts.company ?? 'Press kit'} — press kit`,
    '',
    'What is inside:',
    '',
    '| File | What it is |',
    '|---|---|',
    ...rows,
    '',
    'Screenshots are real product screens at full resolution. Logos are the files we use ourselves; please do not recolour or redraw them.',
    opts.contact ? `\nPress contact: ${opts.contact}` : '',
  ].join('\n');
  await writeFile(join(stage, 'README.md'), readme.trimEnd() + '\n');
  await rm(join(out, 'press-kit.zip'), { force: true });
  const z = await run('zip', ['-qr', join(out, 'press-kit.zip'), '.'], { cwd: stage });
  if (z.code !== 0) problems.push(`press kit: zip failed — ${z.stderr.slice(0, 200)}`);
  return problems;
}

// ── event kit ───────────────────────────────────────────────────────────

export interface EventFacts {
  title: string;
  date: string;
  time: string;
  timezone: string;
  url: string;
  speakers?: { name: string; role?: string }[];
}

const TZ = /\b(UTC|GMT|BST|IST|CET|CEST|EET|EEST|WET|WEST|ET|EST|EDT|CT|CST|CDT|MT|MST|MDT|PT|PST|PDT|AEST|AEDT|AWST|JST|KST|SGT|HKT|NZST|NZDT|BRT|UTC[+-]\d{1,2}(?::\d{2})?|GMT[+-]\d{1,2})\b/g;
const TIME = /\b\d{1,2}(?::\d{2}|\s?(?:am|pm))\b/gi;
const host = (u: string) => u.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[?#].*$/, '').replace(/\/+$/, '');

/**
 * Event kit: out/event.json is the single source of truth; the landing page,
 * slides, three promo posts and three emails must state the same date, time
 * and timezone, link to the same registration page and name the same speakers.
 */
export function checkEventKit(ev: EventFacts | null, pieces: { landing: any; slides: any; graphics: any; email: any }, brief: string): string[] {
  const out: string[] = [];
  if (!ev) return ['out/event.json was not written ({"title", "date", "time", "timezone", "url", "speakers": [{"name", "role"}]}) — every piece copies its facts from it.'];
  for (const k of ['title', 'date', 'time', 'timezone', 'url'] as const) if (!String(ev[k] ?? '').trim()) out.push(`event.json: "${k}" is empty.`);
  if (out.length) return out;
  const names = (ev.speakers ?? []).map((s) => String(s?.name ?? '').trim()).filter(Boolean);
  if (!names.length) out.push('event.json: list the speakers (names from the brief, otherwise "[Speaker — to confirm]").');
  for (const n of names) if (!knownPerson(n, brief)) out.push(`event.json: speaker "${n}" isn't named in the brief — use a name the brief gives, a role label ("Founder, Shipcast") or "[Speaker — to confirm]".`);
  const reg = host(ev.url);
  const tz = ev.timezone.trim().toUpperCase();
  /** Same date, time and timezone, nothing contradicting them, and a link to the registration page. */
  const piece = (label: string, blob: unknown, skip: (k: string) => boolean = () => false, link = true) => {
    const strs: string[] = [];
    const walk = (v: unknown, key: string) => {
      if (skip(key)) return;
      if (typeof v === 'string') strs.push(v);
      else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
    };
    walk(blob, '');
    const t = strs.join('\n');
    const miss = [['date', ev.date], ['time', ev.time], ['timezone', ev.timezone]].filter(([, v]) => !t.includes(v)).map(([k, v]) => `${k} "${v}"`);
    if (miss.length) out.push(`${label}: doesn't state the ${miss.join(', ')} exactly as event.json does.`);
    const zones = [...new Set([...t.matchAll(TZ)].map((m) => m[0].toUpperCase()))].filter((z) => z !== tz && !tz.includes(z));
    if (zones.length) out.push(`${label}: mentions ${zones.join(', ')} but the event is in ${ev.timezone} — use one timezone everywhere.`);
    const times = [...new Set([...t.matchAll(TIME)].map((m) => m[0].toLowerCase()))].filter((x) => x !== ev.time.toLowerCase() && !ev.time.toLowerCase().includes(x));
    if (times.length) out.push(`${label}: says ${times.slice(0, 2).join(', ')} but the event starts at ${ev.time} — keep times identical (agenda items go in the agenda only).`);
    if (link && !strs.some((s) => host(s) === reg || host(s).startsWith(`${reg}`))) out.push(`${label}: has no registration link — the CTA must point at ${ev.url}.`);
    return t;
  };
  const speakersIn = (label: string, list: string[]) => {
    const got = list.map((x) => x.split('|')[0].trim()).filter(Boolean);
    const extra = got.filter((g) => !names.includes(g));
    const missing = names.filter((n) => !got.includes(n));
    if (extra.length) out.push(`${label}: speaker "${extra[0]}" isn't in event.json — use the same names everywhere.`);
    if (missing.length) out.push(`${label}: leaves out ${missing.map((m) => `"${m}"`).join(', ')} — every piece that lists speakers lists all of them.`);
  };
  const L = pieces.landing;
  if (!L) out.push('landing.json was not written (the registration page).');
  else {
    const secs: any[] = Array.isArray(L.sections) ? L.sections : [];
    for (const t of ['event', 'speakers', 'agenda', 'faq', 'cta']) if (!secs.some((s) => s?.type === t)) out.push(`landing.json: the registration page needs an "${t}" section.`);
    const evs = secs.find((s) => s?.type === 'event');
    if (evs && (evs.date !== ev.date || evs.time !== ev.time || evs.timezone !== ev.timezone)) out.push('landing.json: the event section\'s date, time and timezone must be copied from event.json.');
    if (evs && host(String(evs.url ?? '')) !== reg) out.push(`landing.json: the event section's register button must link to ${ev.url}.`);
    piece('landing.json', secs.filter((s) => s?.type !== 'agenda'), (k) => k === 'type');
    const sp = secs.find((s) => s?.type === 'speakers');
    if (sp) speakersIn('landing.json speakers', texts(sp.items));
  }
  const S = pieces.slides;
  if (!S) out.push('slides.json was not written (title, agenda and speaker slides).');
  else {
    const sl: any[] = Array.isArray(S.slides) ? S.slides : [];
    for (const [l, what] of [['title', 'title'], ['agenda', 'agenda'], ['team', 'speakers (layout team)']]) if (!sl.some((s) => s?.layout === l)) out.push(`slides.json: add the ${what} slide.`);
    const title = sl.find((s) => s?.layout === 'title');
    if (title) piece('slides.json title slide', title.fields, () => false, false);
    if (!texts(sl).some((s) => host(s) === reg)) out.push(`slides.json: show the registration link (${ev.url}) — on the closing slide.`);
    const team = sl.find((s) => s?.layout === 'team');
    if (team) speakersIn('slides.json speakers', texts(team.fields?.people));
  }
  const G = pieces.graphics;
  const posts: any[] = (Array.isArray(G?.items) ? G.items : []).filter((i: any) => i?.layout === 'event-promo');
  for (const p of ['instagram-post', 'linkedin-image', 'linkedin-landscape']) if (!posts.some((i) => i.preset === p)) out.push(`graphics.json: add the ${p} promo post (layout event-promo).`);
  for (const p of posts) {
    const f = p.fields ?? {};
    if (f.date !== ev.date || f.time !== ev.time || f.timezone !== ev.timezone) out.push(`graphics.json ${p.name}: date, time and timezone must be copied from event.json.`);
    if (host(String(f.url ?? '')) !== reg) out.push(`graphics.json ${p.name}: the URL must be the registration page (${ev.url}).`);
    if (!String(f.cta ?? '').trim()) out.push(`graphics.json ${p.name}: add the register CTA.`);
    if (texts(f.speakers).length) speakersIn(`graphics.json ${p.name}`, texts(f.speakers));
  }
  const E: any[] = Array.isArray(pieces.email?.emails) ? pieces.email.emails : [];
  for (const k of ['invite', 'reminder', 'replay']) {
    const e = E.find((x) => new RegExp(k, 'i').test(String(x?.name ?? '')));
    if (!e) {
      out.push(`email.json: add the ${k} email (name it "${k}").`);
      continue;
    }
    piece(`email.json ${k}`, e.blocks, (key) => key === 'type' || key === 'image');
    if (!(e.blocks ?? []).some((b: any) => b?.cta && host(String(b.url ?? '')) === reg)) out.push(`email.json ${k}: the button must link to ${ev.url}${k === 'replay' ? ' (the replay lives on the same page)' : ''}.`);
  }
  if (E.length && E.length !== 3) out.push(`email.json: the kit is 3 emails (invite, reminder, replay), not ${E.length}.`);
  out.push(...banned('event kit', [texts(L), texts(S), texts(G), texts(pieces.email)].flat().join(' ')));
  return [...new Set(out)].slice(0, 18);
}

// ── release notes ───────────────────────────────────────────────────────

/**
 * Release notes (graphics.json + release-notes.md): one version and date
 * everywhere, two sizes of every feature card with a real screenshot, and a
 * summary card short enough to read.
 */
export function checkReleaseNotes(spec: any, md: string | null, shot: (p: string) => string | null): string[] {
  const out: string[] = [];
  const items: any[] = Array.isArray(spec?.items) ? spec.items : [];
  const cards = items.filter((i) => i?.layout === 'whats-new');
  const sums = items.filter((i) => i?.layout === 'release-summary');
  let version = '';
  let date = '';
  if (!md?.trim()) out.push('out/release-notes.md was not written (front matter with version and date, then "## Changelog" and "## Social post").');
  else {
    const { data, body } = parseFrontMatter(md);
    version = String(data.version ?? '').trim();
    date = String(data.date ?? '').trim();
    if (!version || !date) out.push('release-notes.md: front matter needs the version and the release date (version: v2.4, date: 3 Nov 2026).');
    const sec = (h: string) => body.split(/^##\s+/m).find((p) => p.toLowerCase().startsWith(h))?.split('\n').slice(1).join('\n').trim() ?? '';
    const log = sec('changelog');
    const post = sec('social');
    if (!log) out.push('release-notes.md: add the "## Changelog" entry (Added / Changed / Fixed, one line each).');
    else if (version && !body.includes(version)) out.push(`release-notes.md: the changelog entry should name ${version}.`);
    if (!post) out.push('release-notes.md: add the "## Social post" (≤ 280 characters, the one change people will care about).');
    else if (post.length > 280) out.push(`release-notes.md: the social post is ${post.length} characters; keep it ≤ 280.`);
    out.push(...banned('release-notes.md', body));
  }
  if (!cards.length) out.push('graphics.json: add a "What\'s new" card (layout whats-new) for each headline feature.');
  if (!sums.length) out.push('graphics.json: add the summary card (layout release-summary, preset linkedin-image).');
  for (const i of [...cards, ...sums]) {
    const f = i.fields ?? {};
    if (!String(f.version ?? '').trim() || !String(f.date ?? '').trim()) out.push(`graphics.json ${i.name}: needs the version and date.`);
    else if (version && date && (f.version.trim() !== version || f.date.trim() !== date)) out.push(`graphics.json ${i.name}: says ${f.version} · ${f.date} but release-notes.md says ${version} · ${date} — use the same everywhere.`);
  }
  if (new Set([...cards, ...sums].map((i) => `${i.fields?.version}|${i.fields?.date}`)).size > 1) out.push('graphics.json: the cards disagree on version or date — use one of each.');
  for (const s of sums) {
    const n = texts(s.fields?.items).length;
    if (n > 5) out.push(`graphics.json ${s.name}: ${n} items on the summary card — keep ≤ 5 (the rest go in the changelog).`);
    else if (n < 2) out.push(`graphics.json ${s.name}: a summary card lists 2–5 changes.`);
  }
  const titles = [...new Set(cards.map((c) => String(c.fields?.title ?? '')))];
  for (const t of titles) {
    const set = cards.filter((c) => String(c.fields?.title ?? '') === t);
    for (const p of ['linkedin-landscape', 'linkedin-image']) if (!set.some((c) => c.preset === p)) out.push(`graphics.json: "${t.replace(/[*=]/g, '').slice(0, 40)}" has no ${p} card — make both sizes for every feature.`);
  }
  for (const c of cards) {
    const why = shot(String(c.fields?.image ?? ''));
    if (why) out.push(`graphics.json ${c.name}: ${why}`);
  }
  return [...new Set(out)].slice(0, 16);
}

// ── pins and end screens ────────────────────────────────────────────────

const LINK = /https?:\/\/|www\.|\b[\w-]+\.(?:com|io|app|dev|co|net|org|ai|so|xyz|tech|me)\b(?:\/\S*)?/i;
const PLATFORM = /pinterest|youtube|yt-|subscribe-button/i;

/** Pins (3–5, no link text, our mark only) and one end-screen background with its zones clear. */
export function checkPins(spec: any): string[] {
  const out: string[] = [];
  const items: any[] = Array.isArray(spec?.items) ? spec.items : [];
  const pins = items.filter((i) => i?.preset === 'pinterest-pin');
  const ends = items.filter((i) => i?.preset === 'youtube-endscreen');
  if (pins.length < 3 || pins.length > 5) out.push(`graphics.json: make 3–5 pins (preset pinterest-pin), not ${pins.length}.`);
  if (ends.length !== 1) out.push(`graphics.json: make exactly one end-screen background (preset youtube-endscreen), not ${ends.length}.`);
  for (const p of pins) {
    if (p.layout !== 'pin') out.push(`graphics.json ${p.name}: pins use the pin layout.`);
    const words = texts([p.fields?.title, p.fields?.sub, p.fields?.kicker]).join(' ');
    const m = words.match(LINK);
    if (m) out.push(`graphics.json ${p.name}: "${m[0]}" is link text baked into the pin — Pinterest carries the link; take it off the image.`);
  }
  for (const e of ends) {
    if (e.layout !== 'end-screen') out.push(`graphics.json ${e.name}: the end screen uses the end-screen layout (it keeps the element zones clear).`);
    if (/^(yes|true)$/i.test(String(e.fields?.guides ?? ''))) out.push(`graphics.json ${e.name}: drop "guides" — the preview with outlines is made for you; the upload must be clean.`);
  }
  for (const i of [...pins, ...ends]) if (texts([i.fields?.image]).some((x) => PLATFORM.test(x))) out.push(`graphics.json ${i.name}: no platform logos or buttons — only our own mark and real screenshots.`);
  return out.slice(0, 12);
}

// ── wiring ──────────────────────────────────────────────────────────────

/**
 * Runs after the main specs render, every fix round: the press kit's fact
 * sheet and zip, the end screen's guide preview, and each kit's checks.
 * Returns problems for the fix loop.
 */
export async function renderKits(packId: string | undefined, cwd: string, briefDir: string, options: Record<string, unknown> = {}): Promise<string[]> {
  if (!packId || !['press-kit', 'event-kit', 'release-notes', 'pins-endscreens'].includes(packId)) return [];
  const out = join(cwd, 'out');
  const json = async (f: string) => {
    try {
      return JSON.parse(await readFile(join(out, f), 'utf8'));
    } catch (e) {
      if (existsSync(join(out, f))) throw new Error(`out/${f} is not valid JSON: ${(e as Error).message}`);
      return null;
    }
  };
  const inBrief = (p: string) => !!p && existsSync(p.startsWith('/') ? p : join(briefDir, p));
  try {
    const brief = await briefText(briefDir, options);
    if (packId === 'press-kit') {
      const doc = await json('document.json');
      const fact = await json('fact-sheet.json');
      const kit = (await json('press-kit.json')) as PressKitManifest | null;
      const fb: string[] = [];
      if (fact) {
        try {
          const r = await callService('stills', 'document', { size: doc?.size, theme: doc?.theme, ...fact, brandDir: briefDir, outDir: join(out, 'fact-sheet'), name: 'fact-sheet' });
          fb.push(...r.problems.map((p: string) => `fact-sheet.json: ${p}`));
        } catch (e) {
          fb.push(`fact-sheet.json: render failed — ${(e as Error).message.slice(0, 300)}`);
        }
      }
      const checks = checkPressKit(doc, fact, kit, brief, inBrief);
      const last = (doc?.pages ?? []).at(-1)?.fields ?? {};
      if (kit && existsSync(join(out, 'document.pdf'))) fb.push(...(await buildPressKit(out, briefDir, kit, { company: last.company, contact: texts(last.contact).join(' · ') })));
      return [...checks, ...fb];
    }
    if (packId === 'event-kit') {
      const [ev, landing, slides, graphics, email] = await Promise.all(['event.json', 'landing.json', 'slides.json', 'graphics.json', 'email.json'].map(json));
      return checkEventKit(ev, { landing, slides, graphics, email }, brief);
    }
    if (packId === 'release-notes') {
      let logos = new Set<string>();
      try {
        const b = JSON.parse(await readFile(join(briefDir, 'brand.json'), 'utf8'));
        logos = new Set([b.logo, ...(Array.isArray(b.productImages) ? b.productImages : [])].filter(Boolean).map((x: string) => basename(String(x))));
      } catch {}
      const shot = (raw: string) => {
        const p = raw.split('#')[0].trim();
        if (!p) return 'needs a real screenshot of the feature (image).';
        if (!/\.(png|jpe?g|webp)$/i.test(extname(p))) return `${p} isn't a screenshot (png, jpg or webp).`;
        if (logos.has(basename(p)) || /logo|mark|icon/i.test(basename(p))) return `${basename(p)} is a logo or marketing graphic — show the real screen where the feature lives.`;
        if (!inBrief(p)) return `${p} doesn't exist — use a real screenshot from the brief's assets/.`;
        return null;
      };
      return checkReleaseNotes(await json('graphics.json'), await readFile(join(out, 'release-notes.md'), 'utf8').catch(() => null), shot);
    }
    const spec = await json('graphics.json');
    const fb = checkPins(spec);
    // The end screen with its element zones outlined, so the user (and the critic) see where YouTube puts its videos.
    const end = (spec?.items ?? []).find((i: any) => i?.preset === 'youtube-endscreen' && i?.layout === 'end-screen');
    if (end) {
      const name = String(end.name ?? 'endscreen/end-screen.png').replace(/\.(png|jpe?g)$/i, '') + '.guides.png';
      await callService('stills', 'graphics', { items: [{ ...end, name, fields: { ...end.fields, guides: 'yes' } }], brandDir: briefDir, outDir: out }).catch(() => null);
    }
    return fb;
  } catch (e) {
    return [(e as Error).message.slice(0, 400)];
  }
}
