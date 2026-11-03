import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

// Newsletter issues and blog / SEO articles: deterministic copy checks, plus real renders when Chrome is here.
const home = mkdtempSync(join(tmpdir(), 'shipcast-longform-'));
process.env.SHIPCAST_HOME = home;
const { findChrome, browser, checkArticle, checkNewsletter, parseFrontMatter, mentions, previews, loadPacks, validatePack, PLUGIN_DIR, PACK_CHANNEL } = await import('@shipcast/engine');
const { createStillsService } = await import('@shipcast/stills');

const hasChrome = !!findChrome();
let stills: ReturnType<typeof createStillsService> | null = null;
let base = '';
before(async () => {
  if (!hasChrome) return;
  stills = createStillsService();
  await stills.listen(0);
  base = `http://127.0.0.1:${(stills.server.address() as AddressInfo).port}`;
});
after(async () => {
  await stills?.close();
  await browser().close();
  if (!process.env.KEEP) rmSync(home, { recursive: true, force: true });
});
const run = async (kind: string, input: unknown) => (await fetch(`${base}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, input }) })).json();
const brand = { name: 'Shipcast', colors: { background: '#0b0d12', primary: '#2b3bff' } };

/** A Shipcast-branded sample article of `n` body paragraphs (~95 words each). */
function article(n = 15, fm: Record<string, string> = {}): string {
  const para = (i: number) =>
    `Shipcast renders every format on your own machine, so drafts never leave your laptop. Step ${i} covers how the studio turns a product page into posts, slides and short videos, which checks run after each render, and what you can change before anything ships. You keep the files, you keep the brand kit, and the next run starts from the lessons the last one learned. Each output is checked for overflow, safe zones and legibility, and problems go back to the writer with a specific fix rather than a vague score.`;
  const front = {
    title: 'Launch campaign generator: one link to a full kit',
    description: 'How a local launch campaign generator turns one product link into videos, carousels, decks and posts — and how each piece is checked.',
    slug: 'launch-campaign-generator',
    keyword: 'launch campaign generator',
    keywords: '[local-first marketing, product launch kit, social carousel, launch video]',
    ...fm,
  };
  return `---\n${Object.entries(front).map(([k, v]) => `${k}: ${v}`).join('\n')}\nfaq:\n  - "Does it need an API key? | No — it runs on the login you already have."\n  - "Where do files go? | Into a folder on your machine; nothing is uploaded."\n  - "Which formats? | Videos, carousels, decks, emails, landing pages and posts."\n---\n\n# How a launch campaign generator builds a whole kit from one link\n\nA launch campaign generator takes one product link and returns everything launch week needs. ${para(0)}\n\n${Array.from({ length: n }, (_, i) => `${i % 4 === 0 ? `## ${i === 0 ? 'What the launch campaign generator makes' : `Part ${i / 4 + 1} of the workflow`}\n\n` : ''}${i === 2 ? '### A closer look\n\n' : ''}${para(i + 1)}${i === 1 ? ' See the [Node.js release schedule](https://nodejs.org/en/about/previous-releases) for the runtime it needs.' : ''}\n\n${i === 3 ? '![The studio home screen](figures/01-studio.png)\n\n' : ''}`).join('')}`;
}

test('newsletter and blog-article packs load, validate and point at their Shipcast skills', async () => {
  const packs = await loadPacks(true);
  for (const [id, spec] of Object.entries({ newsletter: 'email', 'blog-article': 'graphics' })) {
    const p = packs.find((x) => x.id === id);
    assert.ok(p, `${id} is bundled`);
    assert.deepEqual(validatePack(p!, id), []);
    assert.equal(p!.spec, spec);
    const skill = p!.prompt.match(/shipcast:([\w-]+)/)?.[1];
    assert.ok(skill && existsSync(join(PLUGIN_DIR, 'skills', skill, 'SKILL.md')), `${id} → ${skill}`);
    assert.ok(PACK_CHANNEL[id], `${id} has a brand-voice channel`);
  }
});

test('front matter parses scalars, inline lists and dash lists', () => {
  const { data, body } = parseFrontMatter('---\ntitle: "Hello: world"\nkeywords: [a, b , c]\nfaq:\n  - "Q? | A"\n  - Q2? | A2\n---\n# Body\n');
  assert.equal(data.title, 'Hello: world');
  assert.deepEqual(data.keywords, ['a', 'b', 'c']);
  assert.deepEqual(data.faq, ['Q? | A', 'Q2? | A2']);
  assert.equal(body.trim(), '# Body');
  assert.ok(mentions('Our Launch Campaign Generators compared', 'launch campaign generator'));
  assert.ok(!mentions('A launch kit', 'launch campaign generator'));
});

test('the article check passes a well-formed piece and catches each SEO rule', () => {
  assert.deepEqual(checkArticle(article()), []);
  const p = (md: string) => checkArticle(md).join(' | ');
  assert.match(p(article(15, { title: 'A'.repeat(61) })), /title is 61 characters/);
  assert.match(p(article(15, { description: 'x'.repeat(156) })), /meta description is 156/);
  assert.match(p(article(15, { title: 'One link, a whole launch' })), /not in the title/);
  assert.match(p(article(15, { keywords: '[one]' })), /3–6 secondary keywords/);
  assert.match(p(article(15, { slug: 'Not A Slug' })), /slug/);
  assert.match(p(article(4)), /the body is \d+ words; aim for 1,200–2,000/);
  assert.match(p(article(24)), /aim for 1,200–2,000/);
  assert.match(p(article().replace('### A closer look', '#### A closer look')), /jumps from H2 to H4/);
  assert.match(p(article().replace('## Part 2', '# Part 2')), /exactly one H1 .* found 2/);
  assert.match(p(article().replace(/^# How a launch campaign generator/m, '# How one link')), /not in the H1/);
  assert.match(p(article().replace('A launch campaign generator takes', 'This tool takes')), /first 100 words/);
  assert.match(p(article().replace(/\nfaq:\n(  - .*\n)+/, '\n')), /add an FAQ/);
  assert.match(p(article().replace(/\]\(https:[^)]+\)/, '(no link)')), /cite your sources/);
  assert.match(p(article().replace('drafts never leave', 'drafts seamlessly never leave')), /"seamless"/);
  assert.match(p(article().replace(/^## What the launch campaign generator makes/m, '## What it makes')), /at least one H2/);
  assert.match(p(article().replaceAll('Shipcast renders every format', 'The launch campaign generator renders every launch campaign generator format')), /keyword stuffing/);
  assert.deepEqual(checkArticle(null), ['out/article.md was not written.']);
});

const issue = (patch: (e: any) => void = () => {}) => {
  const e: any = {
    name: 'Shipcast Notes 12',
    subjects: ['Captions that keep up with you', 'What we fixed in captions', 'Issue 12: captions'],
    preheader: 'Word-timed captions, safer crops and one new format to try this week.',
    blocks: [
      { type: 'masthead', title: 'Shipcast Notes', issue: 'Issue 12', date: '3 Nov 2026', tagline: 'What we shipped, every other Tuesday' },
      { type: 'hero', kicker: 'Lead story', headline: 'Captions that *keep up*', body: 'Captions now follow each spoken word, so a muted feed still reads the whole clip.' },
      { type: 'items', heading: 'Also this issue', items: ['Safer crops | Screenshots are cut to the part that proves the point. | https://shipcast.dev/changelog', 'Quote cards | Pull quotes and testimonials at three sizes.', 'Nightly checks | Two formats re-made and scored every night.'] },
      { type: 'cta', headline: 'Try the new captions', body: 'Free and local.', cta: 'Open Shipcast', url: 'https://shipcast.dev' },
      { type: 'forward', url: 'https://shipcast.dev/newsletter' },
    ],
    signoff: '— The Shipcast team',
  };
  patch(e);
  return { theme: 'light', footer: { address: '100 Sample Street, Example City', reason: 'You subscribed to Shipcast Notes.' }, emails: [e] };
};
const li = `# Captions that keep up with you\n\n${'Captions now follow each spoken word, so a muted feed still reads the whole clip. '.repeat(14)}\n\n## Also this issue\n\n${'Safer crops cut screenshots to the part that proves the point. '.repeat(14)}\n\n## Try it\n\n${'Shipcast is free and runs on your own machine. '.repeat(8)}\n`;

test('the newsletter check wants one issue, a masthead, 2–4 items, one ask, a forward line and the LinkedIn version', () => {
  assert.deepEqual(checkNewsletter(issue(), li), []);
  const p = (spec: any, md: string | null = li) => checkNewsletter(spec, md).join(' | ');
  assert.match(p(issue((e) => e.subjects.push('x'.repeat(51)))), /51 characters; keep newsletter subjects ≤ 50/);
  assert.match(p(issue((e) => e.subjects.push("You won't believe this"))), /clickbait/);
  assert.match(p(issue((e) => e.blocks.shift())), /masthead/);
  assert.match(p(issue((e) => (e.blocks[0].date = ''))), /needs both `issue`/);
  assert.match(p(issue((e) => (e.blocks[2].items = ['One']))), /2–4 short items \(found 1\)/);
  assert.match(p(issue((e) => e.blocks.push({ type: 'cta', headline: 'x', cta: 'y', url: 'z' }))), /exactly one `cta` block for the product ask \(found 2\)/);
  assert.match(p(issue((e) => e.blocks.pop())), /forward/);
  assert.match(p({ emails: [issue().emails[0], issue().emails[0]] }), /one email — found 2/);
  assert.match(p(issue(), null), /linkedin-article\.md was not written/);
  assert.match(p(issue(), `# ${'H'.repeat(101)}\n\n## a\n\n## b\n\n${'word '.repeat(300)}`), /headline is 101 characters; LinkedIn allows 100/);
  assert.match(p(issue(), `# Title\n\n${'word '.repeat(300)}`), /at least 2 subheads/);
});

test('the critic sees the cover or hero next to the page previews', async () => {
  const a = mkdtempSync(join(tmpdir(), 'pv-'));
  mkdirSync(join(a, 'out'));
  for (const f of ['shipcast-notes-12-desktop.png', 'shipcast-notes-12-mobile.png', 'linkedin-cover.png', 'graphics.json']) writeFileSync(join(a, 'out', f), 'x');
  assert.deepEqual((await previews(a)).map((f) => f.split('/out/')[1]), ['shipcast-notes-12-desktop.png', 'shipcast-notes-12-mobile.png', 'linkedin-cover.png']);
  const b = mkdtempSync(join(tmpdir(), 'pv-'));
  mkdirSync(join(b, 'out', 'figures'), { recursive: true });
  for (const f of ['article-desktop.png', 'article-mobile.png', 'hero.png', 'figures/01-studio.png']) writeFileSync(join(b, 'out', f), 'x');
  assert.deepEqual((await previews(b)).map((f) => f.split('/out/')[1]), ['article-desktop.png', 'article-mobile.png', 'hero.png']);
  rmSync(a, { recursive: true, force: true });
  rmSync(b, { recursive: true, force: true });
});

test('article covers and figures render at 1920×1080, 1200×630 and 1600×1000 without overflow', { skip: !hasChrome && 'no Chrome' }, async () => {
  const out = join(home, 'covers');
  const shot = join(process.cwd(), 'docs', 'assets', 'studio-new.png');
  const items = [
    { type: 'card', layout: 'article-cover', theme: 'midnight', preset: 'article-cover', name: 'linkedin-cover.png', fields: { kicker: 'Shipcast Notes · Issue 12', title: 'Captions that *keep up* with you', sub: 'Word-timed captions, safer crops and one new format.', image: `${shot}#crop=0.3,0.2,0.16,0.3` } },
    { type: 'card', layout: 'article-cover', theme: 'editorial', preset: 'og-card', name: 'hero.png', fields: { kicker: 'Guide', title: 'How a launch campaign generator builds a whole kit from one link' } },
    { type: 'card', layout: 'article-figure', theme: 'editorial', preset: 'article-figure', name: 'figures/01-studio.png', fields: { image: `${shot}#crop=0.3,0.2,0.3,0.3`, label: 'New run' } },
  ];
  const job = await run('graphics', { brand: { ...brand, logo: join(process.cwd(), 'docs', 'assets', 'mark.svg') }, outDir: out, items });
  assert.equal(job.status, 'done', job.error);
  for (const it of job.output.items) for (const k of ['overflow', 'offCanvas', 'unsafe', 'tinyShots', 'small', 'broken']) assert.deepEqual(it.audit[k], [], `${it.file} ${k}`);
  assert.ok(existsSync(join(out, 'linkedin-cover.png')) && existsSync(join(out, 'figures', '01-studio.png')));
  // A whole desktop screen shrunk into a figure is flagged, with how far to crop.
  const wide = await run('graphics', { brand, outDir: out, items: [{ ...items[2], name: 'figures/02-whole.png', fields: { image: shot } }] });
  assert.match(wide.output.items[0].audit.tinyShots.join(' '), /Crop to roughly/);
});

test('a newsletter issue renders inbox-safe with masthead, items and forward line, and passes the deliverability checks', { skip: !hasChrome && 'no Chrome' }, async () => {
  const out = join(home, 'newsletter');
  const job = await run('email', { ...issue(), brand, outDir: out });
  assert.equal(job.status, 'done', job.error);
  assert.deepEqual(job.output.problems, []);
  const html = readFileSync(join(out, 'emails', 'shipcast-notes-12', 'shipcast-notes-12.html'), 'utf8');
  assert.match(html, /Issue 12<\/strong><br>3 Nov 2026/);
  assert.match(html, /Forward it to them/);
  assert.match(html, /\{\{unsubscribe_url\}\}/);
  assert.match(html, /100 Sample Street/);
  const txt = readFileSync(join(out, 'emails', 'shipcast-notes-12', 'shipcast-notes-12.txt'), 'utf8');
  assert.match(txt, /Shipcast Notes — Issue 12 · 3 Nov 2026/);
  assert.match(txt, /- Safer crops: Screenshots are cut .* \(https:\/\/shipcast\.dev\/changelog\)/);
  assert.match(txt, /Forwarded this\? Subscribe: https:\/\/shipcast\.dev\/newsletter/);
  assert.ok(existsSync(join(out, 'shipcast-notes-12-mobile.png')));
});

test('an article renders to a readable page with search metadata, figures and previews', { skip: !hasChrome && 'no Chrome' }, async () => {
  const out = join(home, 'blog', 'out');
  mkdirSync(join(out, 'figures'), { recursive: true });
  copyFileSync(join(process.cwd(), 'docs', 'assets', 'studio-new.png'), join(out, 'figures', '01-studio.png'));
  copyFileSync(join(process.cwd(), 'docs', 'assets', 'studio-new.png'), join(out, 'hero.png'));
  writeFileSync(join(out, 'article.md'), article(15, { hero: 'hero.png', date: '2026-11-03', author: 'Shipcast team' }));
  const job = await run('article', { file: join(out, 'article.md'), brand, outDir: out });
  assert.equal(job.status, 'done', job.error);
  assert.deepEqual(job.output.problems, []);
  const html = readFileSync(join(out, 'article', 'index.html'), 'utf8');
  assert.match(html, /<title>Launch campaign generator: one link to a full kit<\/title>/);
  assert.match(html, /<meta name="description" content="How a local/);
  assert.match(html, /"@type":"FAQPage"/);
  assert.match(html, /<meta property="og:image" content="images\/1-hero\.png">/);
  assert.match(html, /<figure><img src="images\/2-01-studio\.png" alt="The studio home screen"/);
  assert.equal((html.match(/<h1>/g) ?? []).length, 1);
  assert.ok(existsSync(join(out, 'article', 'images', '2-01-studio.png')) && existsSync(join(out, 'article-desktop.png')) && existsSync(join(out, 'article-mobile.png')));
  const out2 = join(home, 'blog2', 'out');
  mkdirSync(out2, { recursive: true });
  writeFileSync(join(out2, 'article.md'), article(15).replace('figures/01-studio.png', 'figures/missing.png'));
  const bad = await run('article', { file: join(out2, 'article.md'), brand, outDir: out2 });
  assert.match(bad.output.problems.join(' '), /missing\.png not found/);
});
