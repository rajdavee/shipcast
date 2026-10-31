import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { callService } from './service.ts';

/**
 * Spec formats: Claude writes a JSON spec, a capability service renders it.
 * This module knows, per spec kind, the file name, how to describe the
 * catalog to the model, how to render, and how to turn the result into
 * actionable feedback.
 */

export type SpecKind = 'deck' | 'graphics' | 'storyboard';

export const SPEC_FILE: Record<SpecKind, string> = { deck: 'deck.json', graphics: 'graphics.json', storyboard: 'storyboard.json' };

type FieldDoc = { id: string; type: string; label: string; optional?: boolean; max?: number; help?: string; choices?: string[] };
const fieldLine = (f: FieldDoc) =>
  `  - \`${f.id}\` (${f.type}${f.optional ? ', optional' : ''}${f.max ? `, ≤${f.max}${f.type === 'list' ? ' items' : ' chars'}` : ''}${f.choices ? `: ${f.choices.join('|')}` : ''}) — ${f.label}${f.help ? `. ${f.help}` : ''}`;

/** Markdown reference of what a spec may contain, generated from the live services. */
export async function catalogMarkdown(kind: SpecKind): Promise<string> {
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
export async function renderSpec(kind: SpecKind, cwd: string, briefDir: string, opts: { handle?: string } = {}): Promise<SpecResult> {
  const file = join(cwd, 'out', SPEC_FILE[kind]);
  if (!existsSync(file)) return { ok: false, feedback: [`out/${SPEC_FILE[kind]} was not written.`], summary: 'no spec' };
  let spec: any;
  try {
    spec = JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    return { ok: false, feedback: [`out/${SPEC_FILE[kind]} is not valid JSON: ${(e as Error).message}`], summary: 'bad json' };
  }
  const out = join(cwd, 'out');
  try {
    if (kind === 'deck') {
      const r = await callService('stills', 'deck', { ...spec, handle: spec.handle ?? opts.handle, brandDir: briefDir, outDir: out });
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
