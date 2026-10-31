import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { brandCss, loadBrand, localizeFonts, normalizeBrand, presetForSize, probe, VERTICAL_SAFE, type BrandKit } from '@shipcast/engine';
import { buildCaptions, CAPTION_STYLES, type CaptionStyle, type Word } from './captions.ts';
import { esc } from './scenes.ts';

/**
 * Captions for your own footage: the source video plays untouched, word-timed
 * captions in a chosen style ride on top, and an optional hook title holds
 * for the first seconds. Compiled into a HyperFrames project like storyboards.
 */
export async function compileCaptionVideo(opts: {
  dir: string;
  video: string;
  words: Word[];
  style: CaptionStyle;
  hook?: string;
  brandDir?: string;
  brand?: Partial<BrandKit>;
}): Promise<{ dir: string; duration: number; width: number; height: number }> {
  if (!(opts.style in CAPTION_STYLES)) throw new Error(`style must be one of ${Object.keys(CAPTION_STYLES).join(', ')}`);
  const p = await probe(opts.video);
  if (!p.video) throw new Error('the upload has no video stream');
  // Rotation-free even dimensions; HyperFrames renders at the composition size.
  const width = p.video.width - (p.video.width % 2);
  const height = p.video.height - (p.video.height % 2);
  const duration = Math.round(p.duration * 100) / 100;
  const vertical = height > width * 1.2;
  const safe = presetForSize(width, height)?.safe ?? (vertical ? VERTICAL_SAFE : { top: 54, right: 96, bottom: 54, left: 96 });
  const brand = opts.brandDir ? await loadBrand(opts.brandDir) : normalizeBrand(opts.brand);
  const dir = opts.dir;
  await mkdir(join(dir, 'compositions'), { recursive: true });
  await mkdir(join(dir, 'assets'), { recursive: true });
  const src = `assets/source${extname(opts.video).toLowerCase() || '.mp4'}`;
  await copyFile(opts.video, join(dir, src));
  const fonts = await localizeFonts([brand.fonts.display, brand.fonts.body], join(dir, 'assets', 'fonts'), 'assets/fonts');
  const b: BrandKit = { ...brand, fonts: { ...brand.fonts, display: fonts.families.includes(brand.fonts.display) ? brand.fonts.display : 'system-ui', body: fonts.families.includes(brand.fonts.body) ? brand.fonts.body : 'system-ui' } };

  const cap = buildCaptions(opts.words, opts.style, { id: 'captions', width, height, safe, brand: b });
  await writeFile(
    join(dir, 'compositions', 'captions.html'),
    `<!doctype html><html><head><meta charset="UTF-8"></head><body><template><style>${cap.css}</style><div id="captions" data-composition-id="captions" data-width="${width}" data-height="${height}">${cap.markup}</div><script>(()=>{const tl=gsap.timeline({paused:true});\n${cap.js}\nwindow.__timelines["captions"]=tl;})();</script></template></body></html>`,
  );

  const u = Math.min(width, height) / 1080;
  const hook = opts.hook?.trim();
  const hookHold = Math.min(3.2, duration);
  await writeFile(
    join(dir, 'index.html'),
    `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=${width}, height=${height}">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>${fonts.css}${brandCss(b)}
html,body{margin:0;background:#000}#main{position:relative;width:100%;height:100%;overflow:hidden}
#src{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
#hook{position:absolute;left:${Math.max(safe.left, 60 * u)}px;right:${Math.max(safe.right, 60 * u)}px;top:${Math.max(safe.top, 60 * u)}px;text-align:center;z-index:5}
#hook span{display:inline;font:800 ${Math.round((vertical ? 64 : 52) * u)}px/1.15 var(--font-display);letter-spacing:-.02em;color:#111;background:#fff;padding:${Math.round(6 * u)}px ${Math.round(16 * u)}px;border-radius:${Math.round(12 * u)}px;-webkit-box-decoration-break:clone;box-decoration-break:clone}
</style></head><body>
<div id="main" data-composition-id="main" data-start="0" data-width="${width}" data-height="${height}" data-duration="${duration}">
<video id="src" src="${src}" playsinline data-has-audio="true" data-start="0" data-duration="${duration}" data-track-index="0" data-volume="1"></video>
<div id="host-captions" data-composition-id="captions" data-composition-src="compositions/captions.html" data-start="0" data-duration="${duration}" data-track-index="5" data-track-kind="captions" data-width="${width}" data-height="${height}"></div>
${hook ? `<div id="hook"><span>${esc(hook)}</span></div>` : ''}
</div>
<script>(()=>{const tl=gsap.timeline({paused:true});
${hook ? `tl.fromTo("#hook",{y:${-30 * u},opacity:0},{y:0,opacity:1,duration:.5,ease:"back.out(1.6)"},.15);tl.fromTo("#hook",{opacity:1},{opacity:0,duration:.35,immediateRender:false},${(hookHold - 0.35).toFixed(2)});` : ''}
window.__timelines["main"]=tl;})();</script>
</body></html>`,
  );
  await writeFile(join(dir, 'hyperframes.json'), JSON.stringify({ $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json', registry: 'https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry', paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' }, media: { autoProxy: true }, registryItems: [] }, null, 2));
  await writeFile(join(dir, 'meta.json'), JSON.stringify({ id: 'captions', name: 'captions', createdAt: new Date().toISOString() }));
  return { dir, duration, width, height };
}
