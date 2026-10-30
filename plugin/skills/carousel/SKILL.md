---
name: carousel
description: Design a scroll-stopping LinkedIn / Instagram carousel (document post) from a campaign brief — 6–10 slides as PNGs, a ready-to-upload PDF, an optional animated MP4 version, and the post caption. Use when someone asks for a carousel, a LinkedIn document post, swipe slides, or an Instagram slideshow about a product.
---

# Carousel

A carousel is a tiny magazine: one idea per slide, a cover that makes people
swipe, and a last slide that tells them what to do. Design it like an editorial
designer, not like a slide deck.

## Inputs

- The campaign brief (`brief.md`, `brand.json`, `assets/`) — path is in the prompt.
- Options from the prompt: `platform` (linkedin 1080×1350 · instagram 1080×1350 ·
  square 1080×1080), `slides` (count), `angle`, `motion` (whether to also render
  an MP4).

## 1. Story first

Pick one angle (the prompt may set it). Strong carousel angles:

| Angle | Shape |
|---|---|
| `problem-solution` | Pain → why it persists → the product's move → proof → CTA |
| `how-it-works` | Cover → 3–5 steps, each showing the real UI → result → CTA |
| `listicle` | "N things…" — one per slide, numbered big |
| `before-after` | Split slides: old way vs. new way |
| `myth-buster` | "Myth:" / "Reality:" pairs |
| `launch` | What's new → the 3 best bits → who it's for → CTA |

Write `work/outline.md` first: per slide, the headline (≤ 8 words), one
supporting line (≤ 18 words), and the visual. Read it back as a stranger would.
The cover must work alone in the feed: a specific promise or tension, never
"Introducing X".

## 2. Design system

Build from `brand.json`: its colors, display + body fonts (load from Google
Fonts with a `<link>` when they're Google fonts; otherwise use the fallback),
logo. Then make it feel *designed*:

- A strict grid: 96px outer margins, 12-column, baseline rhythm of 8px.
- Huge display type for headlines (96–150px on the cover, 64–88px inside),
  tight tracking (-0.02em to -0.04em), body 32–38px. Never below 28px.
- One accent color used sparingly for emphasis words and numbers.
- A recurring device that ties slides together: slide counter `03/08`, a
  progress bar, a continuous line or shape that flows across slide edges, or a
  big ghost number.
- Real product imagery: crop screenshots from `assets/` into device frames or
  rounded panels with soft shadows; zoom into the one detail that matters.
- Texture over flatness: subtle grain (SVG noise), gradient meshes, glass
  panels, or a grid pattern — pick one, use it consistently.
- Last slide: CTA (from `brand.json.cta`), logo, handle/URL, "Save this ↗" or
  "Repost ♻︎" nudge.

## 3. Build

Write one self-contained HTML file per slide into `work/slides/`
(`slide-01.html` … ), each exactly the slide size with `html,body{margin:0}`,
plus `work/carousel.html` that stacks all slides with
`@page { size: <w>px <h>px; margin: 0 }` and `page-break-after: always`.
Reference assets with absolute `file://` paths or copy them into `work/`.

Render:

```bash
SNAP="<this skill's base dir>/../../scripts/snap.mjs"
node "$SNAP" --size 1080x1350 --outdir out/slides work/slides/*.html
node "$SNAP" --size 1080x1350 --pdf out/carousel.pdf work/carousel.html
```

Then **look at every PNG** (read the image files). Fix overflow, widows,
collisions, low contrast (WCAG AA for body text), anything smaller than 28px,
and anything that looks like a template. Re-render until each slide is
postable on its own.

## 4. Motion version (when `motion` is `yes`)

Make `out/carousel.mp4` (same size, ~2.5s per slide, 30fps) with ffmpeg:
a gentle push-in on each slide plus a quick slide/wipe between them, and a
soft music bed only if one is available locally (otherwise silent). Example
building block:

```bash
ffmpeg -loop 1 -t 2.6 -i out/slides/slide-01.png -vf "zoompan=z='min(zoom+0.0006,1.04)':d=78:s=1080x1350:fps=30" -pix_fmt yuv420p work/s01.mp4
# … then xfade=transition=slideleft:duration=0.35 between clips
```

## 5. Caption

Write `out/caption.md`: the LinkedIn post that goes with the carousel — a
2-line hook that isn't the cover repeated, 3–6 short lines of value, a soft
CTA, 3–5 relevant hashtags. Plain text, no emoji walls, no "excited to share".

## Deliverables

```
out/slides/slide-01.png … slide-NN.png
out/carousel.pdf            upload this as a LinkedIn document
out/carousel.mp4            (motion: yes)
out/caption.md
out/NOTES.md
```
