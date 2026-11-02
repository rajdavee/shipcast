import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertInHome, browser, writePptx, type PptxSlide, createService, FIT_SCRIPT, run, TIDY_PAGE_SCRIPT, getPreset, layoutAuditScript, loadBrand, normalizeBrand, presetForSize, resolveIcons, SERVICE_PORTS, type BrandKit, type LayoutAudit } from '@shipcast/engine';
import { CAROUSEL_LAYOUTS, carouselIconNames, renderCarouselSlide, THEMES } from './templates/carousel.ts';
import type { RenderCtx } from './templates/common.ts';
import { CARD_LAYOUTS, renderCard, renderThumbnail, THUMBNAIL_LAYOUTS } from './templates/graphics.ts';
import { AD_SIZES, DEFAULT_AD_SIZES, renderAd, type AdSpec } from './templates/ads.ts';
import { HIDE_TEXT_CSS, MEASURE_TEXT_SCRIPT, renderSlide, SLIDE_LAYOUTS, SLIDE_THEMES, slideIconNames, type SlidePage } from './templates/slides.ts';
import { DOC_AUDIT_SCRIPT, DOC_LAYOUTS, DOC_THEMES, docIconNames, PAGE_SIZES, renderDocument, type DocPage } from './templates/document.ts';

export { CAROUSEL_LAYOUTS, THEMES, CARD_LAYOUTS, THUMBNAIL_LAYOUTS, DOC_LAYOUTS, DOC_THEMES, PAGE_SIZES, SLIDE_LAYOUTS, SLIDE_THEMES };

export interface SlidesSpec {
  title?: string;
  theme?: string;
  slides: SlidePage[];
}

export interface DocumentSpec {
  title?: string;
  /** a4 (default) or letter. */
  size?: string;
  theme?: string;
  footer?: string;
  pages: DocPage[];
}

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

/** Render an HTML document to PNG/JPG and audit it; one retry on a fresh browser if Chrome dies mid-capture. */
async function capture(html: string, file: string, width: number, height: number, safe: { top: number; right: number; bottom: number; left: number }) {
  try {
    return await captureOnce(html, file, width, height, safe);
  } catch (e) {
    if (!/DevTools|timed out|closed|Target/i.test(String((e as Error).message))) throw e;
    await browser().restart();
    return captureOnce(html, file, width, height, safe);
  }
}

async function captureOnce(html: string, file: string, width: number, height: number, safe: { top: number; right: number; bottom: number; left: number }) {
  await mkdir(dirname(file), { recursive: true });
  const htmlFile = file.replace(/\.(png|jpe?g)$/, '.html');
  await writeFile(htmlFile, html);
  const page = await browser().open(pathToFileURL(htmlFile).href, { width, height, settleMs: 80 });
  try {
    await page.eval(FIT_SCRIPT);
    // Templates with their own fitting rules (ads) expose it on the page.
    await page.eval('document.fonts.ready.then(() => (window.__shipcastFit ? window.__shipcastFit() : 0))');
    const audit = await page.eval<LayoutAudit>(layoutAuditScript(safe, width, height));
    const jpg = /\.jpe?g$/.test(file);
    await writeFile(file, await page.screenshot(jpg ? 'jpeg' : 'png', 90));
    return { file, html: htmlFile, audit };
  } finally {
    await page.close();
  }
}

/** Combine PNG pages into one PDF, each page exactly the slide size. */
/** A labelled grid of mixed-size images (ads, page sets), drawn by Chrome so any sizes fit. */
async function contactSheet(images: { file: string; label: string }[], out: string, cell = 300): Promise<string> {
  const cols = Math.min(5, images.length);
  const rows = Math.ceil(images.length / cols);
  const W = cols * (cell + 20) + 20;
  const H = rows * (cell + 46) + 20;
  const html = `<!doctype html><html><head><style>html,body{margin:0;background:#e6e8ec;font:600 13px system-ui}.g{display:grid;grid-template-columns:repeat(${cols},${cell}px);gap:20px 20px;padding:20px}.c{height:${cell + 26}px;display:grid;grid-template-rows:${cell}px 26px;justify-items:center;align-items:center}.c img{max-width:${cell}px;max-height:${cell}px;box-shadow:0 6px 18px -8px rgba(0,0,0,.35)}.c span{color:#4a505c}</style></head><body><div class="g">${images.map((i) => `<div class="c"><img src="${pathToFileURL(i.file).href}"><span>${i.label}</span></div>`).join('')}</div></body></html>`;
  const tmp = out.replace(/\.png$/, '.html');
  await writeFile(tmp, html);
  const p = await browser().open(pathToFileURL(tmp).href, { width: W, height: H, settleMs: 200 });
  try {
    await writeFile(out, await p.screenshot('png'));
  } finally {
    await p.close();
    await rm(tmp, { force: true });
  }
  return out;
}

async function pdfFromImages(images: string[], out: string, width: number, height: number): Promise<string> {
  try {
    return await pdfOnce(images, out, width, height);
  } catch (e) {
    if (!/DevTools|timed out|closed|Target/i.test(String((e as Error).message))) throw e;
    await browser().restart();
    return pdfOnce(images, out, width, height);
  }
}

async function pdfOnce(pngs: string[], out: string, width: number, height: number) {
  // High-quality JPEG pages keep the PDF a fraction of the size (LinkedIn caps uploads at 100 MB).
  const images: string[] = [];
  for (const p of pngs) {
    const jpg = p.replace(/\.png$/, '.pdf.jpg');
    const r = await run('ffmpeg', ['-y', '-v', 'error', '-i', p, '-q:v', '2', jpg]);
    images.push(r.code === 0 ? jpg : p);
  }
  const html = `<!doctype html><html><head><style>@page{size:${width}px ${height}px;margin:0}html,body{margin:0}img{display:block;width:${width}px;height:${height}px;page-break-after:always}</style></head><body>${images.map((i) => `<img src="${pathToFileURL(i).href}">`).join('')}</body></html>`;
  const htmlFile = out.replace(/\.pdf$/, '.pdf.html');
  await writeFile(htmlFile, html);
  const page = await browser().open(pathToFileURL(htmlFile).href, { width, height });
  try {
    await writeFile(out, await page.pdf());
  } finally {
    await page.close();
    for (const i of images) if (i.endsWith('.pdf.jpg')) await rm(i, { force: true });
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
        ads: { sizes: Object.fromEntries(Object.entries(AD_SIZES).map(([k, v]) => [k, `${v.w}×${v.h} ${v.label}`])), defaultSizes: DEFAULT_AD_SIZES, themes: ['brand', 'light', 'dark'] },
        slides: { themes: Object.fromEntries(Object.entries(SLIDE_THEMES).map(([k, v]) => [k, v.label])), layouts: SLIDE_LAYOUTS.map(({ html, ...l }) => l) },
        document: { themes: Object.fromEntries(Object.entries(DOC_THEMES).map(([k, v]) => [k, v.label])), sizes: Object.fromEntries(Object.entries(PAGE_SIZES).map(([k, v]) => [k, v.label])), layouts: DOC_LAYOUTS.map(({ html, ...l }) => l) },
      }),

      /** An ad set: every hook variant × every placement size, an upload sheet and a contact sheet per variant. */
      ads: async (input: AdSpec & { brandDir?: string; brand?: Partial<BrandKit>; outDir: string }, ctx) => {
        const outDir = assertInHome(input.outDir, 'outDir');
        const { brand, assetsDir } = await brandFrom(input);
        if (!Array.isArray(input.variants) || !input.variants.length) throw new Error('variants are required');
        const sizes = (input.sizes?.length ? input.sizes : DEFAULT_AD_SIZES).filter((x) => AD_SIZES[x]);
        const slug = (x: string) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'v';
        const items = [];
        const csv = [['variant', 'size', 'platform', 'width', 'height', 'file', 'headline', 'primary_text', 'description', 'cta', 'url'].join(',')];
        const q = (x: unknown) => `"${String(x ?? '').replace(/"/g, '""')}"`;
        let n = 0;
        for (const v of input.variants.slice(0, 10)) {
          const vdir = join(outDir, 'ads', slug(v.name));
          for (const sz of sizes) {
            ctx.progress(n++ / (input.variants.length * sizes.length), `${v.name} · ${sz}`);
            const s = AD_SIZES[sz];
            const file = join(vdir, `${slug(v.name)}-${sz}.png`);
            const r = await capture(renderAd(input, v, sz, { brand, width: s.w, height: s.h, assetsDir }), file, s.w, s.h, s.safe ?? { top: 0, right: 0, bottom: 0, left: 0 });
            items.push({ ...r, variant: v.name, size: sz });
            csv.push([q(v.name), sz, s.platform, s.w, s.h, q(file.slice(outDir.length + 1)), q(v.headline.replace(/[*=]/g, '')), q(v.primary), q(v.description), q(input.cta), q(input.url)].join(','));
          }
          await contactSheet(items.filter((x) => x.variant === v.name).map((x) => ({ file: x.file, label: `${AD_SIZES[x.size].w}×${AD_SIZES[x.size].h}` })), join(outDir, `${slug(v.name)}.sheet.png`));
        }
        await writeFile(join(outDir, 'ads.csv'), csv.join('\n') + '\n');
        return { items, csv: join(outDir, 'ads.csv'), sizes, variants: input.variants.map((v) => v.name) };
      },

      /**
       * A presentation → slide PNGs, a PDF and an editable PPTX: each PPTX slide is a
       * text-free render of the design with the measured text rebuilt as real text boxes.
       */
      slides: async (input: SlidesSpec & { brandDir?: string; brand?: Partial<BrandKit>; outDir: string; name?: string }, ctx) => {
        const outDir = assertInHome(input.outDir, 'outDir');
        const { brand, assetsDir } = await brandFrom(input);
        if (!Array.isArray(input.slides) || !input.slides.length) throw new Error('slides are required');
        const W = 1920;
        const H = 1080;
        const PX = 13.333 / W; // inches per pixel on a 16:9 PowerPoint slide
        const names = slideIconNames(input.slides);
        const icons = names.length ? await resolveIcons(names) : {};
        const base = String(input.name ?? 'presentation').replace(/[^\w-]/g, '_');
        await mkdir(join(outDir, 'slides'), { recursive: true });
        await mkdir(join(outDir, 'work', 'pptx'), { recursive: true });
        const results = [];
        const pptxSlides: PptxSlide[] = [];
        for (let i = 0; i < input.slides.length; i++) {
          ctx.progress((0.85 * i) / input.slides.length, `slide ${i + 1}`);
          const s = input.slides[i];
          const html = renderSlide(s, input.theme ?? 'brand', { brand, width: W, height: H, page: i + 1, pages: input.slides.length, assetsDir, icons });
          const file = join(outDir, 'slides', `slide-${String(i + 1).padStart(2, '0')}.png`);
          const shot = await capture(html, file, W, H, { top: 40, right: 60, bottom: 40, left: 60 });
          // Second pass on the same HTML: measure the text, then render the design without it.
          const tmp = join(outDir, 'work', 'pptx', `slide-${i + 1}.html`);
          await writeFile(tmp, html.replace('</style>', `${HIDE_TEXT_CSS}</style>`).replace('<body>', '<body data-measure="1">'));
          await writeFile(tmp.replace('.html', '.measure.html'), html);
          const pm = await browser().open(pathToFileURL(tmp.replace('.html', '.measure.html')).href, { width: W, height: H, settleMs: 200 });
          let boxes: any[] = [];
          try {
            await pm.eval('document.fonts.ready.then(() => true)');
            boxes = await pm.eval<any[]>(MEASURE_TEXT_SCRIPT);
          } finally {
            await pm.close();
          }
          const pb = await browser().open(pathToFileURL(tmp).href, { width: W, height: H, settleMs: 200 });
          const bg = join(outDir, 'work', 'pptx', `bg-${i + 1}.png`);
          try {
            await pb.eval('document.fonts.ready.then(() => true)');
            await writeFile(bg, await pb.screenshot('png'));
          } finally {
            await pb.close();
          }
          pptxSlides.push({
            background: { image: bg },
            items: boxes.map((b) => ({ type: 'text' as const, text: b.text, x: b.x * PX, y: b.y * PX, w: Math.max(0.3, b.w * PX + 0.08), h: Math.max(0.2, b.h * PX), size: Math.max(6, Math.round(b.size * PX * 72 * 10) / 10), bold: b.bold, color: b.color, font: b.font, align: b.align, bullets: b.bullets, lineSpacing: b.lineSpacing, valign: 'top' as const })),
            notes: s.notes,
          });
          results.push({ ...shot, notes: !!s.notes });
        }
        ctx.progress(0.9, 'PDF and PPTX');
        const pdf = await pdfFromImages(results.map((r) => r.file), join(outDir, `${base}.pdf`), W, H);
        const pptx = join(outDir, `${base}.pptx`);
        await writePptx({ title: input.title, author: brand.name, slides: pptxSlides, fonts: { heading: brand.fonts?.display, body: brand.fonts?.body } }, pptx);
        return { slides: results, pdf, pptx, width: W, height: H };
      },

      /** A print document → one PDF with real text, page previews and a per-page fit audit. */
      document: async (input: DocumentSpec & { brandDir?: string; brand?: Partial<BrandKit>; outDir: string; name?: string }, ctx) => {
        const outDir = assertInHome(input.outDir, 'outDir');
        const { brand, assetsDir } = await brandFrom(input);
        if (!Array.isArray(input.pages) || !input.pages.length) throw new Error('pages are required');
        const sz = PAGE_SIZES[input.size ?? 'a4'] ?? PAGE_SIZES.a4;
        const names = docIconNames(input.pages);
        const icons = names.length ? await resolveIcons(names) : {};
        const html = renderDocument(input, { brand, width: sz.width, height: sz.height, assetsDir, icons });
        const base = String(input.name ?? 'document').replace(/[^\w-]/g, '_');
        await mkdir(join(outDir, 'pages'), { recursive: true });
        const htmlFile = join(outDir, `${base}.html`);
        await writeFile(htmlFile, html);
        const open = () => browser().open(pathToFileURL(htmlFile).href, { width: sz.width, height: sz.height, scale: 1.5, settleMs: 300 });
        let page = await open().catch(async () => (await browser().restart(), open()));
        try {
          await page.eval('document.fonts.ready.then(() => true)');
          const audit = await page.eval<{ page: number; overflow: number; wide: boolean; brokenImages: number; fill: number }[]>(DOC_AUDIT_SCRIPT);
          ctx.progress(0.3, 'printing the PDF');
          const pdf = join(outDir, `${base}.pdf`);
          await writeFile(pdf, await page.pdf());
          const previews: string[] = [];
          for (let i = 0; i < input.pages.length; i++) {
            ctx.progress(0.4 + (0.5 * i) / input.pages.length, `page ${i + 1}`);
            await page.eval(`(() => { document.querySelectorAll('section.pg').forEach((p, j) => p.style.display = j === ${i} ? '' : 'none'); window.scrollTo(0, 0); return true; })()`);
            const file = join(outDir, 'pages', `page-${String(i + 1).padStart(2, '0')}.png`);
            await writeFile(file, await page.screenshot('png'));
            previews.push(file);
          }
          const sheet = join(outDir, `${base}.sheet.jpg`);
          const cols = Math.min(4, previews.length);
          await run('ffmpeg', ['-y', '-v', 'error', '-pattern_type', 'glob', '-i', join(outDir, 'pages', 'page-*.png'), '-vf', `scale=360:-2,tile=${cols}x${Math.ceil(previews.length / cols)}:padding=12:margin=12:color=0xdddddd`, '-frames:v', '1', sheet]);
          const problems = audit.flatMap((a) => [
            ...(a.overflow > 2 ? [`page ${a.page} (${input.pages[a.page - 1]?.layout}) overflows by ${Math.round(a.overflow)}px — shorten the copy or split it onto another page`] : []),
            ...(a.wide ? [`page ${a.page} has a heading or table wider than the page`] : []),
            ...(a.brokenImages ? [`page ${a.page} has ${a.brokenImages} image(s) that didn't load — check the paths`] : []),
            ...(a.fill < 0.55 && input.pages.length > 1 ? [`page ${a.page} (${input.pages[a.page - 1]?.layout}) is only ${Math.round(a.fill * 100)}% full — add substance (a paragraph, an image, a chart) or merge it with a neighbouring page`] : []),
          ]);
          return { pdf, html: htmlFile, pages: previews, sheet, width: sz.width, height: sz.height, audit, problems };
        } finally {
          await page.close();
        }
      },

      /** A carousel deck → slide PNGs, one PDF, and per-slide audits. */
      deck: async (input: DeckSpec & { brandDir?: string; brand?: Partial<BrandKit>; outDir: string; pdf?: boolean; only?: number[] }, ctx) => {
        const outDir = assertInHome(input.outDir, 'outDir');
        const { brand, assetsDir } = await brandFrom(input);
        const { width, height, safe } = size(input.preset);
        if (!Array.isArray(input.slides) || !input.slides.length) throw new Error('slides are required');
        const results = [];
        const iconNames = input.slides.flatMap((s) => carouselIconNames(s.layout, s.fields ?? {}));
        const icons = iconNames.length ? await resolveIcons(iconNames) : {};
        for (let i = 0; i < input.slides.length; i++) {
          const file = join(outDir, 'slides', `slide-${String(i + 1).padStart(2, '0')}.png`);
          if (input.only && !input.only.includes(i + 1)) {
            results.push({ file, skipped: true });
            continue;
          }
          ctx.progress(i / input.slides.length, `slide ${i + 1}`);
          const s = input.slides[i];
          const rctx: RenderCtx = { brand, width, height, page: i + 1, pages: input.slides.length, assetsDir, handle: input.handle, icons };
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

      /**
       * Screenshots of a live site for videos and slides: desktop and phone
       * viewports, plus a full-page capture for the scroll scene.
       */
      capture: async ({ url, outDir, name = 'site', shots = ['desktop', 'mobile', 'full'] }: { url: string; outDir: string; name?: string; shots?: string[] }) => {
        if (!/^https?:\/\//i.test(String(url))) throw new Error('url must be http(s)');
        const dir = assertInHome(outDir, 'outDir');
        await mkdir(dir, { recursive: true });
        const safeName = String(name).replace(/[^\w-]/g, '_');
        const out: Record<string, string> = {};
        const views: Record<string, { width: number; height: number; scale?: number; mobile?: boolean }> = { desktop: { width: 1440, height: 900, scale: 1 }, mobile: { width: 390, height: 844, scale: 2, mobile: true } };
        for (const v of ['desktop', 'mobile'] as const) {
          if (!shots.includes(v) && !(v === 'desktop' && shots.includes('full'))) continue;
          const page = await browser().open(url, { ...views[v], settleMs: 600 });
          try {
            await page.eval(TIDY_PAGE_SCRIPT);
            if (shots.includes(v)) {
              out[v] = join(dir, `${safeName}-${v}.png`);
              await writeFile(out[v], await page.screenshot('png'));
            }
            if (v === 'desktop' && shots.includes('full')) {
              out.full = join(dir, `${safeName}-full.png`);
              await writeFile(out.full, await page.fullPage(9000));
            }
          } finally {
            await page.close();
          }
        }
        return out;
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
