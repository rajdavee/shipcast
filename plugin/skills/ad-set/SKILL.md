---
name: ad-set
description: Write a static ad set — one concept, 3–10 hook variants, every placement size (Meta feed and Stories, LinkedIn, X, Google Display banners) — as a Shipcast ads spec (ads.json) that the stills service renders into upload-ready PNGs plus an ads.csv with primary text, headlines and descriptions. Use when someone asks for ads, ad creatives, banner ads, display ads, Meta/LinkedIn ads or A/B variants.
---

# Ad set (ads spec)

An ad has under two seconds. One concept, many hooks: the platform's delivery
finds the winner, so give it real variety — not the same line reworded.

Read `./catalog.md` first: sizes, themes and fields. Never invent a size or field.

## Output

1. `out/ads.json` — `{ theme, image, imageStyle, cta, url, offer?, sizes?, disclosure?, variants: [...] }`.
2. `out/NOTES.md` — the concept, the audience and the testing plan: which variants test which idea, and what result would make you kill or scale each.

Don't render anything yourself — the worker renders every variant at every size, checks overflow and story safe zones, and sends problems back.

## Variants (3–10)

Each variant tests a different *reason to care*, named by its angle:

- `pain` — the problem in the customer's words ("Still chasing invoices by email?")
- `outcome` — the result, specific ("Payments land 2 days sooner")
- `stat` — one verified number as the hook
- `before-after` — the old way vs the new way in one line
- `objection` — answer the reason they'd say no ("No setup. No migration.")
- `social-proof` — only real, attributable proof from the brief
- `curiosity` — an open loop that the product closes (never clickbait)
- `offer` — the trial, discount or deadline, if one really exists

Rules:
- `headline` ≤ 8 words and must work alone — on a 320×50 banner it's the only text. Wrap the one word that matters in `*stars*`.
- `sub` ≤ 14 words, adds the "how" or the proof.
- `primary` (Meta/LinkedIn text above the image) ≤ 125 characters, says something the image doesn't. `description` ≤ 30 characters.
- One `cta` for the whole set, a verb with an object ("Book a demo", "Start free").
- Follow the brand voice section of the prompt exactly; banned words and forbidden claims will be flagged.
- Use a real product screenshot from `assets/` with `imageStyle: "shot"`; use `"cover"` only for a real photo.
- If the visual shows an AI-generated person or scene, set `disclosure` (e.g. "AI-generated image").
- Theme: `brand` for awareness and feeds, `dark` for developer/tech audiences, `light` for conservative B2B and display networks.
- Screenshots: crop to the part that matters with `#crop=x,y,w,h` on the image path (fractions of the image). Readable UI beats a whole screen; never leave a slide or page as a wall of text when a cropped screen or chart can carry the point.
