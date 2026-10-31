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

export type SpecKind = 'deck' | 'graphics' | 'storyboard' | 'infographic';

export const SPEC_FILE: Record<SpecKind, string> = { deck: 'deck.json', graphics: 'graphics.json', storyboard: 'storyboard.json', infographic: 'infographic.json' };

type FieldDoc = { id: string; type: string; label: string; optional?: boolean; max?: number; help?: string; choices?: string[] };
const fieldLine = (f: FieldDoc) =>
  `  - \`${f.id}\` (${f.type}${f.optional ? ', optional' : ''}${f.max ? `, ≤${f.max}${f.type === 'list' ? ' items' : ' chars'}` : ''}${f.choices ? `: ${f.choices.join('|')}` : ''}) — ${f.label}${f.help ? `. ${f.help}` : ''}`;

/** Markdown reference of what a spec may contain, generated from the live services. */
export async function catalogMarkdown(kind: SpecKind): Promise<string> {
  if (kind === 'infographic') {
    return [
      '# Infographic catalog',
      '',
      'Column kinds: `stage` (dark numbered pill, 1–3 words), `note` (sticky note, ≤ 70 chars; tones yellow|green|blue|pink), `chips` (list of platform/tool names rendered with their real logos), `text` (plain line).',
      'Sizes: `1080x1350` (default, LinkedIn/Instagram portrait) or `1080x1080`. Themes: `board` (light dotted canvas, default) or `night`.',
      `Chip names with known logos: ${KNOWN_ICONS.join(', ')}. Any other well-known product name usually resolves too (e.g. "Notion", "Figma", "Stripe"); unknown names get a tidy monogram.`,
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
      'Transitions (how a scene enters): `cut` `flash` `wipe` `fade` `zoom` — wipes/zooms get a whoosh, flashes an impact.',
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
  if (kind === 'deck') {
    return [
      '# Carousel catalog',
      '',
      `Themes: ${Object.entries(c.carousel.themes).map(([k, v]) => `\`${k}\` — ${v}`).join('; ')}`,
      'Presets: `linkedin-carousel` (1080×1350, default), `instagram-carousel` (1080×1350), `1080x1080`',
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
    'Presets: `youtube-thumbnail` 1280×720 · `og-card` 1200×630 · `github-banner` 1280×640 · `x-image` 1600×900 · `linkedin-image` 1080×1350 · `story-image` 1080×1920 · `x-header` 1500×500 · `linkedin-banner` 1584×396 · `youtube-banner` 2560×1440',
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
      const r = await callService('stills', 'deck', { ...spec, handle: spec.handle ?? opts.handle, brandDir: briefDir, outDir: out });
      // Motion version: slides → MP4 with push-ins and slide transitions over an original bed.
      if (spec.motion) {
        const slides = r.slides.map((x: any) => x.file);
        const hold = 2.6;
        const seconds = slides.length * hold + 0.35;
        const bed = await callService('media', 'music', { mood: spec.motion === true ? 'chill' : String(spec.motion), seconds, out: join(out, 'work-bed.wav'), sfx: slides.slice(1).map((_: string, i: number) => ({ kind: 'whoosh', at: (i + 1) * hold, gain: 0.25 })) });
        const silent = join(out, 'carousel.silent.mp4');
        const mv = await run('node', [join(PLUGIN_DIR, 'scripts', 'slides-to-video.mjs'), '--out', silent, '--size', `${r.width}x${r.height}`, '--hold', String(hold), '--transition', 'slideleft', ...slides], { timeoutMs: 600_000 });
        if (mv.code === 0) {
          const mix = await callService('media', 'mix', { music: bed.file, out: join(out, 'carousel.m4a'), seconds });
          await run('ffmpeg', ['-y', '-v', 'error', '-i', silent, '-i', mix.file, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'copy', '-shortest', '-movflags', '+faststart', join(out, 'carousel.mp4')]);
        }
        await run('rm', ['-f', silent, join(out, 'carousel.m4a'), bed.file]);
      }
      const fb = r.slides.flatMap((s: any, i: number) => [
        ...s.audit.overflow.map((x: string) => `Slide ${i + 1}: text overflows its box (${x}). Shorten it.`),
        ...s.audit.offCanvas.map((x: string) => `Slide ${i + 1}: text runs off the canvas (${x}). Shorten it.`),
        ...(s.audit.minFont && s.audit.minFont < 24 ? [`Slide ${i + 1}: smallest text is ${s.audit.minFont}px — too small for mobile.`] : []),
      ]);
      return { ok: !fb.length, feedback: fb, summary: `${r.slides.length} slides + PDF` };
    }
    if (kind === 'graphics') {
      const r = await callService('stills', 'graphics', { ...spec, brandDir: briefDir, outDir: out, handle: opts.handle });
      const fb = r.items.flatMap((g: any) => [
        ...g.audit.overflow.map((x: string) => `${g.file.split('/').pop()}: text overflows (${x}).`),
        ...g.audit.offCanvas.map((x: string) => `${g.file.split('/').pop()}: text runs off the canvas (${x}).`),
        ...g.audit.unsafe.slice(0, 2).map((x: string) => `${g.file.split('/').pop()}: ${x} sits inside the ${g.preset} safe margin — platform UI may cover it.`),
      ]);
      return { ok: !fb.length, feedback: fb, summary: `${r.items.length} graphics` };
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
