---
name: thumbnails
description: Design a set of click-worthy still graphics from a campaign brief — YouTube thumbnail, Open Graph / link-preview card, X and LinkedIn post images, and a 9:16 story card — as PNGs rendered from HTML. Use when someone asks for thumbnails, social cards, OG images, banners or static post graphics for a product.
---

# Thumbnails & social cards

Stills are judged in under a second at small sizes. One idea per image, one
focal point, contrast that survives a phone screen in sunlight.

## Sizes

| File | Size | Use |
|---|---|---|
| `youtube-thumb.png` | 1280×720 | YouTube video thumbnail |
| `og-card.png` | 1200×630 | Link preview (site, GitHub social preview, Slack) |
| `x-post.png` | 1600×900 | X / Twitter image post |
| `linkedin-post.png` | 1200×1500 | LinkedIn single-image post |
| `story.png` | 1080×1920 | Instagram / LinkedIn story, YouTube community |
| `github-banner.png` | 1280×640 | README header |

The prompt says which set to make (`set`: all · youtube · social · github).

## Direction

Use `brand.json` colors, fonts and logo and `assets/` screenshots.

- **YouTube:** 3–5 word headline max, 110–160px, heavy weight, high-contrast
  stroke or shadow; the product UI zoomed into one striking detail; a strong
  diagonal or circle/arrow pointing at it. Test legibility by viewing it at
  320×180 — if it fails, cut words.
- **OG / GitHub:** calmer — logo, product name, the one-liner, a cropped real
  screenshot in a device or browser frame, brand background with subtle grain
  or grid. Safe zone: keep text 80px from every edge.
- **Posts / story:** hook headline from the brief + supporting visual; story
  keeps text inside the middle 1080×1420 (UI overlays cover the top and bottom).
- Make the set feel like one family: same grid, type, accent device.

Make 2 headline variants for the YouTube thumbnail (`youtube-thumb.png`,
`youtube-thumb-b.png`) so the user can A/B test.

## Build

One HTML file per image in `work/` sized exactly to its canvas, then:

```bash
SNAP="<this skill's base dir>/../../scripts/snap.mjs"
node "$SNAP" --size 1280x720 --out out/youtube-thumb.png work/youtube-thumb.html
```

Read every PNG back and fix collisions, cut-off text, low contrast and
anything that looks like a stock template. Write `out/NOTES.md` with the
alt text for each image.
