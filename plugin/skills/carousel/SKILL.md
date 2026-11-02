---
name: carousel
description: Write a scroll-stopping LinkedIn / Instagram carousel as a Shipcast deck spec (deck.json) — angle, slide-by-slide copy and layout choices — that the Shipcast stills service renders into PNG slides and an upload-ready PDF, plus the post caption. Use when someone asks for a carousel, LinkedIn document post, or swipe slides about a product.
---

# Carousel (deck spec)

A carousel is a tiny magazine: one idea per slide, a cover that makes people
swipe, a last slide that tells them what to do. You write the words and pick
layouts; the stills service owns typography, grids, themes and export.

Read `./catalog.md` first: it lists every theme, layout and field (with
character limits). Never invent a layout or field.

## Output

1. `out/deck.json`:

```json
{
  "theme": "editorial",
  "preset": "linkedin-carousel",
  "handle": "@acme",
  "slides": [
    { "layout": "cover", "fields": { "kicker": "For B2B founders", "title": "Your demo video is *losing* deals", "subtitle": "5 fixes that took ours from 2% to 9% reply rate" } },
    { "layout": "points", "fields": { "title": "The 3-step fix", "items": ["Hook first — the result in the first 2 seconds", "Real UI — no stock footage", "One CTA — and say it out loud"] } },
    { "layout": "cta", "fields": { "title": "Steal this playbook", "button": "Try Acme free", "url": "acme.com" } }
  ]
}
```

2. `out/caption.md` — the LinkedIn post that goes with it: a 2-line hook that isn't the cover repeated (≤ 210 characters before "…see more"), 3–6 short lines of value, a soft CTA, 3–5 hashtags.

Don't render anything yourself — the worker renders `deck.json`, checks every slide for overflow and tiny text, and sends problems back to you.

## Story

Pick one angle (the prompt may set it): `problem-solution`, `how-it-works`, `listicle`, `before-after`, `myth-buster`, `launch`. Then:

- **6–10 slides.** Slide 1 `cover`; last slide `cta`.
- **Cover** = a specific promise, number or tension. Never "Introducing X".
- **Slide 2** = stakes — a `statement`, or a `note` (a hand-written sticky with what your customer is really thinking) for a human pattern break.
- **Make it visual, not a wall of text.** At least two slides should carry something other than type: `platforms` (real logos of the tools/places your audience uses, grouped), `journey` (3–4 stage pills with real logos), a `step`/`image` with a real screenshot, or a `stat`.
- **Middle** = the framework: `journey`, `platforms`, `points`, `step` (with a real screenshot from `assets/` when it helps), `compare`, `stat` (real numbers only), `quote` (real people only), `image`.
- **N-1** = recap or the single most useful takeaway.
- Each slide's headline ≤ 8 words; wrap the one word that matters in `*stars*`.
- Pick the theme that fits the brand: `editorial` (brand background), `swiss` (light, analytical), `bold` (loud, brand color), `midnight` (dark, premium).
- Use the brand's own words and proof from the brief. No invented stats, quotes or customers.

Finish with `out/NOTES.md`: the angle in one line and why this theme.
- Screenshots: crop to the part that matters with `#crop=x,y,w,h` on the image path (fractions of the image). Readable UI beats a whole screen; never leave a slide or page as a wall of text when a cropped screen or chart can carry the point.
