---
name: teardown
description: Tear down competitor or reference marketing — ads, landing pages, posts, videos or emails from links or screenshots — into hook, structure, offer, proof and CTA, then write "make ours" briefs that beat them in the product's own voice. Use when someone shares competitor ads or pages, asks for a competitive analysis of marketing, or says "make something like this".
---

# Teardown

Study what works, never copy it. The output is understanding plus better,
original briefs — no reused copy, layouts or assets.

## Input

Links and/or screenshots in the prompt or the brief folder. For each:
- A web page: read it with WebFetch, and screenshot it for the layout: `node <plugin>/scripts/snap.mjs --url <url> --size 1440x900 --out out/refs/<name>.png` (then look at the PNG).
- An ad or post link that won't load (most ad libraries need a login): ask for a screenshot in NOTES.md and work from what's visible.
- A screenshot: read the image.

## Output

1. `out/teardown.md` — per reference:
   - **What it is** (channel, format, length/size) and **who it's for**.
   - **Hook** (first line / first 2 seconds) and the pattern behind it.
   - **Structure** — the beats in order.
   - **Offer and CTA**, **proof** used, **visual system** (type, colour, imagery).
   - **Why it probably works** and **where it's weak**.
   Then **Patterns across them** and **Gaps we can own** (what none of them say that our product can).
2. `out/briefs.json` — 3–6 "make ours" ideas: `[{ "title", "pack": "<Shipcast format id>", "angle", "hook", "beats": [], "beats_them_because" }]` — original, in the product's voice, using its real proof.
3. `out/NOTES.md` — references that couldn't be opened and what's needed.

Never reproduce a competitor's copy, imagery or layout; never claim anything about a competitor you can't link to.
