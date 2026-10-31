---
name: thumbnails
description: Art-direct a set of still graphics as a Shipcast graphics spec (graphics.json) — three YouTube thumbnail variants for Test & Compare, link-preview card, GitHub social preview, X/LinkedIn post images, stories and banners — rendered by the Shipcast stills service. Use when someone asks for thumbnails, social cards, OG images, banners or static post graphics.
---

# Thumbnails & social graphics (graphics spec)

Stills are judged in under a second at small sizes. Your job: the hook words,
the picture choice, and which layout carries each idea. The stills service
owns type, contrast, safe zones and export.

Read `./catalog.md` first (layouts, fields, presets). Never invent a layout.

## Output

`out/graphics.json`:

```json
{
  "items": [
    { "type": "thumbnail", "layout": "headline-shot", "preset": "youtube-thumbnail", "name": "youtube-a.jpg", "fields": { "headline": "Ship in *one* paste", "image": "assets/hero.png", "focus": "center" } },
    { "type": "thumbnail", "layout": "big-number", "preset": "youtube-thumbnail", "name": "youtube-b.jpg", "fields": { "value": "10×", "headline": "faster launches" } },
    { "type": "thumbnail", "layout": "versus", "preset": "youtube-thumbnail", "name": "youtube-c.jpg", "fields": { "left": "2 days", "right": "1 paste", "badge": "VS" } },
    { "type": "card", "layout": "link-card", "theme": "midnight", "preset": "og-card", "name": "og-card.png", "fields": { "title": "…", "subtitle": "…", "image": "assets/hero.png" } }
  ]
}
```

Don't render anything yourself — the worker renders it, checks overflow and
safe zones, and sends problems back.

## Rules

- **YouTube: three variants** (A/B/C) with *different* hooks and layouts — YouTube Test & Compare picks the winner by watch time.
- 2–4 words per thumbnail headline. Complement the video title, don't repeat it. Must read at 160 px wide.
- One focal subject; real product imagery from `assets/` (look at the images, pick the strongest).
- Nothing important bottom-right on thumbnails (the duration badge sits there).
- Cards: the brand's one-liner, real screenshot, 0–3 short chips (license, "open source", a real number).
- Which set to make comes from the prompt (`set`): `youtube` = 3 thumbnails; `social` = og-card + x-image + linkedin-image + story-image; `github` = github-banner + og-card; `all` = everything plus x-header and linkedin-banner.
- Real claims only.

Finish with `out/NOTES.md`: alt text for each image and which thumbnail you'd bet on.
