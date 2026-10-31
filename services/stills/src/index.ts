import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertInHome, browser, createService, FIT_SCRIPT, getPreset, layoutAuditScript, loadBrand, normalizeBrand, presetForSize, SERVICE_PORTS, type BrandKit, type LayoutAudit } from '@shipcast/engine';
import { CAROUSEL_LAYOUTS, renderCarouselSlide, THEMES } from './templates/carousel.ts';
import type { RenderCtx } from './templates/common.ts';
import { CARD_LAYOUTS, renderCard, renderThumbnail, THUMBNAIL_LAYOUTS } from './templates/graphics.ts';

export { CAROUSEL_LAYOUTS, THEMES, CARD_LAYOUTS, THUMBNAIL_LAYOUTS };

export interface GraphicSpec {
  type: 'thumbnail' | 'card';
  layout: string;
  theme?: string;
  preset: string;
  fields: Record<string, unknown>;
  /** File name (relative to outDir) to write. */
  name: string;
}

export interface SlideSpec {
  layout: string;
  fields: Record<string, unknown>;
}

export interface DeckSpec {
  theme: string;
  /** Preset id: linkedin-carousel (default), instagram-carousel, or a WxH. */
  preset?: string;
  handle?: string;
  slides: SlideSpec[];
}

async function brandFrom(input: { brandDir?: string; brand?: Partial<BrandKit> }): Promise<{ brand: BrandKit; assetsDir?: string }> {
  if (input.brandDir) {
    const dir = assertInHome(input.brandDir, 'brandDir');
    return { brand: await loadBrand(dir), assetsDir: dir };
  }
  return { brand: normalizeBrand(input.brand) };
}

function size(preset?: string): { width: number; height: number; safe: { top: number; right: number; bottom: number; left: number } } {
  const p = getPreset(preset ?? 'linkedin-carousel');
  if (p) return { width: p.width, height: p.height, safe: p.safe };
  const m = preset?.match(/^(\d+)x(\d+)$/);
  if (m) {
    const w = Number(m[1]);
    const h = Number(m[2]);
    return { width: w, height: h, safe: presetForSize(w, h)?.safe ?? { top: 60, right: 60, bottom: 60, left: 60 } };
  }
  throw new Error(`unknown preset ${preset}`);
}

/** Render an HTML document to PNG/JPG and audit its layout in the same pass. */
async function capture(html: string, file: string, width: number, height: number, safe: { top: number; right: number; bottom: number; left: number }) {
  await mkdir(dirname(file), { recursive: true });
  const htmlFile = file.replace(/\.(png|jpe?g)$/, '.html');
  await writeFile(htmlFile, html);
  const page = await browser().open(pathToFileURL(htmlFile).href, { width, height, settleMs: 80 });
  try {
    await page.eval(FIT_SCRIPT);
    const audit = await page.eval<LayoutAudit>(layoutAuditScript(safe, width, height));
    const jpg = /\.jpe?g$/.test(file);
    await writeFile(file, await page.screenshot(jpg ? 'jpeg' : 'png', 90));
    return { file, html: htmlFile, audit };
  } finally {
    await page.close();
  }
}

/** Combine PNG pages into one PDF, each page exactly the slide size. */
async function pdfFromImages(images: string[], out: string, width: number, height: number) {
  const html = `<!doctype html><html><head><style>@page{size:${width}px ${height}px;margin:0}html,body{margin:0}img{display:block;width:${width}px;height:${height}px;page-break-after:always}</style></head><body>${images.map((i) => `<img src="${pathToFileURL(i).href}">`).join('')}</body></html>`;
  const htmlFile = out.replace(/\.pdf$/, '.pdf.html');
  await writeFile(htmlFile, html);
  const page = await browser().open(pathToFileURL(htmlFile).href, { width, height });
  try {
    await writeFile(out, await page.pdf());
  } finally {
    await page.close();
  }
  return out;
}

/**
 * stills — designed templates → PNG/JPG/PDF through a warm headless Chrome.
 * Every render also returns a layout audit (overflow, off-canvas, safe-zone,
 * smallest type) that the qa gate and the director use.
 */
export function createStillsService() {
  return createService({
    name: 'stills',
    port: SERVICE_PORTS.stills,
    version: '0.2.0',
    concurrency: 1,
    handlers: {
      catalog: async () => ({
        carousel: { themes: Object.fromEntries(Object.entries(THEMES).map(([k, v]) => [k, v.label])), layouts: CAROUSEL_LAYOUTS.map(({ html, ...l }) => l) },
        thumbnail: { layouts: THUMBNAIL_LAYOUTS.map(({ html, ...l }) => l) },
        card: { layouts: CARD_LAYOUTS.map(({ html, ...l }) => l) },
      }),

      /** A carousel deck → slide PNGs, one PDF, and per-slide audits. */
      deck: async (input: DeckSpec & { brandDir?: string; brand?: Partial<BrandKit>; outDir: string; pdf?: boolean; only?: number[] }, ctx) => {
        const outDir = assertInHome(input.outDir, 'outDir');
        const { brand, assetsDir } = await brandFrom(input);
        const { width, height, safe } = size(input.preset);
        if (!Array.isArray(input.slides) || !input.slides.length) throw new Error('slides are required');
        const results = [];
        for (let i = 0; i < input.slides.length; i++) {
          const file = join(outDir, 'slides', `slide-${String(i + 1).padStart(2, '0')}.png`);
          if (input.only && !input.only.includes(i + 1)) {
            results.push({ file, skipped: true });
            continue;
          }
          ctx.progress(i / input.slides.length, `slide ${i + 1}`);
          const s = input.slides[i];
          const rctx: RenderCtx = { brand, width, height, page: i + 1, pages: input.slides.length, assetsDir, handle: input.handle };
          results.push(await capture(renderCarouselSlide(s.layout, input.theme, s.fields ?? {}, rctx), file, width, height, safe));
        }
        const pdf = input.pdf === false ? undefined : await pdfFromImages(results.map((r) => r.file), join(outDir, 'carousel.pdf'), width, height);
        return { slides: results, pdf, width, height };
      },

      /** Thumbnails and social cards, many at once. */
      graphics: async (input: { items: GraphicSpec[]; brandDir?: string; brand?: Partial<BrandKit>; outDir: string; handle?: string }, ctx) => {
        const outDir = assertInHome(input.outDir, 'outDir');
        const { brand, assetsDir } = await brandFrom(input);
        const results = [];
        for (const [i, g] of (input.items ?? []).entries()) {
          ctx.progress(i / input.items.length, g.name);
          const { width, height, safe } = size(g.preset);
          const rctx: RenderCtx = { brand, width, height, assetsDir, handle: input.handle };
          const html = g.type === 'thumbnail' ? renderThumbnail(g.layout, g.fields ?? {}, rctx) : renderCard(g.layout, g.theme ?? 'editorial', g.fields ?? {}, rctx);
          const name = String(g.name || `${g.layout}-${i + 1}.png`).replace(/[^\w.-]/g, '_');
          results.push({ ...(await capture(html, join(outDir, /\.(png|jpe?g)$/.test(name) ? name : `${name}.png`), width, height, safe)), preset: g.preset, layout: g.layout });
        }
        return { items: results };
      },

      /** Arbitrary HTML file (authored by Claude) → image, with audit. */
      html: async ({ file, out, width, height, preset }) => {
        const p = preset ? size(preset) : { width, height, safe: presetForSize(width, height)?.safe ?? { top: 0, right: 0, bottom: 0, left: 0 } };
        const html = await readFile(assertInHome(file, 'file'), 'utf8');
        return capture(html, assertInHome(out, 'out'), p.width, p.height, p.safe);
      },
    },
  });
}
