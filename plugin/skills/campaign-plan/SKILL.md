---
name: campaign-plan
description: Plan a whole marketing campaign for a product from its brief, verified product facts and captured product screens — one campaign line, a set of assets (videos, carousels, posts, copy) each with its own angle, and a posting calendar — written as a Shipcast plan.json that the studio expands into jobs. Use when someone asks for a full campaign, a launch plan, or "everything" for a product.
---

# Campaign plan

A campaign is one idea told many ways, not a pile of unrelated assets. Your
job is the idea, the split, and the order. Each asset is made later by its
own job, which reads only the brief plus the short brief you write for it —
so every asset brief must stand on its own.

## Read first

1. `brief/brief.md` and `brief/brand.json` — product, audience, voice.
2. `brief/product-facts.md` if it exists — the **only** claims you may use.
   Everything else is unverified: leave it out.
3. `brief/assets/app/screens.json` if it exists — real screens and
   walkthrough recordings. Look at the images. Plan assets around the
   strongest real moments (the dashboard, the "aha" screen, a before/after).
4. The menu of formats in the prompt (pack ids and their options). Never use
   a pack or an option value that isn't on the menu.

## Decide

- **The line**: one sentence the whole campaign repeats in different words.
- **3–6 pillars**: the distinct reasons to care (a pain, a feature, trust /
  compliance, pricing, the product in action). Every asset serves one pillar.
- **The set**, sized by the prompt's `size`:
  - `focused` ≈ 6 assets: launch video, one product walkthrough video,
    2 carousels, a social-post set, the copy kit.
  - `standard` ≈ 10: adds a reel or short, 2 more carousels, thumbnails.
  - `big` ≈ 16: a video per pillar (launch film, walkthrough, motion-graphics
    dashboard, reels), a carousel per pillar, posts for every pillar, copy
    kit, thumbnails.
- Put real product UI in at least half the assets when screens exist. A
  "dashboard video" is a motion-graphics or product-promo video built on the
  captured screens and walkthrough clips.
- Vary formats and angles: no two carousels with the same angle, no two
  videos with the same structure.

## Write

`out/plan.json`:

```json
{
  "line": "Every call answered — even at 2 a.m.",
  "pillars": [{ "id": "after-hours", "title": "After-hours calls", "why": "…" }],
  "assets": [
    {
      "pack": "launch-video",
      "title": "Morning rush",
      "pillar": "after-hours",
      "angle": "Open on the missed-call pile; the product clears it in one take.",
      "brief": "60–80 s. Hook: the 7 a.m. voicemail queue. Show the real call-log screen at 0:20. End on the line. Facts to use: …",
      "options": { "length": "60" }
    }
  ],
  "calendar": [
    { "day": 1, "channel": "LinkedIn", "asset": "Morning rush", "note": "Launch post, pin it" }
  ]
}
```

- `brief` is 2–5 sentences: the hook, the real screens or facts to use, the
  ending. Name screen files from `brief/assets/app/` when they fit.
- `options` only uses keys and values the menu lists; leave out the rest.
- `calendar` covers 2–4 weeks: launch-day burst, then 3–5 posts a week,
  each asset used on the channels it suits (vertical video → Reels, Shorts,
  TikTok; carousels → LinkedIn, Instagram; wide → X, YouTube).

Also write:

- `out/CAMPAIGN-BRIEF.md` — the line, the pillars, the verified facts to
  use (copied from product-facts.md), names and spellings, words to avoid,
  and the truthfulness rules (no invented customers, numbers, ratings,
  testimonials; real UI labelled "Real product UI · sample data").
- `out/calendar.md` — the calendar as a readable table.
- `out/NOTES.md` — why this split, in a few lines.

Don't make any of the assets yourself.
