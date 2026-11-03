import { PLACEHOLDER_NAME } from '@shipcast/engine';
import { esc, fit, img, list, logo, rich, type Layout } from './common.ts';

/**
 * Cards for the last kits: event promos, release-note cards, Pinterest pins
 * and the YouTube end-screen background. They render through the card themes
 * like every other card; each brings its own few rules.
 */

const CSS = `<style>
.ev-tk{display:grid;border-radius:28px;background:var(--card);box-shadow:0 0 0 1px color-mix(in srgb,var(--rule) 50%,transparent)}
.ev-tk>div{display:flex;flex-direction:column;gap:.35em;min-width:0}
.ev-tk small{font:700 .5em/1 var(--font-body);letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.ev-tk b{font:800 1em/1.05 var(--font-display);letter-spacing:-.03em;color:var(--fg);white-space:nowrap}
.ev-sp{display:flex;flex-wrap:wrap;gap:.7em 1.4em;font-family:var(--font-body);line-height:1.2}
.ev-sp>span{display:flex;align-items:center;gap:.55em;min-width:0}
.ev-sp i{flex:none;display:grid;place-items:center;width:2.3em;height:2.3em;border-radius:50%;background:var(--accent);color:var(--bg);font:800 .8em/1 var(--font-display);font-style:normal}
.ev-sp b{display:block;color:var(--fg)}.ev-sp small{display:block;color:var(--muted);font-size:.8em}
.ev-sp .ph b{border-bottom:2px dashed currentColor}
.rn-ver{display:inline-flex;align-items:center;gap:.5em;border-radius:999px;padding:.45em .9em;font:700 1em/1 var(--font-mono);background:var(--accent);color:var(--bg);white-space:nowrap}
.rn-date{font:600 1em/1 var(--font-body);color:var(--muted);white-space:nowrap}
.rn-list{list-style:none;display:grid;gap:.9em;counter-reset:rn}
.rn-list li{display:grid;grid-template-columns:2.2em 1fr;gap:.7em;align-items:start;counter-increment:rn;background:var(--card);border-radius:24px;padding:.8em .9em;box-shadow:0 0 0 1px color-mix(in srgb,var(--rule) 45%,transparent)}
.rn-list li::before{content:counter(rn,decimal-leading-zero);font:800 1em/1.25 var(--font-display);color:var(--accent)}
.rn-list b{display:block;font:700 1em/1.2 var(--font-display);letter-spacing:-.02em;color:var(--fg)}
.rn-list span{display:block;margin-top:.25em;font:500 .74em/1.35 var(--font-body);color:var(--muted)}
.pin-mark{display:flex;align-items:center;gap:16px}.pin-mark .logo{height:64px;max-width:300px}.pin-mark .wordmark{font-size:52px}
.es-guide{position:absolute;border:4px dashed color-mix(in srgb,var(--fg) 55%,transparent);border-radius:18px;display:grid;place-items:center;font:700 30px/1 var(--font-body);color:color-mix(in srgb,var(--fg) 70%,transparent);background:color-mix(in srgb,var(--fg) 6%,transparent)}
.es-guide.round{border-radius:50%}
</style>`;

const pair = (s: string) => s.split('|').map((x) => x.trim());
const initials = (name: string) => name.replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

function speakers(v: unknown): string {
  return `<div class="ev-sp">${list(v)
    .slice(0, 4)
    .map((x) => {
      const [n, r] = pair(x);
      // Speakers the brief doesn't name are marked placeholders: a dashed underline and no initials.
      const ph = PLACEHOLDER_NAME.test(n.trim());
      return `<span class="${ph ? 'ph' : ''}"><i>${ph ? '?' : esc(initials(n))}</i><span><b>${esc(n)}</b>${r ? `<small>${esc(r)}</small>` : ''}</span></span>`;
    })
    .join('')}</div>`;
}

/** Motif + glow that bleeds to every edge; carries no text, so safe areas don't apply to it. */
const ground = (cx: number, cy: number, w: number, h: number) =>
  `<div style="position:absolute;inset:0;background-image:radial-gradient(color-mix(in srgb,var(--fg) 14%,transparent) 1.5px,transparent 2.5px);background-size:44px 44px;opacity:.7"></div><div style="position:absolute;inset:0;background:radial-gradient(${w}px ${h}px at ${cx}px ${cy}px,color-mix(in srgb,var(--accent) 24%,transparent),transparent 70%)"></div>`;

export const KIT_CARDS: Layout[] = [
  {
    id: 'event-promo',
    label: 'Event / webinar promo post',
    use: 'Promo post for a webinar or event at instagram-post (1080×1080), linkedin-image (1080×1350) and linkedin-landscape (1200×627): kicker, the title, a ticket with date, time and timezone, up to 4 speakers ("Name | Role"), the register CTA and URL. Date, time and timezone are copied character for character from out/event.json.',
    fields: [
      { id: 'kicker', type: 'text', label: 'Kicker', max: 28, optional: true, help: 'e.g. "Live webinar"' },
      { id: 'title', type: 'text', label: 'Event title (≤ 9 words)', max: 64, help: '*word* = accent' },
      { id: 'date', type: 'text', label: 'Date (as in event.json)', max: 24 },
      { id: 'time', type: 'text', label: 'Time (as in event.json)', max: 16 },
      { id: 'timezone', type: 'text', label: 'Timezone (as in event.json)', max: 12 },
      { id: 'speakers', type: 'list', label: 'Speakers: "Name | Role" (names from the brief, else a labelled placeholder)', max: 4, optional: true },
      { id: 'cta', type: 'text', label: 'CTA', max: 24, help: 'e.g. "Save your seat"' },
      { id: 'url', type: 'text', label: 'Registration URL (short form)', max: 44 },
    ],
    html: (f, ctx) => {
      const land = ctx.width / ctx.height > 1.4;
      const tall = ctx.height / ctx.width > 1.2;
      const pad = Math.round(ctx.width * (land ? 0.055 : 0.08));
      const u = land ? 0.62 : tall ? 1.08 : 1;
      const t = Math.round(fit(f.title, land ? [[28, 64], [44, 54], [64, 46]] : [[28, 108], [44, 92], [64, 78]], land ? 42 : 70));
      const tk = `<div class="ev-tk" style="grid-template-columns:${land ? '1fr' : 'auto auto'};gap:${Math.round(18 * u)}px ${Math.round(44 * u)}px;padding:${Math.round(30 * u)}px ${Math.round(36 * u)}px;font-size:${Math.round(50 * u)}px;justify-content:start"><div><small>Date</small><b>${esc(f.date)}</b></div><div><small>Time</small><b>${esc(f.time)} ${esc(f.timezone)}</b></div></div>`;
      const sp = list(f.speakers).length ? `<div style="font-size:${Math.round(28 * u)}px">${speakers(f.speakers)}</div>` : '';
      const foot = `<div class="ft"><span class="pill" style="font-size:${Math.round(30 * u)}px;padding:${Math.round(20 * u)}px ${Math.round(30 * u)}px">${esc(f.cta)} →</span><span class="url" style="font-size:${Math.round(26 * u)}px">${esc(f.url)}</span></div>`;
      const head = `<div class="hd">${logo(ctx)}${f.kicker ? `<span class="kick">${esc(f.kicker)}</span>` : ''}</div>`;
      const h1 = `<h1 data-fit-lines="${land ? 3 : 4}" data-min-font="${Math.round(t * 0.7)}" style="font-size:${t}px">${rich(f.title)}</h1>`;
      if (land) return `${CSS}<div class="c" style="padding:${pad}px;gap:${pad}px;--k:22px"><div style="flex:1.25;min-width:0;display:flex;flex-direction:column;justify-content:space-between;gap:20px">${head}${h1}${sp}</div><div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:26px">${tk}${foot}</div></div>`;
      return `${CSS}<div class="c" style="flex-direction:column;justify-content:space-between;padding:${pad}px;gap:${Math.round(34 * u)}px;--k:${Math.round(28 * u)}px">${head}${h1}${tk}${sp}${foot}</div>`;
    },
  },
  {
    id: 'whats-new',
    label: '"What\'s new" feature card',
    use: 'One headline feature of a release at linkedin-landscape (1200×627) and linkedin-image (1080×1350): version chip, date, the benefit as the headline, one supporting line and a real screenshot cropped to the new thing. Make both sizes for every headline feature, with identical version and date.',
    fields: [
      { id: 'version', type: 'text', label: 'Version ("v2.4")', max: 16 },
      { id: 'date', type: 'text', label: 'Release date', max: 20 },
      { id: 'title', type: 'text', label: 'Headline: the benefit (≤ 8 words)', max: 56, help: '*word* = accent' },
      { id: 'sub', type: 'text', label: 'Supporting line', max: 100, optional: true },
      { id: 'image', type: 'image', label: 'Real screenshot of the feature (crop with #crop=x,y,w,h)' },
      { id: 'kicker', type: 'text', label: 'Kicker', max: 20, optional: true, help: 'default "What\'s new"' },
    ],
    html: (f, ctx) => {
      const land = ctx.width / ctx.height > 1.4;
      const pad = Math.round(ctx.width * (land ? 0.05 : 0.075));
      const t = Math.round(fit(f.title, land ? [[24, 58], [40, 50], [56, 44]] : [[24, 96], [40, 82], [56, 70]], land ? 40 : 64));
      const meta = `<div class="hd" style="justify-content:flex-start;gap:${land ? 16 : 22}px;font-size:${land ? 20 : 28}px"><span class="rn-ver">${esc(f.kicker || "What's new")} · ${esc(f.version)}</span><span class="rn-date">${esc(f.date)}</span></div>`;
      const h1 = `<h1 data-fit-lines="3" data-min-font="${Math.round(t * 0.72)}" style="font-size:${t}px">${rich(f.title)}</h1>`;
      const sub = f.sub ? `<p style="font-size:${land ? 22 : 32}px;line-height:1.35">${rich(f.sub)}</p>` : '';
      const shot = `<div class="frame" style="${land ? 'flex:1.25;min-width:0;align-self:stretch;margin:-6px -' + Math.round(pad * 1.4) + 'px -' + Math.round(pad * 1.2) + 'px 0' : 'flex:1;min-height:0;margin:0 0 -' + Math.round(pad * 1.1) + 'px'}"><div class="bar"><i></i><i></i><i></i></div><img src="${img(f.image, ctx)}"></div>`;
      if (land) return `${CSS}<div class="c" style="padding:${pad}px;gap:${pad}px"><div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:space-between;align-items:flex-start;gap:18px">${logo(ctx)}<div style="display:flex;flex-direction:column;gap:18px">${meta}${h1}${sub}</div></div>${shot}</div>`;
      return `${CSS}<div class="c" style="flex-direction:column;padding:${pad}px ${pad}px 0;gap:30px"><div class="hd">${logo(ctx)}</div>${meta}${h1}${sub}${shot}</div>`;
    },
  },
  {
    id: 'release-summary',
    label: 'Release summary card',
    use: 'Every change of a release on one card (linkedin-image, 1080×1350): version, date, a headline and 2–5 items ("Title — one line"). More than 5 items do not fit — pick the 5 that matter to users.',
    fields: [
      { id: 'version', type: 'text', label: 'Version', max: 16 },
      { id: 'date', type: 'text', label: 'Release date', max: 20 },
      { id: 'title', type: 'text', label: 'Headline', max: 48, help: 'e.g. "What\'s new in *2.4*"' },
      { id: 'items', type: 'list', label: 'Items: "Title — one line" (2–5)', max: 5 },
      { id: 'url', type: 'text', label: 'Changelog URL (short form)', max: 44, optional: true },
    ],
    html: (f, ctx) => {
      const pad = Math.round(ctx.width * 0.075);
      const items = list(f.items).slice(0, 5);
      const k = items.length;
      const fs = k <= 3 ? 40 : k === 4 ? 36 : 32;
      return `${CSS}<div class="c" style="flex-direction:column;justify-content:space-between;padding:${pad}px;gap:34px">
<div class="hd">${logo(ctx)}<span class="rn-date" style="font-size:28px">${esc(f.date)}</span></div>
<div style="display:flex;flex-direction:column;gap:22px"><span style="font-size:28px"><span class="rn-ver">${esc(f.version)}</span></span><h1 data-fit-lines="2" data-min-font="64" style="font-size:${fit(f.title, [[24, 92], [36, 80], [48, 70]], 64)}px">${rich(f.title)}</h1></div>
<ol class="rn-list" style="font-size:${fs}px">${items.map((it) => { const [a, ...b] = it.split(/\s+[—–-]\s+/); return `<li><div><b>${rich(a)}</b>${b.length ? `<span>${rich(b.join(' — '))}</span>` : ''}</div></li>`; }).join('')}</ol>
${f.url ? `<div class="ft"><span class="url" style="font-size:28px">${esc(f.url)}</span></div>` : ''}</div>`;
    },
  },
  {
    id: 'pin',
    label: 'Pinterest standard pin',
    use: 'A 1000×1500 pin (preset pinterest-pin): a bold title that still reads at the 236 px the grid shows it, an optional line, the brand mark, and an optional real screenshot or photo below. No URL or link text on the image — the pin carries the link.',
    fields: [
      { id: 'kicker', type: 'text', label: 'Kicker', max: 28, optional: true, help: 'e.g. "Guide", "Checklist"' },
      { id: 'title', type: 'text', label: 'Title overlay (≤ 8 words)', max: 60, help: '*word* = accent' },
      { id: 'sub', type: 'text', label: 'Supporting line (≤ 12 words)', max: 80, optional: true },
      { id: 'image', type: 'image', label: 'Screenshot or photo (crop with #crop=x,y,w,h)', optional: true },
    ],
    html: (f, ctx) => {
      const s = ctx.safe ?? { top: 80, right: 64, bottom: 110, left: 64 };
      const shot = !!f.image;
      const t = Math.round(fit(f.title, shot ? [[20, 124], [36, 108], [60, 92]] : [[20, 150], [36, 128], [60, 108]], shot ? 84 : 100));
      const top = `<div style="display:flex;flex-direction:column;gap:30px">${f.kicker ? `<span class="kick" style="--k:34px">${esc(f.kicker)}</span>` : ''}<h1 data-fit-lines="${shot ? 4 : 5}" data-min-font="64" style="font-size:${t}px;line-height:.98">${rich(f.title)}</h1>${f.sub ? `<p data-min-font="40" style="font-size:44px;line-height:1.25">${rich(f.sub)}</p>` : ''}</div>`;
      const pic = shot ? `<div class="frame" style="flex:1;min-height:0;margin:0 -${s.right + 40}px 0 0"><div class="bar"><i></i><i></i><i></i></div><img src="${img(f.image, ctx)}"></div>` : '';
      return `${CSS}${ground(ctx.width * 0.8, ctx.height * 0.2, ctx.width * 1.2, ctx.height * 0.7)}<div class="c" style="flex-direction:column;justify-content:${shot ? 'flex-start' : 'center'};padding:${s.top + 20}px ${s.right + 16}px ${s.bottom + 20}px ${s.left + 16}px;gap:56px">${top}${pic}<div class="pin-mark" style="${shot ? '' : 'position:absolute;left:' + (s.left + 16) + 'px;bottom:' + (s.bottom + 20) + 'px'}">${logo(ctx)}</div></div>`;
    },
  },
  {
    id: 'end-screen',
    label: 'YouTube end-screen background',
    use: 'The 1920×1080 background for a video\'s last 5–20 seconds (preset youtube-endscreen): brand mark, a short "watch next" line and an optional sub, all in the left column. The right side stays empty for the two video elements and the subscribe button you add in the editor. No platform logos or fake buttons. `guides: "yes"` renders a preview with the element zones outlined (never upload that one).',
    fields: [
      { id: 'kicker', type: 'text', label: 'Kicker', max: 28, optional: true, help: 'e.g. "Thanks for watching"' },
      { id: 'title', type: 'text', label: 'Line (≤ 7 words)', max: 48, help: 'e.g. "Watch *these* next"' },
      { id: 'sub', type: 'text', label: 'Supporting line', max: 80, optional: true },
      { id: 'guides', type: 'enum', label: 'Zone outlines (preview only)', choices: ['no', 'yes'], optional: true },
    ],
    html: (f, ctx) => {
      const s = ctx.safe ?? { top: 54, right: 96, bottom: 54, left: 96 };
      const zones = s.avoid ?? [];
      const right = Math.min(ctx.width - s.right, ...zones.map((z) => z.x)) - 48;
      const w = right - s.left;
      const t = Math.round(fit(f.title, [[16, 120], [30, 100], [48, 84]], 76));
      const guides = /^(yes|true)$/i.test(String(f.guides ?? ''))
        ? zones.map((z) => `<div class="es-guide${/subscribe/.test(z.what) ? ' round' : ''}" data-safe-ignore style="left:${z.x}px;top:${z.y}px;width:${z.w}px;height:${z.h}px">${/subscribe/.test(z.what) ? 'Subscribe' : 'Video'}</div>`).join('')
        : '';
      return `${CSS}${ground(s.left + w * 0.4, ctx.height * 0.5, w * 1.6, ctx.height * 1.2)}<div class="c" style="left:${s.left}px;top:${s.top}px;width:${w}px;height:${ctx.height - s.top - s.bottom}px;flex-direction:column;justify-content:center;gap:40px">
<div class="pin-mark">${logo(ctx)}</div>${f.kicker ? `<span class="kick" style="--k:36px">${esc(f.kicker)}</span>` : ''}<h1 data-fit-lines="3" data-min-font="64" style="font-size:${t}px">${rich(f.title)}</h1>${f.sub ? `<p data-min-font="34" style="font-size:40px;line-height:1.3;max-width:20ch">${rich(f.sub)}</p>` : ''}</div>${guides}`;
    },
  },
];
