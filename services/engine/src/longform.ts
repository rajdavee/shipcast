import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BANNED_PHRASES, renderSpec } from './specs.ts';
import { callService } from './service.ts';

/**
 * Long-form copy formats (newsletter issue, blog / SEO article): the words are
 * markdown and JSON the model writes, so the checks are deterministic text
 * rules — limits, structure, keyword placement — sent back through the same
 * fix loop as the render audits.
 */

export type FrontMatter = Record<string, string | string[]>;

/** `---` YAML-lite front matter: `key: value`, `key: [a, b]` and `key:` followed by `- item` lines. */
export function parseFrontMatter(md: string): { data: FrontMatter; body: string } {
  const m = md.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: md };
  const data: FrontMatter = {};
  const unq = (s: string) => s.trim().replace(/^(["'])([\s\S]*)\1$/, '$2').trim();
  let key = '';
  for (const line of m[1].split(/\r?\n/)) {
    const item = line.match(/^\s+-\s+(.*)$/) ?? line.match(/^-\s+(.*)$/);
    if (item && key) {
      const cur = data[key];
      data[key] = [...(Array.isArray(cur) ? cur : []), unq(item[1])];
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    key = kv[1].toLowerCase();
    const v = kv[2].trim();
    data[key] = /^\[.*\]$/.test(v) ? v.slice(1, -1).split(',').map(unq).filter(Boolean) : v ? unq(v) : [];
  }
  return { data, body: m[2] };
}

const str = (v: unknown) => (Array.isArray(v) ? v.join(', ') : String(v ?? '')).trim();
const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : String(v ?? '').split(',')).map((x) => x.trim()).filter(Boolean);

/** Markdown with code fences removed (their `#` lines are not headings). */
const prose = (body: string) => body.replace(/^```[\s\S]*?^```\s*$/gm, '');
const plain = (s: string) =>
  s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>|]/g, ' ');
const words = (s: string) => plain(s).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
const norm = (s: string) => ` ${plain(s).toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
const stem = (w: string) => w.replace(/(ies|es|s)$/, '');

/** True when the text says the keyword: the exact phrase, or every one of its words (plural-insensitive). */
export function mentions(text: string, keyword: string): boolean {
  const t = norm(text);
  const k = norm(keyword).trim();
  if (!k) return false;
  if (t.includes(` ${k} `)) return true;
  const have = new Set(t.trim().split(' ').map(stem));
  return k.split(' ').every((w) => have.has(stem(w)));
}

export function headings(body: string): { level: number; text: string }[] {
  return [...prose(body).matchAll(/^(#{1,6})\s+(.+?)\s*#*\s*$/gm)].map((m) => ({ level: m[1].length, text: m[2].trim() }));
}

/** FAQ entries from front matter: `- "Question? | Answer"`. */
export function faqItems(fm: FrontMatter): { q: string; a: string }[] {
  return arr(fm.faq ?? []).map((x) => {
    const [q, ...a] = x.split('|');
    return { q: q.trim(), a: a.join('|').trim() };
  });
}

const CLICKBAIT = /you won'?t believe|shocking|this one (weird )?trick|what happens next|will blow your mind|doctors hate|secret they|\bnobody\b.*\babout\b|!!|\?\?|^\s*(re|fwd?):/i;

/**
 * Blog / SEO article (out/article.md): search-result limits, one H1 and no
 * skipped heading levels, the primary keyword where readers and crawlers look
 * first (title, H1, opening, a subhead) without stuffing, an FAQ, sources,
 * plain words and a 1,200–2,000-word body.
 */
export function checkArticle(md: string | null, opts: { minWords?: number; maxWords?: number } = {}): string[] {
  if (!md?.trim()) return ['out/article.md was not written.'];
  const { data, body } = parseFrontMatter(md);
  const out: string[] = [];
  const at = 'article.md';
  if (!Object.keys(data).length) out.push(`${at}: start with front matter between --- lines (title, description, slug, keyword, keywords, faq).`);
  const title = str(data.title);
  const desc = str(data.description);
  const slug = str(data.slug);
  const kw = str(data.keyword);
  const secondary = arr(data.keywords);
  if (!title) out.push(`${at}: front matter needs a title (≤ 60 characters).`);
  else if (title.length > 60) out.push(`${at}: the title is ${title.length} characters; search results cut it after ~60.`);
  if (!desc) out.push(`${at}: front matter needs a description (the meta description, 70–155 characters).`);
  else if (desc.length > 155) out.push(`${at}: the meta description is ${desc.length} characters; search results cut it after ~155.`);
  else if (desc.length < 70) out.push(`${at}: the meta description is only ${desc.length} characters — say what the reader gets in 70–155.`);
  if (!slug) out.push(`${at}: front matter needs a slug (lowercase-words-with-hyphens).`);
  else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 75) out.push(`${at}: the slug "${slug.slice(0, 40)}" should be lowercase words joined by hyphens, ≤ 75 characters.`);
  if (!kw) out.push(`${at}: front matter needs the primary keyword (keyword: …).`);
  if (secondary.length < 3 || secondary.length > 6) out.push(`${at}: list 3–6 secondary keywords (keywords: [a, b, c]), not ${secondary.length}.`);
  const faq = faqItems(data).filter((f) => f.q && f.a);
  if (faq.length < 3) out.push(`${at}: add an FAQ in the front matter — at least 3 real questions as "Question? | Answer" lines.`);

  const hs = headings(body);
  const h1 = hs.filter((h) => h.level === 1);
  if (h1.length !== 1) out.push(`${at}: use exactly one H1 (# Heading) — found ${h1.length}.`);
  for (let i = 1; i < hs.length; i++) {
    if (hs[i].level > hs[i - 1].level + 1) {
      out.push(`${at}: heading "${hs[i].text.slice(0, 40)}" jumps from H${hs[i - 1].level} to H${hs[i].level} — don't skip levels.`);
      break;
    }
  }
  if (hs.length && hs[0].level !== 1) out.push(`${at}: the article should open with its H1.`);
  const h2 = hs.filter((h) => h.level === 2);
  if (h2.length < 3) out.push(`${at}: break the article into at least 3 H2 sections so it can be scanned.`);
  if (kw) {
    if (title && !mentions(title, kw)) out.push(`${at}: the primary keyword "${kw}" is not in the title.`);
    if (h1[0] && !mentions(h1[0].text, kw)) out.push(`${at}: the primary keyword "${kw}" is not in the H1.`);
    const opening = words(prose(body).replace(/^#\s+.*$/m, '')).slice(0, 100).join(' ');
    if (!mentions(opening, kw)) out.push(`${at}: the primary keyword "${kw}" should appear in the first 100 words — answer the search in the opening paragraph.`);
    if (h2.length && !h2.some((h) => mentions(h.text, kw))) out.push(`${at}: use the primary keyword (or a close variant) in at least one H2.`);
    const all = norm(prose(body));
    const k = norm(kw).trim();
    const hits = k ? all.split(` ${k} `).length - 1 : 0;
    const n = words(prose(body)).length;
    if (n && (hits * k.split(' ').length) / n > 0.025) out.push(`${at}: "${kw}" makes up ${(((hits * k.split(' ').length) / n) * 100).toFixed(1)}% of the words — that reads as keyword stuffing; use it naturally (≤ 2.5%).`);
  }
  const n = words(prose(body)).length;
  const [lo, hi] = [opts.minWords ?? 1200, opts.maxWords ?? 2000];
  if (n < lo || n > hi) out.push(`${at}: the body is ${n} words; aim for ${lo.toLocaleString('en-US')}–${hi.toLocaleString('en-US')}.`);
  if (!/\]\(https?:\/\//.test(body)) out.push(`${at}: cite your sources — link to the page each fact or number comes from.`);
  const lower = [title, desc, body, ...faq.map((f) => `${f.q} ${f.a}`)].join(' ').toLowerCase();
  for (const p of BANNED_PHRASES) if (lower.includes(p)) out.push(`${at}: uses "${p}" — rewrite it in plain, specific words.`);
  return out.slice(0, 14);
}

/** Newsletter issue: one email (email.json) plus its LinkedIn newsletter version (linkedin-article.md). */
export function checkNewsletter(spec: any, linkedin: string | null): string[] {
  const out: string[] = [];
  const emails = Array.isArray(spec?.emails) ? spec.emails : [];
  if (emails.length !== 1) out.push(`email.json: a newsletter issue is one email — found ${emails.length}.`);
  const e = emails[0] ?? {};
  const blocks: any[] = Array.isArray(e.blocks) ? e.blocks.filter((b: any) => b && typeof b === 'object') : [];
  const count = (t: string) => blocks.filter((b) => b.type === t).length;
  for (const s of Array.isArray(e.subjects) ? e.subjects.map(String) : []) {
    if (s.length > 50) out.push(`email.json: subject "${s.slice(0, 36)}…" is ${s.length} characters; keep newsletter subjects ≤ 50.`);
    if (CLICKBAIT.test(s) || /\b[A-Z]{4,}\b/.test(s)) out.push(`email.json: subject "${s.slice(0, 36)}" reads as clickbait — say what the issue is about.`);
  }
  const mast = blocks[0]?.type === 'masthead' ? blocks[0] : null;
  if (!mast) out.push('email.json: open the issue with a `masthead` block (newsletter name, issue number and date).');
  else if (!String(mast.issue ?? '').trim() || !String(mast.date ?? '').trim()) out.push('email.json: the masthead needs both `issue` (e.g. "Issue 12") and `date`.');
  if (!blocks.slice(1, 3).some((b) => b.type === 'hero' || b.type === 'text')) out.push('email.json: the lead story (a `hero` or `text` block) comes right after the masthead.');
  const items = blocks.filter((b) => b.type === 'items').flatMap((b) => (Array.isArray(b.items) ? b.items : []));
  if (count('items') !== 1 || items.length < 2 || items.length > 4) out.push(`email.json: add one \`items\` block with 2–4 short items (found ${items.length}).`);
  if (count('cta') !== 1) out.push(`email.json: use exactly one \`cta\` block for the product ask (found ${count('cta')}).`);
  if (!count('forward')) out.push('email.json: add a `forward` block ("know someone who\'d like this? forward it") before the footer.');
  const copy = JSON.stringify(e).toLowerCase();
  for (const p of BANNED_PHRASES) if (copy.includes(p)) out.push(`email.json: uses "${p}" — rewrite it in plain, specific words.`);
  if (!linkedin?.trim()) out.push('out/linkedin-article.md was not written (the LinkedIn newsletter version of this issue).');
  else {
    const { body } = parseFrontMatter(linkedin);
    const hs = headings(body);
    const h1 = hs.find((h) => h.level === 1);
    if (!h1) out.push('linkedin-article.md: start with the headline as "# Headline".');
    else if (h1.text.length > 100) out.push(`linkedin-article.md: the headline is ${h1.text.length} characters; LinkedIn allows 100.`);
    if (hs.filter((h) => h.level === 2).length < 2) out.push('linkedin-article.md: use at least 2 subheads (## …) so the article scans.');
    if (words(body).length < 250) out.push('linkedin-article.md: the article is too thin — carry the lead story and the items over in full (300+ words).');
    const lower = body.toLowerCase();
    for (const p of BANNED_PHRASES) if (lower.includes(p)) out.push(`linkedin-article.md: uses "${p}" — rewrite it in plain, specific words.`);
  }
  return out.slice(0, 14);
}

/**
 * Second halves of long-form packs, run after the main spec renders: the
 * newsletter's LinkedIn cover (graphics.json) and checks; the article's web
 * preview and checks. Returns problems for the fix loop.
 */
export async function renderExtras(packId: string | undefined, cwd: string, briefDir: string): Promise<string[]> {
  const out = join(cwd, 'out');
  const read = (f: string) => readFile(join(out, f), 'utf8').catch(() => null);
  if (packId === 'newsletter') {
    const fb: string[] = [];
    if (existsSync(join(out, 'graphics.json'))) fb.push(...(await renderSpec('graphics', cwd, briefDir)).feedback);
    else fb.push('out/graphics.json was not written (the 1920×1080 LinkedIn cover, preset article-cover, name linkedin-cover.png).');
    if (!existsSync(join(out, 'linkedin-cover.png')) && existsSync(join(out, 'graphics.json'))) fb.push('graphics.json: name the cover "linkedin-cover.png" so the article can use it.');
    let spec: any = null;
    try {
      spec = JSON.parse((await read('email.json')) ?? 'null');
    } catch {}
    return [...fb, ...checkNewsletter(spec, await read('linkedin-article.md'))];
  }
  if (packId === 'blog-article') {
    const md = await read('article.md');
    const fb = checkArticle(md);
    if (md) {
      try {
        const r = await callService('stills', 'article', { file: join(out, 'article.md'), brandDir: briefDir, outDir: out });
        fb.push(...r.problems);
      } catch (e) {
        fb.push(`article preview failed: ${(e as Error).message.slice(0, 300)}`);
      }
    }
    return fb;
  }
  return [];
}
