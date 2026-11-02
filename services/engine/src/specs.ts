import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { callService } from './service.ts';
import { run } from './exec.ts';
import { PLUGIN_DIR } from './paths.ts';
import { KNOWN_ICONS } from './icons.ts';

/**
 * Spec formats: Claude writes a JSON spec, a capability service renders it.
 * This module knows, per spec kind, the file name, how to describe the
 * catalog to the model, how to render, and how to turn the result into
 * actionable feedback.
 */

export type SpecKind = 'deck' | 'graphics' | 'storyboard' | 'infographic' | 'document' | 'slides' | 'ads' | 'email' | 'landing' | 'print';

export const SPEC_FILE: Record<SpecKind, string> = { deck: 'deck.json', graphics: 'graphics.json', storyboard: 'storyboard.json', infographic: 'infographic.json', document: 'document.json', slides: 'slides.json', ads: 'ads.json', email: 'email.json', landing: 'landing.json', print: 'print.json' };

type FieldDoc = { id: string; type: string; label: string; optional?: boolean; max?: number; help?: string; choices?: string[] };
const fieldLine = (f: FieldDoc) =>
  `  - \`${f.id}\` (${f.type}${f.optional ? ', optional' : ''}${f.max ? `, ≤${f.max}${f.type === 'list' ? ' items' : ' chars'}` : ''}${f.choices ? `: ${f.choices.join('|')}` : ''}) — ${f.label}${f.help ? `. ${f.help}` : ''}`;

/** Markdown reference of what a spec may contain, generated from the live services. */
export async function catalogMarkdown(kind: SpecKind): Promise<string> {
  if (kind === 'infographic') {
    return [
      '# Infographic catalog',
      '',
      '## Layouts — pick the one that matches the shape of the idea',
      '- `table` — a journey/matrix: `columns` (2–4; kinds `stage` | `note` | `chips` | `text`) and `rows` (3–9). The classic "stage · what they think · where they go · what they do".',
      '- `timeline` — an ordered plan or story: `steps` (3–8) of `{title, text?, note?, chips?}`. Cards alternate around a spine; `note` is the sticky thought on the other side.',
      '- `funnel` — drop-off or narrowing: `steps` (3–6) with `metric` ("41%", "2.4k") on each level plus `note`, `text`, `chips`.',
      '- `compare` — A vs B: `compare: {left:{name,icon?}, right:{name,icon?}, rows:[{label,left,right,winner:"left"|"right"|"both"|"none"}]}` (3–9 rows). Use `icon: "brand"` for the product itself.',
      '',
      '## Looks',
      '- `board` light dotted canvas, sticky notes (default) · `night` the same on near-black · `sketch` hand-drawn boxes on graph paper, marker notes · `paper` editorial serif, quiet and premium · `glass` frosted cards on a brand-colour gradient.',
      '',
      '## Chips (platforms)',
      'A chip is a platform name, or a group: `{"label":"AI assistants","icons":["ChatGPT","Claude","Gemini","Perplexity"]}` (1–4 logos, stacked). Up to 8 chips per table cell, 6 per timeline step, 5 per funnel level. Fill the box — 4–7 chips per row reads best.',
      `Names with known logos: ${KNOWN_ICONS.join(', ')}. Most well-known products resolve too ("Notion", "Figma", "Stripe"); unknown names get a monogram. Iconify ids work as well ("mdi:rocket-launch-outline").`,
      '',
      '## Everything else',
      '`kicker` (short, uppercase-styled), `title` with one `*accent phrase*`, `badge` ("Save this"), `cursor` (first name shown on the moving cursor), `footer: {name, handle, brand, avatar}` where avatar is `github:<user>` or a file in the brief. Sizes `1080x1350` (default) or `1080x1080`.',
    ].join('\n');
  }
  if (kind === 'storyboard') {
    const c = await callService('render', 'catalog', {});
    return [
      '# Storyboard catalog',
      '',
      `Presets: ${c.presets.map((p: any) => `\`${p.id}\` (${p.width}×${p.height})`).join(', ')}`,
      `Caption styles: ${Object.entries(c.captions).map(([k, v]) => `\`${k}\` — ${v}`).join('; ')}`,
      'Voices: `af_heart` `af_nova` `af_sky` (US female) · `am_adam` `am_michael` (US male) · `bf_emma` `bf_isabella` (UK female) · `bm_george` (UK male)',
      'Transitions (how a scene enters): `cut` `flash` `wipe` `fade` `zoom` `blur` (a motion-blurred whip — the slickest UI-to-UI cut) `push` (the next scene slides the last one away) — wipes/zooms/blurs/pushes get a whoosh, flashes an impact.',
      'Music: `{"mood": "uplifting|tech|chill|energetic|cinematic|playful"}` (original score generated per video, cuts land on the beat), `{"file": "<absolute path>"}` for a user track, or `null` for none. Default: uplifting.',
      '',
      '## Scenes',
      ...c.scenes.map((s: any) => `### \`${s.id}\` — ${s.label} (min ${s.minSeconds}s)\n${s.use}\n${s.fields.map(fieldLine).join('\n')}`),
      '',
      '## Registry blocks',
      'Instead of `scene`, a step may use `block: "<id>"` with `variables: {…}` from the HyperFrames registry (run `npx hyperframes catalog --json` to search; blocks declare their variables). Use blocks for things the scene list lacks (charts, maps, chat UIs, 3D, shaders).',
    ].join('\n');
  }
  const c = await callService('stills', 'catalog', {});
  if (kind === 'document') {
    return [
      '# Document catalog',
      '',
      'Spec: `{ "title": "running head", "size": "a4|letter", "theme": "<theme>", "footer": "url or line on every page", "pages": [ { "layout": "<id>", "fields": {…} } ] }`',
      `Themes: ${Object.entries(c.document.themes).map(([k, v]) => `\`${k}\` — ${v}`).join('; ')}`,
      `Sizes: ${Object.entries(c.document.sizes).map(([k, v]) => `\`${k}\` ${v}`).join(' · ')} (Letter for US audiences, A4 elsewhere).`,
      'Rich text: `*word*` accent · `**word**` bold · `==word==` highlight. Body fields take light markdown: blank-line paragraphs, `- ` bullets, `1. ` steps, `### ` subheads, `> ` callouts.',
      'Images: paths relative to the brief folder (e.g. `assets/screens/home.png`). Zoom into the detail that proves the point by adding `#crop=x,y,w,h` (fractions of the image, e.g. `assets/screens/docket.png#crop=0.05,0.1,0.55,0.45`) — a whole screen shrunk into a box is unreadable. Icons: a brand name ("Slack") or a plain icon word ("shield-check").',
      'Every page is checked after rendering: overflow, images that did not load, and pages under ~55% full come back to you to fix.',
      '',
      '## Layouts',
      ...c.document.layouts.map((l: any) => `### \`${l.id}\` — ${l.label}\n${l.use}\n${l.fields.map(fieldLine).join('\n')}`),
    ].join('\n');
  }
  if (kind === 'print') {
    return [
      '# Print catalog',
      '',
      'Spec: `{ "pieces": [ { "name": "file name", "size": "<id>", "theme": "brand|light|dark", "layout": "headline|event|product|stat", "fields": {…} } ] }` — each piece becomes a press-ready PDF (3 mm bleed, crop marks) and a high-resolution PNG.',
      `Sizes: ${Object.entries(c.print.sizes).map(([k, v]) => `\`${k}\` ${v}`).join(' · ')}`,
      '',
      '## Layouts and fields',
      '- `headline` — `kicker?`, `title` (≤ 8 words, `*accent*`), `sub?`, `image?`, `cta?`, `url?` — posters and flyers.',
      '- `event` — `kicker?`, `title`, `sub?`, `date`, `place`, `booth?`, `points?` (≤ 4), `image?`, `cta?`, `url?` — trade-show signage, meetups, webinars.',
      '- `product` — `kicker?`, `title`, `sub?`, `image` (real screenshot or photo), `points` (≤ 4), `cta?`, `url?` — roll-ups and table cards.',
      '- `stat` — `stat` (one verified number), `title`, `sub?`, `source`, `cta?`, `url?`.',
      'Print is read from metres away: a roll-up needs ≤ 6 words in the title and ≤ 4 short points; a flyer can carry a sub and 4 points. Always end with a URL people can type.',
    ].join('\n');
  }
  if (kind === 'landing') {
    return [
      '# Landing page catalog',
      '',
      'Spec: `{ "title": "<title tag>", "description": "<meta description ≤ 155 chars>", "theme": "light|dark|brand", "nav": [{"label","href":"#features"}], "sections": [ … ], "footer"? }`',
      '',
      '## Sections (use 5–9, hero first, cta last)',
      '- `hero` — `eyebrow?`, `headline` (≤ 10 words, the outcome), `sub` (≤ 30 words), `cta`, `url`, `secondary?`, `secondaryUrl?`, `note?` ("No credit card"), `image` (real screenshot), `alt`',
      '- `logos` — `heading?` ("Works with" / "Trusted by" — real only), `items` (brand names; known logos render as images)',
      '- `features` — `eyebrow?`, `heading`, `sub?`, `items`: ["icon | title | body", 3–6]',
      '- `media` — `eyebrow?`, `heading`, `body`, `points?`, `image`, `alt`, `side`: "left|right" (screenshot beside copy)',
      '- `how` — `eyebrow?`, `heading`, `sub?`, `steps`: ["title | body", 3–5]',
      '- `stats` — `heading?`, `stats`: ["value | label | source", ≤ 4] — verified only',
      '- `testimonials` — `heading?`, `items`: ["quote | name | role, company", ≤ 3] — real people only',
      '- `comparison` — `heading`, `leftTitle`, `left`, `rightTitle`, `right`',
      '- `pricing` — `heading`, `sub?`, `url`, `cta?`, `tiers`: ["*name | price | note | feature; feature | button text"] (leading * = recommended) — real prices only',
      '- `faq` — `heading?`, `items`: ["question | answer", 4–8] — answer real objections',
      '- `cta` — `heading`, `sub?`, `cta`, `url`, `note?`',
      'Rich text: `*word*` accent · `**word**` bold. Icons: brand names or plain icon words ("shield-check"). Images: paths relative to the brief folder. Zoom into the detail that proves the point by adding `#crop=x,y,w,h` (fractions of the image, e.g. `assets/screens/docket.png#crop=0.05,0.1,0.55,0.45`) — a whole screen shrunk into a box is unreadable.',
    ].join('\n');
  }
  if (kind === 'email') {
    return [
      '# Email catalog',
      '',
      'Spec: `{ "theme": "light|brand|dark", "footer": { "address": "postal address", "reason": "why they get this" }, "emails": [ { "name", "subjects": [3–5], "preheader": "40–110 chars", "blocks": [...], "signoff"? } ] }`',
      '',
      '## Blocks (in order, top to bottom)',
      '- `{ "type": "hero", "kicker"?, "headline", "body"?, "cta"?, "url"?, "image"? }` — opening; the headline is the email\'s one idea.',
      '- `{ "type": "text", "heading"?, "body" }` — body copy: blank-line paragraphs, `- ` bullets.',
      '- `{ "type": "feature", "image"?, "heading", "body", "side": "left|right", "cta"?, "url"? }` — image beside copy (stacks on phones).',
      '- `{ "type": "bullets", "heading"?, "items": [] }` — check-marked list.',
      '- `{ "type": "quote", "quote", "name", "role"? }` — real people only.',
      '- `{ "type": "stats", "stats": ["value | label", …≤3] }` — verified numbers only.',
      '- `{ "type": "cta", "headline", "body"?, "cta", "url" }` — the closing ask.',
      '- `{ "type": "image", "image", "alt", "url"? }` · `{ "type": "divider" }`',
      'Rich text: `*word*` accent · `**word**` bold. Images: paths relative to the brief folder; they are copied next to the HTML and zipped for upload. Zoom into the detail that proves the point by adding `#crop=x,y,w,h` (fractions of the image, e.g. `assets/screens/docket.png#crop=0.05,0.1,0.55,0.45`) — a whole screen shrunk into a box is unreadable.',
      'Checks after rendering: Gmail clipping (102 KB), subject and preheader length, link count, spam phrasing, phone width, footer address.',
    ].join('\n');
  }
  if (kind === 'ads') {
    return [
      '# Ad set catalog',
      '',
      'Spec: `{ "theme": "brand|light|dark", "image": "assets/…", "imageStyle": "shot|cover", "cta": "Book a demo", "url": "acme.com", "offer"?: "30-day trial", "sizes"?: [ids], "disclosure"?: "AI-generated image", "variants": [ { "name": "pain", "headline": "≤ 8 words, *accent*", "sub": "≤ 14 words", "primary": "platform primary text ≤ 125 chars", "description": "≤ 30 chars" } ] }`',
      `Sizes (default: ${c.ads.defaultSizes.join(', ')}):`,
      ...Object.entries(c.ads.sizes).map(([k, v]) => `- \`${k}\` ${v}`),
      'One template reflows per shape: strips (728×90, 320×50) show logo + headline + button only, so the headline must work alone; skyscrapers stack; stories keep text out of the top 270 px and bottom 380 px.',
      '`imageStyle: "shot"` frames a product screenshot; `"cover"` fills the visual area with a photo. Use real screenshots from assets/. Zoom into the detail that proves the point by adding `#crop=x,y,w,h` (fractions of the image, e.g. `assets/screens/docket.png#crop=0.05,0.1,0.55,0.45`) — a whole screen shrunk into a box is unreadable.',
    ].join('\n');
  }
  if (kind === 'slides') {
    return [
      '# Presentation catalog',
      '',
      'Spec: `{ "title": "deck title", "theme": "<theme>", "slides": [ { "layout": "<id>", "fields": {…}, "notes": "speaker notes" } ] }` — 16:9 (1920×1080). Output: slide PNGs, a PDF and an editable PPTX with your notes.',
      `Themes: ${Object.entries(c.slides.themes).map(([k, v]) => `\`${k}\` — ${v}`).join('; ')}`,
      'Rich text: `*word*` accent · `**word**` bold · `==word==` highlight. One message per slide; the headline states the takeaway.',
      'Images: paths relative to the brief folder. Icons: a brand name or a plain icon word ("inbox", "shield-check"). Zoom into the detail that proves the point by adding `#crop=x,y,w,h` (fractions of the image, e.g. `assets/screens/docket.png#crop=0.05,0.1,0.55,0.45`) — a whole screen shrunk into a box is unreadable.',
      '',
      '## Layouts',
      ...c.slides.layouts.map((l: any) => `### \`${l.id}\` — ${l.label}\n${l.use}\n${l.fields.map(fieldLine).join('\n')}`),
    ].join('\n');
  }
  if (kind === 'deck') {
    return [
      '# Carousel catalog',
      '',
      `Themes: ${Object.entries(c.carousel.themes).map(([k, v]) => `\`${k}\` — ${v}`).join('; ')}`,
      'Presets: `linkedin-carousel` (1080×1350, default), `instagram-carousel` (1080×1350), `tiktok-photo` (1080×1920, TikTok photo mode), `1080x1080`',
      'Several sizes at once: `"sizes": ["tiktok-photo", "instagram-carousel"]` renders the same slides into one folder per size (`out/<size>/slides/`). On `tiktok-photo` keep text out of the top 150 px, the right 140 px and the bottom 420 px — the template pads for it; long copy that overflows comes back to you.',
      'Motion: add `"motion": "chill"` (or any music mood) to also get carousel.mp4 — slides with push-ins, transitions and an original bed, for Reels / LinkedIn video.',
      'Rich text in any text field: `*word*` accent · `**word**` bold · `==word==` highlight.',
      '',
      '## Layouts',
      ...c.carousel.layouts.map((l: any) => `### \`${l.id}\` — ${l.label}\n${l.use}\n${l.fields.map(fieldLine).join('\n')}`),
    ].join('\n');
  }
  return [
    '# Graphics catalog',
    '',
    'Each item: `{ "type": "thumbnail"|"card", "layout": "<id>", "theme"?: "editorial|swiss|bold|midnight", "preset": "<preset id>", "name": "file.png", "fields": {…} }`',
    'Presets: `youtube-thumbnail` 1280×720 · `og-card` 1200×630 · `github-banner` 1280×640 · `x-image` 1600×900 · `instagram-post` 1080×1080 · `linkedin-image` 1080×1350 · `linkedin-landscape` 1200×627 · `story-image` 1080×1920 · `x-header` 1500×500 · `linkedin-banner` 1584×396 · `youtube-banner` 2560×1440 · `app-store-ios` 1290×2796 · `play-store` 1080×1920 · `producthunt-gallery` 1270×760 · `producthunt-thumb` 240×240',
    'File names may carry one folder (`ios/01-track.png`) to keep sets apart. Images that fail to load come back to you.',
    'App store screens (`app-screen`): the caption must stay on 2 lines at ≥ 6% of the canvas width — a caption that shrinks further comes back to you. The screenshot fills the phone\'s width and is cut at the bottom, so use a phone-shaped screenshot or crop a desktop one to a tall region about 1 wide by 2 high in pixels (for a 1440×900 capture: `#crop=x,0,0.29,1`). No real device art or store badges — the frame is generic.',
    'Quotes and people: `pull-quote`, `testimonial`, `quote-post` and `post-card` carry exact words from the brief or source only, attributed to the real person or post. With no real quote, write clearly placeholder words and set `"sample": "yes"` — the image is then labelled "Sample copy — not a real customer". Never invent a named customer, a rating or a platform logo.',
    '',
    '## Thumbnail layouts',
    ...c.thumbnail.layouts.map((l: any) => `### \`${l.id}\` — ${l.label}\n${l.use}\n${l.fields.map(fieldLine).join('\n')}`),
    '',
    '## Card layouts',
    ...c.card.layouts.map((l: any) => `### \`${l.id}\` — ${l.label}\n${l.use}\n${l.fields.map(fieldLine).join('\n')}`),
  ].join('\n');
}

export interface SpecResult {
  ok: boolean;
  /** Problems worth sending back to the model (empty when ok). */
  feedback: string[];
  summary: string;
}

/** Render a spec found in `cwd/out/<file>` into `cwd/out`. */
export async function renderSpec(kind: SpecKind, cwd: string, briefDir: string, opts: { handle?: string; force?: Record<string, unknown> } = {}): Promise<SpecResult> {
  const file = join(cwd, 'out', SPEC_FILE[kind]);
  if (!existsSync(file)) return { ok: false, feedback: [`out/${SPEC_FILE[kind]} was not written.`], summary: 'no spec' };
  let spec: any;
  try {
    spec = JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    return { ok: false, feedback: [`out/${SPEC_FILE[kind]} is not valid JSON: ${(e as Error).message}`], summary: 'bad json' };
  }
  const out = join(cwd, 'out');
  // Choices the user made in the format options win over whatever the model wrote.
  for (const [k, v] of Object.entries(opts.force ?? {})) {
    if (v === null) delete spec[k];
    else if (v !== undefined && (k !== 'motion' || !spec.motion)) spec[k] = v;
  }
  if (Object.keys(opts.force ?? {}).length) await writeFile(file, JSON.stringify(spec, null, 2));
  try {
    if (kind === 'deck') {
      // Photo carousels list several platform sizes: each renders into its own folder (no PDF — those apps take images).
      const asked: string[] = Array.isArray(spec.sizes) ? spec.sizes.map(String).filter((x: string) => /^[\w-]+$/.test(x)) : [];
      const sets: (string | undefined)[] = asked.length ? asked : [undefined];
      const fb: string[] = [];
      let count = 0;
      let bed: { file: string; seconds: number } | undefined;
      for (const preset of sets) {
        const dir = preset ? join(out, preset) : out;
        const r = await callService('stills', 'deck', { ...spec, preset: preset ?? spec.preset, handle: spec.handle ?? opts.handle, brandDir: briefDir, outDir: dir, pdf: !preset });
        count = r.slides.length;
        // Motion version: slides → MP4 with push-ins and slide transitions over an original bed (one bed shared by every size).
        if (spec.motion) {
          const slides = r.slides.map((x: any) => x.file);
          const hold = 2.6;
          const seconds = slides.length * hold + 0.35;
          bed ??= { seconds, file: (await callService('media', 'music', { mood: spec.motion === true ? 'chill' : String(spec.motion), seconds, out: join(out, 'work-bed.wav'), sfx: slides.slice(1).map((_: string, i: number) => ({ kind: 'whoosh', at: (i + 1) * hold, gain: 0.25 })) })).file };
          const silent = join(dir, 'carousel.silent.mp4');
          const mv = await run('node', [join(PLUGIN_DIR, 'scripts', 'slides-to-video.mjs'), '--out', silent, '--size', `${r.width}x${r.height}`, '--hold', String(hold), '--transition', 'slideleft', ...slides], { timeoutMs: 600_000 });
          if (mv.code === 0) {
            const mix = await callService('media', 'mix', { music: bed.file, out: join(dir, 'carousel.m4a'), seconds });
            await run('ffmpeg', ['-y', '-v', 'error', '-i', silent, '-i', mix.file, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'copy', '-shortest', '-movflags', '+faststart', join(dir, 'carousel.mp4')]);
          }
          await run('rm', ['-f', silent, join(dir, 'carousel.m4a')]);
        }
        const tag = preset && sets.length > 1 ? `${preset} slide` : 'Slide';
        // Full-screen 9:16 slides sit under the app's overlays and are read on a phone: safe zone and a larger type floor.
        const tall = r.height / r.width > 1.6;
        const floor = tall ? 28 : 24;
        fb.push(
          ...r.slides.flatMap((s: any, i: number) => [
            ...s.audit.overflow.map((x: string) => `${tag} ${i + 1}: text overflows its box (${x}). Shorten it.`),
            ...s.audit.offCanvas.map((x: string) => `${tag} ${i + 1}: text runs off the canvas (${x}). Shorten it.`),
            ...(tall ? s.audit.unsafe.slice(0, 1).map((x: string) => `${tag} ${i + 1}: ${x} sits where the app's caption, sound or buttons cover it. Shorten it.`) : []),
            ...(s.audit.minFont && s.audit.minFont < floor ? [`${tag} ${i + 1}: smallest text is ${s.audit.minFont}px — too small for mobile.`] : []),
            ...(s.audit.tinyShots?.length ? [`${tag} ${i + 1}: ${s.audit.tinyShots[0]}`] : []),
          ]),
        );
      }
      if (bed) await run('rm', ['-f', bed.file]);
      return { ok: !fb.length, feedback: fb, summary: sets[0] ? `${count} slides × ${sets.length} size${sets.length === 1 ? '' : 's'}` : `${count} slides + PDF` };
    }
    if (kind === 'graphics') {
      const r = await callService('stills', 'graphics', { ...spec, brandDir: briefDir, outDir: out, handle: opts.handle });
      const fb = r.items.flatMap((g: any) => {
        const at = g.file.slice(out.length + 1);
        return [
          ...g.audit.overflow.map((x: string) => `${at}: text overflows (${x}).`),
          ...g.audit.offCanvas.map((x: string) => `${at}: text runs off the canvas (${x}).`),
          ...g.audit.unsafe.slice(0, 2).map((x: string) => `${at}: ${x} sits inside the ${g.preset} safe margin — platform UI may cover it.`),
          ...(g.audit.tinyShots?.length && !/-(portrait|wide|story)\./.test(g.file) ? [`${at.replace(/-feed(?=\.)/, '')} (every size): ${g.audit.tinyShots[0]}`] : []),
          ...(g.audit.small ?? []).slice(0, 1).map((x: string) => `${at}: ${x} had to shrink below its readable size to fit — shorten it.`),
          ...(g.audit.broken?.length ? [`${at}: image ${g.audit.broken[0]} didn't load — use a real file from assets/ (path relative to the brief folder).`] : []),
        ];
      });
      return { ok: !fb.length, feedback: fb, summary: `${r.items.length} graphics` };
    }
    if (kind === 'document') {
      const r = await callService('stills', 'document', { ...spec, brandDir: briefDir, outDir: out, name: 'document' });
      return { ok: !r.problems.length, feedback: r.problems, summary: `${r.pages.length}-page PDF` };
    }
    if (kind === 'print') {
      const r = await callService('stills', 'print', { ...spec, brandDir: briefDir, outDir: out });
      return { ok: !r.problems.length, feedback: r.problems, summary: `${r.pieces.length} print piece${r.pieces.length === 1 ? '' : 's'} · PDF with bleed + PNG` };
    }
    if (kind === 'landing') {
      const r = await callService('stills', 'landing', { ...spec, brandDir: briefDir, outDir: out });
      return { ok: !r.problems.length, feedback: r.problems, summary: `landing page · ${r.sections.length} sections` };
    }
    if (kind === 'email') {
      const r = await callService('stills', 'email', { ...spec, brandDir: briefDir, outDir: out });
      return { ok: !r.problems.length, feedback: r.problems.slice(0, 20), summary: `${r.emails.length} email${r.emails.length === 1 ? '' : 's'} · HTML + text + upload zip` };
    }
    if (kind === 'ads') {
      const r = await callService('stills', 'ads', { ...spec, brandDir: briefDir, outDir: out });
      const fb = r.items.flatMap((g: any) => [
        ...g.audit.overflow.map((x: string) => `${g.variant} @ ${g.size}: text overflows (${x}) — shorten the headline for small sizes.`),
        ...g.audit.offCanvas.map((x: string) => `${g.variant} @ ${g.size}: text runs off the ad (${x}).`),
        ...(g.size === 'story' ? g.audit.unsafe.slice(0, 1).map((x: string) => `${g.variant} @ story: ${x} sits where the platform UI covers it.`) : []),
      ]);
      return { ok: !fb.length, feedback: fb.slice(0, 20), summary: `${r.variants.length} variants × ${r.sizes.length} sizes + ads.csv` };
    }
    if (kind === 'slides') {
      const r = await callService('stills', 'slides', { ...spec, brandDir: briefDir, outDir: out, name: 'presentation' });
      const fb = r.slides.flatMap((s: any, i: number) => [
        ...s.audit.overflow.map((x: string) => `Slide ${i + 1}: text overflows its box (${x}). Shorten it or split the slide.`),
        ...s.audit.offCanvas.map((x: string) => `Slide ${i + 1}: text runs off the slide (${x}). Shorten it.`),
        ...(s.audit.minFont && s.audit.minFont < 20 ? [`Slide ${i + 1}: smallest text is ${s.audit.minFont}px — too small to read from the back of a room.`] : []),
        ...(s.audit.tinyShots?.length ? [`Slide ${i + 1}: ${s.audit.tinyShots[0]}`] : []),
      ]);
      return { ok: !fb.length, feedback: fb, summary: `${r.slides.length} slides · PDF + PPTX` };
    }
    if (kind === 'infographic') {
      const v = await callService('render', 'validateInfographic', { spec });
      if (v.errors.length) return { ok: false, feedback: v.errors, summary: 'invalid infographic' };
      const r = await callService('render', 'infographic', { spec, outDir: out, brandDir: briefDir, name: 'infographic' });
      await writeFile(join(out, 'qa.json'), JSON.stringify(r.qa, null, 2));
      const fb = (r.qa?.issues ?? []).filter((i: any) => i.severity === 'error').map((i: any) => `${i.message}${i.fix ? ` Fix: ${i.fix}` : ''}`);
      return { ok: !fb.length, feedback: fb, summary: `animated infographic (${r.duration.toFixed(1)}s loop, GIF + MP4 + PNG)` };
    }
    const v = await callService('render', 'validate', { storyboard: spec });
    if (v.errors.length) return { ok: false, feedback: v.errors, summary: 'invalid storyboard' };
    const r = await callService('render', 'render', { storyboard: spec, outDir: out, brandDir: briefDir, name: 'video' });
    await writeFile(join(out, 'qa.json'), JSON.stringify(r.qa, null, 2));
    // Long-form: drop the real chapter timestamps into the YouTube description.
    if (r.timestamps && existsSync(join(out, 'description.md'))) {
      const d = await readFile(join(out, 'description.md'), 'utf8');
      await writeFile(join(out, 'description.md'), d.includes('{{timestamps}}') ? d.replace('{{timestamps}}', r.timestamps) : `${d.trimEnd()}\n\n${r.timestamps}\n`);
    }
    const fb = (r.qa?.issues ?? []).filter((i: any) => i.severity === 'error').map((i: any) => `${i.message}${i.fix ? ` Fix: ${i.fix}` : ''}`);
    return { ok: !fb.length, feedback: fb, summary: `${r.duration.toFixed(1)}s video, QA ${r.qa?.pass ? 'passed' : 'flagged issues'}` };
  } catch (e) {
    return { ok: false, feedback: [(e as Error).message.slice(0, 1500)], summary: 'render failed' };
  }
}

/** Phrases that read as generic AI marketing copy (research §G). */
export const BANNED_PHRASES = [
  'excited to announce', 'excited to share', 'thrilled to', 'game-changer', 'game changer', 'revolutionize', 'revolutionary', 'unlock', 'supercharge',
  'seamless', 'streamline your workflow', "in today's fast-paced", 'leverage', 'elevate', 'delve', 'empower', 'cutting-edge', 'next-level', 'harness the power',
];

/**
 * Product Hunt launch copy (out/launch-copy.md, one `## ` section per field):
 * the listing's own limits, checked before anyone pastes it into the form.
 */
export function checkLaunchCopy(md: string | null): string[] {
  if (!md?.trim()) return ['out/launch-copy.md was not written.'];
  const sections = md.split(/^##\s+/m).slice(1).map((p) => ({ head: p.split('\n')[0].trim().toLowerCase(), body: p.split('\n').slice(1).join('\n').trim() }));
  const get = (k: string) => sections.find((x) => x.head.startsWith(k))?.body ?? '';
  const out: string[] = [];
  for (const [k, label] of [['name', 'Name'], ['tagline', 'Tagline'], ['description', 'Description'], ['maker', "Maker's first comment"], ['topics', 'Topics']]) if (!get(k)) out.push(`launch-copy.md: the "## ${label}" section is missing or empty.`);
  const tagline = get('tagline').replace(/\s+/g, ' ');
  if (tagline.length > 60) out.push(`launch-copy.md: the tagline is ${tagline.length} characters; Product Hunt allows 60.`);
  const desc = get('description').replace(/\s+/g, ' ');
  if (desc.length > 260) out.push(`launch-copy.md: the description is ${desc.length} characters; Product Hunt allows 260.`);
  const topics = get('topics').split('\n').map((l) => l.replace(/^\s*(?:[-*]|\d+\.)\s*/, '').trim()).filter(Boolean);
  if (topics.length && topics.length !== 3) out.push(`launch-copy.md: list exactly 3 topics (one per line), not ${topics.length}.`);
  const comment = get('maker');
  if (comment && comment.length < 300) out.push("launch-copy.md: the maker's first comment is too thin — say who you are, why you built it, what's in it today and what feedback you want (100–300 words).");
  const all = [tagline, desc, comment].join(' ').toLowerCase();
  for (const p of BANNED_PHRASES) if (all.includes(p)) out.push(`launch-copy.md: uses "${p}" — rewrite it in plain, specific words.`);
  return out.slice(0, 12);
}

/** Platform limits for the copy kit; returns problems to send back to Claude. */
export function checkCopy(copy: Record<string, { label: string; text: string }[]>): string[] {
  const out: string[] = [];
  for (const [channel, items] of Object.entries(copy ?? {})) {
    for (const it of Array.isArray(items) ? items : []) {
      const t = String(it?.text ?? '');
      const lower = t.toLowerCase();
      const where = `${channel} / ${it?.label ?? '?'}`;
      for (const p of BANNED_PHRASES) if (lower.includes(p)) out.push(`${where}: uses "${p}" — rewrite it in plain, specific words.`);
      if (/^linkedin/i.test(channel)) {
        const hook = t.split(/\n\s*\n/)[0];
        if (hook.length > 210) out.push(`${where}: the hook before the first blank line is ${hook.length} chars; LinkedIn cuts at ~210 ("…see more").`);
        if (t.length > 3000) out.push(`${where}: ${t.length} chars, over LinkedIn's 3000 limit.`);
      }
      if (/^(x|twitter)/i.test(channel) && !/thread/i.test(it?.label ?? '')) for (const post of t.split(/\n\s*\d+\/\d*\s*\n|\n---\n/)) if (post.trim().length > 280) out.push(`${where}: a post is ${post.trim().length} chars (X allows 280).`);
      if (/^youtube/i.test(channel) && /title/i.test(it?.label ?? '') && t.length > 70) out.push(`${where}: title is ${t.length} chars; keep under 60 so it isn't truncated.`);
      if ((t.match(/\p{Extended_Pictographic}/gu) ?? []).length > 3) out.push(`${where}: ${(t.match(/\p{Extended_Pictographic}/gu) ?? []).length} emoji — keep it to 2 or fewer.`);
    }
  }
  return out.slice(0, 20);
}
