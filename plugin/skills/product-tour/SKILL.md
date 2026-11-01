---
name: product-tour
description: Direct a music-led product tour promo (45–150 s) as a Shipcast storyboard — the messy "before", a brand reveal, then the product's workflow told beat by beat with rebuilt UI that animates (forms filling, options picked, checks passing), real screens and filmed click-throughs, a trust beat, plans and a CTA. Use for product tours, homepage videos, "see it in action", SaaS promos and launch promos.
---

# Product tour promo

Read `shipcast:storyboard` and `./catalog.md` first. This adds the shape of
a high-craft SaaS promo: crisp, light, every beat a small piece of UI doing
something, joined by motion-blurred whips.

## Shape

1. **Before (3–5 s)** — `chaos`: the real tools and spreadsheets the
   audience juggles today, piling up until the thing that goes wrong
   (an alert, a ban, a missed deadline) slams across. From the brief's pain,
   not invented drama.
2. **Reveal (2–3 s)** — `title` on the brand ground or `logo-sting`: the
   name and the one-line promise.
3. **The workflow, one step per beat (60–70 % of the video)** — follow the
   order a user really works in (set up → find → act → follow up → measure).
   Each beat is ONE small piece of UI doing one thing:
   - `form` — the setup fills itself with real option values,
   - `options` — a choice gets picked (sources, plans, modes),
   - `flow` — what happens automatically, in order,
   - `rail` — every action passes the product's checks (limits, approvals,
     guardrails); one variant can show a stop,
   - `walkthrough` / `recording` — the real screen at the moment that
     proves it (the inbox, the dashboard, the result),
   - `stat` / `chart` — one real number when it lands.
   Bridge rebuilt UI and real UI often: rebuilt shows the idea cleanly, the
   real screen proves it exists.
4. **Trust (one beat)** — a `rail`, `checklist` or `matrix` for safety,
   compliance or control. Real policies only.
5. **Plans (optional)** — `options` or `table` with the real plan names.
6. **CTA** — `outro` with the brand CTA and URL.

## Rules

- Headline per beat ≤ 7 words, one *accent* phrase: "Every request passes
  *your rules*".
- Every value shown must exist in the product: field options, plan names,
  limits, integrations (from `product-facts.md`, the code, or screens).
  Sample people and companies are fine and should look real.
- Transitions: `blur` between UI beats (default), `push` along a sequence,
  `flash` into the reveal, `fade` before the outro.
- Ground: light (`"theme": "light"` on scenes that take it) unless the brand
  is dark; keep one ground for the whole tour.
- Music leads (`tech` or `uplifting`); voiceover optional — if used, ≤ 2.3
  words/s and only on 40–60 % of beats so the music breathes. Captions
  `none` without voice.
- Pace: a new beat every 3–5 s; rebuilt-UI beats 3.5–5 s, real-UI beats
  4–7 s.

## Output

`out/storyboard.json` (`scenes`, not chapters) and `out/NOTES.md` with the
beat list and where each value came from.
