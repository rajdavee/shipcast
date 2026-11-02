---
name: app-store-screens
description: Make an App Store / Google Play screenshot set as a Shipcast graphics spec (graphics.json) — 5–8 screens per store, each a short benefit caption above a real product screenshot in a neutral CSS phone frame, rendered at 1290×2796 (iOS 6.9″) and 1080×1920 (Play) by the Shipcast stills service, plus store listing copy. Use when someone asks for app store screenshots, Play Store graphics or store listing images.
---

# App store screenshots (graphics spec)

Most people decide from the first two or three screenshots in search results,
seen at a fraction of their size, without reading the description. Each screen
sells one benefit: a caption you can read at thumbnail size over the real
screen that proves it.

Read `./catalog.md` first (layouts, fields, presets). Use the `app-screen` layout.

## Output

1. `out/graphics.json` — one item per screen per store, same order and captions in both sets:

```json
{
  "items": [
    { "type": "card", "layout": "app-screen", "theme": "midnight", "preset": "app-store-ios", "name": "ios/01-track.png", "fields": { "headline": "Every invoice, *tracked*", "sub": "See who paid and who's late", "image": "assets/app/dashboard-mobile.png" } },
    { "type": "card", "layout": "app-screen", "theme": "midnight", "preset": "play-store", "name": "android/01-track.png", "fields": { "headline": "Every invoice, *tracked*", "sub": "See who paid and who's late", "image": "assets/app/dashboard-mobile.png" } }
  ]
}
```

Names: `ios/NN-<slug>.png` and `android/NN-<slug>.png`, numbered in upload order.

2. `out/store-copy.md` — **App Store**: name (≤ 30 chars), subtitle (≤ 30), promotional text (≤ 170), keywords (≤ 100 chars, comma-separated, no spaces after commas, no words already in the name); **Google Play**: title (≤ 30), short description (≤ 80), full description (≤ 4000, plain text, the benefits in the screenshot order). Real features and claims only.

Don't render anything yourself — the worker renders it, checks overflow, safe margins, captions that had to shrink, screenshots shrunk past readability and images that didn't load, and sends problems back.

## Rules

- **5–8 screens per store.** Screen 1 = the core promise with the most recognisable screen; screens 2–3 = the next two reasons to install (they show in search); then features, then trust (privacy, offline, sync — only if real).
- **Captions: ≤ 5 words, ≤ 32 characters, a benefit not a feature name** ("Get paid 2 days sooner", not "Invoice module"). Wrap one word in `*stars*`. The template sets the caption at 7–11% of the canvas width (≈ 90–140 px on iOS, 75–120 px on Play) on at most 2 lines; one that has to shrink below 6% comes back to you — shorten it. `sub` is optional, ≤ 8 words.
- **Real screens only, readable UI.** Use phone captures from `assets/` (`*-mobile.png`, `assets/app/…`) first. With only desktop captures, crop a tall region with `#crop=x,y,w,h` (about 1 wide : 2 high in pixels) around the part the caption talks about — the phone shows the crop's full width and cuts the bottom. UI text must stay readable; a full desktop page squeezed into a phone fails the readability check.
- **Never mock UI that doesn't exist**, never put sample data that looks like real customers' data, never show prices or ratings you can't verify.
- **No Apple or Google artwork:** the phone frame is generic CSS; no device names, store badges, "Download on the…" marks, or platform logos in captions or images.
- `frame`: leave `auto` (iOS shows the whole phone, Play lets it run off the bottom for a bigger screen). Use `bleed` on iOS when the screen's top half carries the point.
- One theme for the whole set so it reads as a sequence in the store; `midnight` or `editorial` for most apps, `swiss` for sober B2B, `bold` for consumer apps with a strong colour.
- Stores reject transparency: the PNGs are flat RGB. 1290×2796 goes in the iPhone 6.9″ slot; Play needs at least 4 phone screenshots of 1080 px or more to be eligible for featuring.

Finish with `out/NOTES.md`: the order and the reason for each screen, which screenshot each one uses, and any screen you couldn't make for lack of a real capture.
