import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';

// Press kit, event kit, release notes, pins and end screens: deterministic checks, plus real renders when Chrome is here.
const home = mkdtempSync(join(tmpdir(), 'shipcast-kits-'));
process.env.SHIPCAST_HOME = home;
const E = await import('@shipcast/engine');
const { findChrome, browser, loadPacks, validatePack, PLUGIN_DIR, PACK_CHANNEL, getPreset, END_SCREEN_ZONES, checkPressKit, checkEventKit, checkReleaseNotes, checkPins, knownPerson, unsourcedSuperlatives, buildPressKit, renderKits, previews, GOLDEN_PACKS } = E;
const { createStillsService } = await import('@shipcast/stills');

const hasChrome = !!findChrome();
let stills: ReturnType<typeof createStillsService> | null = null;
let base = '';
before(async () => {
  if (!hasChrome) return;
  stills = createStillsService();
  await stills.listen(0);
  base = `http://127.0.0.1:${(stills.server.address() as AddressInfo).port}`;
  process.env.SHIPCAST_STILLS_URL = base;
});
after(async () => {
  await stills?.close();
  await browser().close();
  if (!process.env.KEEP) rmSync(home, { recursive: true, force: true });
});
const run = async (kind: string, input: unknown) => (await fetch(`${base}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, input }) })).json();
const shot = join(process.cwd(), 'docs', 'assets', 'studio-new.png');
const shipcast = { name: 'Shipcast', url: 'github.com/rajdavee/shipcast', logo: join(process.cwd(), 'docs', 'assets', 'mark.svg'), colors: { background: '#0b0d12', primary: '#2b3bff' } };
const clean = (it: any) => {
  for (const k of ['overflow', 'offCanvas', 'unsafe', 'tinyShots', 'small', 'broken']) assert.deepEqual(it.audit[k], [], `${it.file.split('/').pop()} ${k}`);
};
const BRIEF = 'Shipcast is a local-first studio that turns a URL or a GitHub repo into a launch campaign. Contact: hello@shipcast.dev';

// ── sample Shipcast content (no real-sounding people: role labels and marked placeholders) ──

const release = (over: Record<string, unknown> = {}) => ({
  release: 'For immediate release',
  headline: 'Shipcast adds press kits, event kits and release-note graphics to its local marketing studio',
  subhead: 'The open-source studio now builds a press release, a webinar kit and changelog cards from one product link, on the user\'s own machine.',
  dateline: 'LONDON, 3 November 2026',
  lead: 'Shipcast, the open-source studio that turns a product link into launch material, today released four new formats: a press kit, a webinar and event kit, release-note graphics, and Pinterest pins with a YouTube end screen. They are available now to everyone who runs Shipcast.',
  body: 'Each format starts from the same research brief Shipcast writes for a product. The press kit produces a release and a one-page fact sheet as PDFs, then bundles them with the brand\'s logo files and full-resolution screenshots into one zip with a README.\n\nThe event kit writes one set of event facts — title, date, time, timezone, speakers and the registration link — and builds the registration page, title and agenda slides, three promo posts and three emails from it. Every piece is checked against those facts before the user sees it.\n\n### Release notes and discovery\nRelease-note cards show each headline feature on a real screenshot with its version and date, plus a summary card for the whole update. Pinterest pins keep their titles readable at the size the grid shows them, and the YouTube end-screen background leaves room for the video and subscribe elements.\n\nAll formats run locally with the user\'s existing Claude Code login. Files stay on the user\'s machine, and every render is checked for overflow, safe areas and legibility before it is shown.',
  ...over,
});
const lastPage = (over: Record<string, unknown> = {}) => ({
  quotes: ['We wanted the boring parts of a launch to take minutes, so the team can spend its time on the story. | Founder, Shipcast'],
  company: 'Shipcast',
  about: 'Shipcast is an open-source, local-first marketing studio. It reads a product website or GitHub repository and produces videos, carousels, slide decks, documents, emails and landing pages, each rendered and checked on the user\'s own computer. Shipcast is released under the MIT licence.',
  contact: ['Press team, Shipcast', 'press@shipcast.dev (to confirm)'],
  ...over,
});
const doc = (p1: Record<string, unknown> = {}, p2: Record<string, unknown> = {}) => ({ title: 'Shipcast — press release', size: 'a4', theme: 'clean', pages: [{ layout: 'press-release', fields: release(p1) }, { layout: 'press-release', fields: lastPage(p2) }] });
const fact = (over: Record<string, unknown> = {}) => ({
  size: 'a4',
  theme: 'clean',
  pages: [{ layout: 'fact-sheet', fields: { title: 'Shipcast', tagline: 'An open-source studio that turns one product link into a launch campaign — on your own machine.', facts: ['Product | Local-first marketing studio', 'Licence | MIT, open source', 'Runs on | macOS, Linux, Windows', 'Requires | Node 22 and a Claude Code login', 'Formats | Videos, decks, documents, emails, pages', 'Website | github.com/rajdavee/shipcast'], highlights: ['Paste a link or a repo; get a research brief in minutes', 'Every render is checked for overflow, safe areas and legibility', 'Files stay on your computer', 'Press, event and release-note kits from one brief'], image: `${shot}#crop=0.21,0.52,0.3,0.18`, about: lastPage().about, contact: 'Press team · press@shipcast.dev (to confirm)', ...over } }],
});
const kit = { screenshots: [{ file: 'assets/studio-new.png', caption: 'Start a project' }, { file: 'assets/studio-run.png', caption: 'A finished campaign' }, { file: 'assets/studio-editor.png', caption: 'The editor' }], logos: ['assets/mark.svg'] };

const ev = { title: 'Make a launch kit from one link', date: 'Tue 18 Nov 2026', time: '17:00', timezone: 'GMT', url: 'https://shipcast.dev/webinar', speakers: [{ name: 'Founder, Shipcast', role: 'Live demo' }, { name: '[Speaker — to confirm]', role: 'Q&A' }] };
const speakerItems = ['Founder, Shipcast | Live demo', '[Speaker — to confirm] | Q&A'];
const landing = () => ({
  title: 'Live webinar: make a launch kit from one link',
  description: 'A 45-minute live session: turn one product link into posts, slides and emails, with Q&A.',
  theme: 'light',
  sections: [
    { type: 'event', eyebrow: 'Live webinar', headline: 'Make a launch kit from *one link*', sub: 'Watch a product page become posts, slides and emails in one sitting — and ask anything.', date: ev.date, time: ev.time, timezone: ev.timezone, where: 'Online', length: '45 min', cta: 'Save your seat', url: ev.url, note: 'Free. The recording goes to everyone who registers.' },
    { type: 'features', heading: "What you'll learn", items: ['link | Start from a link | What the research brief collects and why', 'layout-grid | Pick the formats | Which ones fit a launch week', 'shield-check | Check before you ship | The automatic checks on every render'] },
    { type: 'agenda', items: ['17:00 | Welcome | What we will make', '17:05 | Live demo | From a link to a launch kit', '17:30 | Q&A | Your questions'] },
    { type: 'speakers', items: speakerItems },
    { type: 'faq', items: ['Is it recorded? | Yes — everyone who registers gets the replay.', 'How long is it? | 45 minutes including questions.', 'Does it cost anything? | No.', 'Who is it for? | Founders and marketers who ship often.'] },
    { type: 'cta', heading: 'Join us on Tue 18 Nov 2026', sub: '17:00 GMT, online.', cta: 'Save your seat', url: ev.url },
  ],
});
const slides = () => ({ title: ev.title, theme: 'brand', slides: [
  { layout: 'title', fields: { kicker: 'Live webinar', title: 'Make a launch kit from *one link*', subtitle: 'From a product page to posts, slides and emails.', meta: 'Tue 18 Nov 2026 · 17:00 GMT' }, notes: 'Welcome.' },
  { layout: 'agenda', fields: { items: ['Welcome', 'Live demo', 'Q&A'] }, notes: 'Agenda.' },
  { layout: 'team', fields: { heading: 'Speakers', people: speakerItems }, notes: 'Who is talking.' },
  { layout: 'closing', fields: { title: 'Save your seat', cta: 'Register', url: 'shipcast.dev/webinar' }, notes: 'Link.' },
] });
const promo = (preset: string) => ({ type: 'card', layout: 'event-promo', theme: 'midnight', preset, name: `promo/${preset}.png`, fields: { kicker: 'Live webinar', title: 'Make a launch kit from *one link*', date: ev.date, time: ev.time, timezone: ev.timezone, speakers: speakerItems, cta: 'Save your seat', url: 'shipcast.dev/webinar' } });
const graphics = () => ({ items: ['instagram-post', 'linkedin-image', 'linkedin-landscape'].map(promo) });
const mail = (name: string, headline: string, extra = '') => ({ name, subjects: [headline, `${headline} — 45 min`, 'Live: one link to a launch kit'], preheader: `Live on ${ev.date} at ${ev.time} ${ev.timezone}: a product page becomes posts, slides and emails.`, blocks: [{ type: 'hero', headline, body: `${ev.date}, ${ev.time} ${ev.timezone} · online · 45 minutes${extra}` }, { type: 'bullets', items: ['How the research brief works', 'Which formats fit a launch week', 'The checks on every render'] }, { type: 'cta', headline: 'Save your seat', cta: name === 'replay' ? 'Watch the replay' : 'Register', url: ev.url }] });
const email = () => ({ theme: 'light', footer: { address: 'Shipcast, sample address — replace before sending', reason: 'You registered for updates from Shipcast.' }, emails: [mail('invite', 'Make a launch kit from one link'), mail('reminder', 'Tomorrow: one link to a launch kit'), mail('replay', 'The replay is up', ' (recorded)')] });

const feature = (preset: string, over: Record<string, unknown> = {}) => ({ type: 'card', layout: 'whats-new', theme: 'midnight', preset, name: `release/01-kits-${preset}.png`, fields: { version: 'v1.2', date: '3 Nov 2026', title: 'Pick a *whole kit* in one click', sub: 'Launch kit, social pack or video only — with time estimates.', image: 'assets/studio-new.png#crop=0.215,0.53,0.19,0.16', ...over } });
const summary = (items = ['Press kit — release, fact sheet and a zip for newsrooms', 'Event kit — page, slides, posts and emails that agree', 'Release notes — feature cards on real screens', 'Pins and end screens — readable at grid size']) => ({ type: 'card', layout: 'release-summary', theme: 'midnight', preset: 'linkedin-image', name: 'release/summary.png', fields: { version: 'v1.2', date: '3 Nov 2026', title: "What's new in *1.2*", items, url: 'github.com/rajdavee/shipcast' } });
const notes = (fm = 'version: v1.2\ndate: 3 Nov 2026', post = 'Shipcast 1.2 makes press kits, event kits, release-note cards and Pinterest pins from one product link.') => `---\n${fm}\n---\n# v1.2 — 3 Nov 2026\n\n## Changelog\n### Added\n- Press kit\n- Event kit\n\n## Social post\n${post}\n`;
const okShot = (p: string) => (p ? null : 'needs a real screenshot of the feature (image).');

const pin = (n: number, over: Record<string, unknown> = {}) => ({ type: 'card', layout: 'pin', theme: 'bold', preset: 'pinterest-pin', name: `pins/0${n}-pin.png`, fields: { kicker: 'Checklist', title: 'Your launch week in *one link*', sub: 'Videos, carousels and posts from a single URL.', ...over } });
const endScreen = (over: Record<string, unknown> = {}) => ({ type: 'card', layout: 'end-screen', theme: 'bold', preset: 'youtube-endscreen', name: 'endscreen/end-screen.png', fields: { kicker: 'Thanks for watching', title: 'Watch *these* next', sub: 'More launch walkthroughs every week.', ...over } });

// ── packs, presets, golden ───────────────────────────────────────────

test('press-kit, event-kit, release-notes and pins-endscreens load, validate and point at their skills', async () => {
  const packs = await loadPacks(true);
  const want: Record<string, [string, string[] | undefined]> = { 'press-kit': ['document', undefined], 'event-kit': ['landing', ['slides', 'graphics', 'email']], 'release-notes': ['graphics', undefined], 'pins-endscreens': ['graphics', undefined] };
  for (const [id, [spec, also]] of Object.entries(want)) {
    const p = packs.find((x) => x.id === id);
    assert.ok(p, `${id} is bundled`);
    assert.deepEqual(validatePack(p!, id), []);
    assert.equal(p!.spec, spec);
    assert.deepEqual(p!.also, also);
    const skill = p!.prompt.match(/shipcast:([\w-]+)/)?.[1];
    assert.ok(skill && existsSync(join(PLUGIN_DIR, 'skills', skill, 'SKILL.md')), `${id} → ${skill}`);
    assert.ok(PACK_CHANNEL[id], `${id} has a brand-voice channel`);
    assert.ok(!/\{\{|\}\}/.test(E.renderTemplate(p!.prompt, E.defaultOptions(p!))), `${id} prompt renders without leftover tags`);
  }
});

test('pin and end-screen presets: the element zones sit inside the right part of a 1920×1080 frame', () => {
  const pinP = getPreset('pinterest-pin')!;
  assert.deepEqual([pinP.width, pinP.height], [1000, 1500]);
  const es = getPreset('youtube-endscreen')!;
  assert.deepEqual([es.width, es.height], [1920, 1080]);
  assert.equal(es.safe.avoid, END_SCREEN_ZONES);
  assert.ok(es.safe.images, 'logos count as content on the end screen');
  for (const z of END_SCREEN_ZONES) assert.ok(z.x >= 800 && z.x + z.w <= 1920 && z.y >= 0 && z.y + z.h <= 1080, z.what);
  assert.equal(END_SCREEN_ZONES.filter((z: { what: string }) => /video/.test(z.what)).length, 2);
});

test('the golden rotation includes the sprint-v6 formats that need no user-specific inputs', () => {
  for (const id of ['profile-kit', 'case-study', 'newsletter', 'blog-article']) assert.ok(GOLDEN_PACKS.includes(id), id);
  assert.equal(new Set(GOLDEN_PACKS).size, GOLDEN_PACKS.length);
});

// ── deterministic checks ─────────────────────────────────────────────

test('people: placeholders and role labels pass, names must come from the brief', () => {
  assert.ok(knownPerson('[Placeholder — quote from a named spokesperson]', ''));
  assert.ok(knownPerson('Founder, Shipcast', ''));
  assert.ok(knownPerson('[Speaker — to confirm]', ''));
  assert.ok(!knownPerson('Jordan Avery, CEO', BRIEF));
  assert.ok(knownPerson('Jordan Avery, CEO', `${BRIEF} Jordan Avery leads the company.`));
  assert.deepEqual(unsourcedSuperlatives('It is the fastest way to ship. It is the fastest tool, according to the 2026 survey [1].'), ['the fastest']);
});

test('press kit check passes a complete release and catches each missing part', () => {
  const exists = (p: string) => existsSync(join(process.cwd(), 'docs', p));
  assert.deepEqual(checkPressKit(doc(), fact(), kit, BRIEF, exists), []);
  const p = (d: any, f: any = fact(), k: any = kit) => checkPressKit(d, f, k, BRIEF, exists).join(' | ');
  assert.match(p(doc({ dateline: '' })), /needs a dateline/);
  assert.match(p(doc({ dateline: 'LONDON' })), /has no date/);
  assert.match(p(doc({ headline: 'H'.repeat(121) })), /headline is 121 characters/);
  assert.match(p(doc({ body: Array(4).fill(release().body).join('\n\n') })), /the release is \d+ words; keep it ≤ 800/);
  assert.match(p(doc({}, { about: '' })), /add the boilerplate/);
  assert.match(p(doc({}, { contact: ['Press team'] })), /media contact/);
  assert.match(p(doc({}, { quotes: ['Great product. | Jordan Avery, CEO, Shipcast'] })), /"Jordan Avery" isn't named in the brief/);
  assert.match(p(doc({}, { quotes: ['Great product.'] })), /no attribution/);
  assert.match(p(doc({ lead: `${release().lead} We are excited to announce it.` })), /uses "excited to announce"/);
  assert.match(p(doc({ subhead: 'The industry-leading studio for launches.' })), /"industry-leading" is a superlative with no source/);
  assert.doesNotMatch(p(doc({ subhead: 'The fastest studio in the 2026 benchmark, according to the maintainers [1].' })), /superlative/);
  assert.match(p(doc(), null), /fact-sheet\.json was not written/);
  assert.match(p(doc(), fact({ numbers: ['30+ | formats'] })), /needs its source/);
  assert.match(p(doc(), fact(), { ...kit, screenshots: kit.screenshots.slice(0, 2) }), /3–6 product screenshots, not 2/);
  assert.match(p(doc(), fact(), { ...kit, screenshots: [...kit.screenshots, 'assets/studio-new.png#crop=0,0,0.5,0.5'] }), /full resolution; drop the #crop/);
  assert.match(p(doc(), fact(), { ...kit, logos: ['assets/nope.svg'] }), /logo assets\/nope\.svg doesn't exist/);
});

test('event kit check passes matching pieces and catches drift in time, timezone, link and speakers', () => {
  const pieces = () => ({ landing: landing(), slides: slides(), graphics: graphics(), email: email() });
  assert.deepEqual(checkEventKit(ev, pieces(), BRIEF), []);
  const p = (mut: (x: ReturnType<typeof pieces>) => void, e: any = ev) => {
    const x = pieces();
    mut(x);
    return checkEventKit(e, x, BRIEF).join(' | ');
  };
  assert.match(p(() => {}, null), /event\.json was not written/);
  assert.match(p((x) => { x.graphics.items[1].fields.time = '5pm'; }), /promo\/linkedin-image\.png: date, time and timezone must be copied/);
  assert.match(p((x) => { x.email.emails[1].blocks[0].body = 'Tomorrow, Tue 18 Nov 2026 at 17:00 GMT (18:00 CET).'; }), /email\.json reminder: mentions CET/);
  assert.match(p((x) => { x.email.emails[0].blocks[0].body = 'Tue 18 Nov 2026, 5pm GMT'; }), /email\.json invite: doesn't state the time "17:00"/);
  assert.match(p((x) => { x.email.emails[2].blocks[2].url = 'https://shipcast.dev/replay'; }), /email\.json replay: the button must link to https:\/\/shipcast\.dev\/webinar/);
  assert.match(p((x) => { x.graphics.items[0].fields.url = 'shipcast.dev'; }), /instagram-post\.png: the URL must be the registration page/);
  assert.match(p((x) => { x.landing.sections = x.landing.sections.filter((s: any) => s.type !== 'agenda'); }), /needs an "agenda" section/);
  assert.match(p((x) => { (x.landing.sections[3] as any).items = ['Founder, Shipcast | Live demo']; }), /landing\.json speakers: leaves out "\[Speaker — to confirm\]"/);
  assert.match(p((x) => { x.slides.slides[2].fields.people = ['Founder, Shipcast | Live demo', 'Head of Product, Shipcast | Q&A']; }), /slides\.json speakers: speaker "Head of Product, Shipcast" isn't in event\.json/);
  assert.match(p(() => {}, { ...ev, speakers: [{ name: 'Jordan Avery' }] }), /speaker "Jordan Avery" isn't named in the brief/);
  assert.match(p((x) => { x.email.emails.pop(); }), /add the replay email/);
  assert.match(p((x) => { x.graphics.items.pop(); }), /add the linkedin-landscape promo post/);
});

test('release notes check: one version and date everywhere, ≤ 5 summary items, a real screenshot on every feature card', () => {
  const items = () => [feature('linkedin-landscape'), feature('linkedin-image'), summary()];
  assert.deepEqual(checkReleaseNotes({ items: items() }, notes(), okShot), []);
  const p = (it: any[], md: string | null = notes(), sh = okShot) => checkReleaseNotes({ items: it }, md, sh).join(' | ');
  assert.match(p(items(), null), /release-notes\.md was not written/);
  assert.match(p(items(), notes('date: 3 Nov 2026')), /front matter needs the version/);
  assert.match(p([feature('linkedin-landscape', { version: 'v1.3' }), feature('linkedin-image'), summary()]), /says v1\.3 · 3 Nov 2026 but release-notes\.md says v1\.2/);
  assert.match(p([feature('linkedin-landscape'), feature('linkedin-image', { date: 'Nov 3' }), summary()]), /disagree on version or date/);
  assert.match(p([...items().slice(0, 2), summary(['a — 1', 'b — 2', 'c — 3', 'd — 4', 'e — 5', 'f — 6'])]), /6 items on the summary card — keep ≤ 5/);
  assert.match(p([feature('linkedin-landscape'), summary()]), /has no linkedin-image card/);
  assert.match(p([feature('linkedin-landscape', { image: '' }), feature('linkedin-image'), summary()]), /needs a real screenshot/);
  assert.match(p(items(), notes(undefined, 'x'.repeat(281))), /social post is 281 characters/);
});

test('release notes in the fix loop: feature images must be real screenshots from the brief, not the logo or a marketing graphic', async () => {
  const brief = join(home, 'rn-brief');
  const cwd = join(home, 'rn');
  mkdirSync(join(brief, 'assets'), { recursive: true });
  mkdirSync(join(cwd, 'out'), { recursive: true });
  for (const f of ['studio-new.png', 'mark.svg', 'banner.png']) copyFileSync(join(process.cwd(), 'docs', 'assets', f), join(brief, 'assets', f));
  writeFileSync(join(brief, 'brand.json'), JSON.stringify({ name: 'Shipcast', logo: 'assets/mark.svg', productImages: ['assets/banner.png'] }));
  writeFileSync(join(cwd, 'out', 'release-notes.md'), notes());
  const at = async (image: string) => {
    writeFileSync(join(cwd, 'out', 'graphics.json'), JSON.stringify({ items: [feature('linkedin-landscape', { image }), feature('linkedin-image', { image }), summary()] }));
    return (await renderKits('release-notes', cwd, brief)).join(' | ');
  };
  assert.equal(await at('assets/studio-new.png#crop=0.215,0.53,0.19,0.16'), '');
  assert.match(await at('assets/mark.svg'), /isn't a screenshot/);
  assert.match(await at('assets/banner.png'), /banner\.png is a logo or marketing graphic/);
  assert.match(await at('assets/missing.png'), /assets\/missing\.png doesn't exist/);
  writeFileSync(join(cwd, 'out', 'graphics.json'), '{ nope');
  assert.match((await renderKits('release-notes', cwd, brief)).join(' '), /graphics\.json is not valid JSON/);
});

test('pins check: 3–5 pins without link text, one clean end screen, no platform marks', () => {
  const items = () => [pin(1), pin(2, { kicker: 'Guide' }), pin(3, { title: 'Ten posts from *one URL*' }), endScreen()];
  assert.deepEqual(checkPins({ items: items() }), []);
  const p = (it: any[]) => checkPins({ items: it }).join(' | ');
  assert.match(p(items().slice(1)), /make 3–5 pins .* not 2/);
  assert.match(p([...items(), endScreen()]), /exactly one end-screen background .* not 2/);
  assert.match(p([pin(1, { sub: 'Try it at shipcast.dev' }), pin(2), pin(3), endScreen()]), /"shipcast\.dev" is link text baked into the pin/);
  assert.match(p([pin(1, { title: 'See https://x.io/a' }), pin(2), pin(3), endScreen()]), /link text/);
  assert.match(p([...items().slice(0, 3), endScreen({ guides: 'yes' })]), /drop "guides"/);
  assert.match(p([pin(1, { image: 'assets/pinterest-logo.png' }), pin(2), pin(3), endScreen()]), /no platform logos/);
});

test('the critic sees pins and the end-screen guide together', async () => {
  const a = mkdtempSync(join(tmpdir(), 'pv-'));
  mkdirSync(join(a, 'out', 'pins'), { recursive: true });
  mkdirSync(join(a, 'out', 'endscreen'), { recursive: true });
  for (const f of ['01-a.png', '02-b.png', '03-c.png', '04-d.png', '01-a.html']) writeFileSync(join(a, 'out', 'pins', f), 'x');
  for (const f of ['end-screen.png', 'end-screen.guides.png']) writeFileSync(join(a, 'out', 'endscreen', f), 'x');
  assert.deepEqual((await previews(a)).map((f: string) => f.split('/out/')[1]), ['pins/01-a.png', 'pins/02-b.png', 'pins/03-c.png', 'endscreen/end-screen.guides.png']);
  rmSync(a, { recursive: true, force: true });
});

// ── renders ──────────────────────────────────────────────────────────

test('press release and fact sheet render at A4 and Letter without overflow; placeholder quotes are labelled', { skip: !hasChrome && 'no Chrome' }, async () => {
  for (const size of ['a4', 'letter']) {
    const out = join(home, `pr-${size}`);
    const d = doc({}, { quotes: [lastPage().quotes[0], 'A sentence about why this matters to customers. | [Placeholder — quote from a named spokesperson]'] });
    const job = await run('document', { brand: shipcast, ...d, size, outDir: out });
    assert.equal(job.status, 'done', job.error);
    assert.deepEqual(job.output.problems, [], size);
    assert.equal(job.output.pages.length, 2);
    const html = readFileSync(join(out, 'document.html'), 'utf8');
    assert.equal((html.match(/class="pr-mark">###</g) ?? []).length, 1, 'one end mark, on the last page');
    assert.match(html, /Placeholder — needs a real, approved quote/);
    assert.match(html, /About Shipcast/);
    const fs = await run('document', { brand: shipcast, ...fact(), size, outDir: join(out, 'fact-sheet'), name: 'fact-sheet' });
    assert.equal(fs.status, 'done', fs.error);
    assert.deepEqual(fs.output.problems, [], `fact sheet ${size}`);
    assert.ok(existsSync(join(out, 'fact-sheet', 'fact-sheet.pdf')));
  }
});

test('press kit: renderKits renders the fact sheet and zips PDFs, logos, full-size screenshots and a README', { skip: !hasChrome && 'no Chrome' }, async () => {
  const cwd = join(home, 'pk');
  const brief = join(home, 'pk-brief');
  mkdirSync(join(cwd, 'out'), { recursive: true });
  mkdirSync(join(brief, 'assets'), { recursive: true });
  for (const f of ['studio-new.png', 'studio-run.png', 'studio-editor.png', 'mark.svg']) copyFileSync(join(process.cwd(), 'docs', 'assets', f), join(brief, 'assets', f));
  writeFileSync(join(brief, 'brief.md'), BRIEF);
  writeFileSync(join(brief, 'brand.json'), JSON.stringify({ name: 'Shipcast', logo: 'assets/mark.svg', colors: shipcast.colors }));
  const d = doc();
  writeFileSync(join(cwd, 'out', 'document.json'), JSON.stringify(d));
  writeFileSync(join(cwd, 'out', 'fact-sheet.json'), JSON.stringify(fact({ image: 'assets/studio-new.png#crop=0.21,0.52,0.3,0.18' })));
  writeFileSync(join(cwd, 'out', 'press-kit.json'), JSON.stringify(kit));
  const r = await run('document', { brandDir: brief, ...d, outDir: join(cwd, 'out') });
  assert.equal(r.status, 'done', r.error);
  assert.deepEqual(await renderKits('press-kit', cwd, brief), []);
  const zip = join(cwd, 'out', 'press-kit.zip');
  assert.ok(existsSync(zip));
  const listing = execFileSync('unzip', ['-l', zip], { encoding: 'utf8' });
  for (const f of ['press-release.pdf', 'fact-sheet.pdf', 'logos/mark.svg', 'screenshots/01-studio-new.png', 'screenshots/03-studio-editor.png', 'README.md']) assert.ok(listing.includes(f), f);
  const readme = execFileSync('unzip', ['-p', zip, 'README.md'], { encoding: 'utf8' });
  assert.match(readme, /screenshots\/01-studio-new\.png \| Start a project · 1440×900/);
  assert.match(readme, /Press contact: Press team, Shipcast · press@shipcast\.dev/);
  // A missing PDF is reported instead of shipping half a kit.
  assert.match((await buildPressKit(join(home, 'empty-out'), brief, kit)).join(' '), /Press release \(document\.pdf\) is missing/);
});

test('event kit: registration page, slides, three promo posts and three emails render cleanly', { skip: !hasChrome && 'no Chrome' }, async () => {
  const out = join(home, 'event');
  // Landing pages and emails copy their images into the upload: only files inside the Shipcast home qualify.
  const page = await run('landing', { brand: { name: 'Shipcast', colors: shipcast.colors }, outDir: out, ...landing() });
  assert.equal(page.status, 'done', page.error);
  assert.deepEqual(page.output.problems, []);
  const html = readFileSync(join(out, 'landing', 'index.html'), 'utf8');
  assert.match(html, /<dl class="when">[\s\S]*Tue 18 Nov 2026[\s\S]*17:00 GMT/);
  assert.match(html, /class="card person ph"[\s\S]*Speaker to be confirmed/);
  assert.match(html, /<ol class="ag">/);
  const g = await run('graphics', { brand: shipcast, outDir: out, ...graphics() });
  assert.equal(g.status, 'done', g.error);
  assert.equal(g.output.items.length, 3);
  g.output.items.forEach(clean);
  const s = await run('slides', { brand: shipcast, outDir: out, ...slides() });
  assert.equal(s.status, 'done', s.error);
  for (const sl of s.output.slides) assert.deepEqual([sl.audit.overflow, sl.audit.offCanvas], [[], []]);
  const m = await run('email', { brand: { name: 'Shipcast', colors: shipcast.colors }, outDir: out, ...email() });
  assert.equal(m.status, 'done', m.error);
  assert.deepEqual(m.output.emails.map((e: any) => e.html.split('/emails/')[1]), ['invite/invite.html', 'reminder/reminder.html', 'replay/replay.html']);
});

test('release notes: feature cards at 1200×627 and 1080×1350 with a readable crop, and a five-item summary', { skip: !hasChrome && 'no Chrome' }, async () => {
  const out = join(home, 'release');
  const items = [feature('linkedin-landscape', { image: `${shot}#crop=0.215,0.53,0.19,0.16` }), feature('linkedin-image', { image: `${shot}#crop=0.215,0.53,0.19,0.16` }), summary([...summary().fields.items, 'Critic previews — one from each set'])];
  for (const theme of ['midnight', 'editorial']) {
    const job = await run('graphics', { brand: shipcast, outDir: join(out, theme), items: items.map((i) => ({ ...i, theme })) });
    assert.equal(job.status, 'done', job.error);
    job.output.items.forEach(clean);
  }
  // A whole screen shrunk onto the card is caught by the legibility audit.
  const wide = await run('graphics', { brand: shipcast, outDir: join(out, 'wide'), items: [feature('linkedin-image', { image: `${shot}#crop=0,0,1,1` })] });
  assert.ok(wide.output.items[0].audit.tinyShots.length, 'an uncropped screen is too small to read');
});

test('pins stay readable at grid size; the end screen keeps its element zones clear and the audit flags intrusions', { skip: !hasChrome && 'no Chrome' }, async () => {
  const out = join(home, 'pins');
  const items = [pin(1), pin(2, { image: `${shot}#crop=0.215,0.53,0.19,0.16`, title: 'Pick a *launch kit*' }), pin(3, { title: 'Ten posts, one carousel and a reel from *one URL*', sub: undefined }), endScreen(), endScreen({ guides: 'yes' })].map((i, n) => (n === 4 ? { ...i, name: 'endscreen/end-screen.guides.png' } : i));
  for (const theme of ['bold', 'midnight', 'swiss']) {
    const job = await run('graphics', { brand: shipcast, outDir: join(out, theme), items: items.map((i) => ({ ...i, theme })) });
    assert.equal(job.status, 'done', job.error);
    job.output.items.forEach(clean);
  }
  const html = readFileSync(join(out, 'bold', 'endscreen', 'end-screen.guides.html'), 'utf8');
  assert.equal((html.match(/class="es-guide/g) ?? []).length, 3, 'two video boxes and the subscribe circle are outlined');
  assert.ok(!/class="es-guide/.test(readFileSync(join(out, 'bold', 'endscreen', 'end-screen.html'), 'utf8')), 'the upload has no outlines');
  // Words or a logo inside an element zone come back as problems.
  const page = (body: string) => `<html><body style="margin:0;position:relative;font:48px sans-serif">${body}</body></html>`;
  const check = async (name: string, body: string) => {
    const f = join(home, `${name}.html`);
    writeFileSync(f, page(body));
    const job = await run('html', { file: f, out: join(home, `${name}.png`), preset: 'youtube-endscreen' });
    assert.equal(job.status, 'done', job.error);
    return job.output.audit.unsafe as string[];
  };
  assert.deepEqual(await check('es-ok', '<p style="position:absolute;left:120px;top:400px;margin:0">Watch next</p>'), []);
  assert.deepEqual((await check('es-text', '<p style="position:absolute;left:1300px;top:300px;margin:0">Watch next</p>')).map((x) => x.split(' — ')[1]), ['under the first end-screen video']);
  const logo = (await check('es-logo', `<img src="${shipcast.logo}" style="position:absolute;left:900px;top:480px;width:120px;height:120px">`)).join(' ');
  assert.match(logo, /mark\.svg — under the subscribe button/);
  // A title too long for the pin shrinks past its grid-size floor and is reported.
  const long = await run('graphics', { brand: shipcast, outDir: join(out, 'long'), items: [pin(9, { title: 'An extremely long pin title that keeps going and going well past anything a person could read at thumbnail size in the grid' })] });
  assert.ok(long.output.items[0].audit.small.length || long.output.items[0].audit.overflow.length, 'an over-long title is flagged');
});
