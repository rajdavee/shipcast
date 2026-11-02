---
name: ugc
description: Make a UGC-style video ad — a synthetic, clearly-labelled presenter speaks the hook and the call to action straight to a phone camera, intercut with real product screens narrated in the same voice — as a storyboard the render service turns into a vertical ad with captions. Use when someone asks for a UGC ad, creator-style ad, testimonial-style video, talking-head ad or "an ad with a person in it".
---

# UGC ad (storyboard with a synthetic presenter)

UGC ads win on conversion because they feel like a person, not a brand. We
make that feel honestly: the presenter is a fictional, AI-generated person,
always labelled as such, never presented as a real customer, and never
claiming to have used the product ("I tried it and…" is a fake testimonial —
not allowed). They *explain* and *recommend*, like a creator would.

## Steps

1. Read the brief and the brand voice section of the prompt. Pick ONE angle (pain → fix, "3 things", myth vs truth, "how I'd do X") and a target length of 20–35 s.
2. Write the script as 4–6 beats:
   - **Hook** (presenter, 2–4 s, ≤ 12 words): a pattern interrupt in the audience's words.
   - **2–3 middle beats** (product screens, narrated): show the thing working on real screenshots from `assets/`.
   - **CTA** (presenter, 2–4 s): one action, said like a person.
3. Create the presenter once (a fictional person who fits the audience; describe age range, look, clothing, setting — never a real or famous person):
   `node <skill dir>/scripts/presenter.mjs portrait --name host --who "…" --where "…" --aspect 9:16`
4. Record the presenter beats:
   `node <skill dir>/scripts/presenter.mjs say --name host --id hook --line "…"` and the same for `--id cta`.
   Each prints `{clip, seconds, usd}`. If it exits with code 5 the budget cap was hit: stop, keep what exists, and say so in NOTES.md. Without a connected generation key the clips are labelled placeholders — still write the full storyboard so the user can render for real later.
5. Write `out/storyboard.json` (read `./catalog.md` for the format):
   - `"preset": "vertical"`, captions `"bold"` or `"highlight"`, music mood that fits, the voice left as configured.
   - Presenter beats: `{ "scene": "broll", "fields": { "video": "<clip path>", "audio": "yes", "line": "<the words, for on-screen text>" }, "duration": <clip seconds> }` — **no `vo` on these scenes** (the clip carries the voice).
   - Middle beats: `product` / `scroll` / `recording` scenes with real screenshots and a `vo` line each (same voice as the presenter).
   - Last frame: `outro` with the CTA and URL.
6. `out/NOTES.md`: the angle, the presenter description, cost so far, and the disclosure line to use in the post ("AI-generated presenter").

## Rules

- The presenter is synthetic: never a real person, celebrity, employee or customer; no "I'm a customer" claims; no invented results.
- Captions must be legible with the platform UI: keep text in the middle band of the frame.
- Spend: the gen service plans and caps the cost; draft with `--placeholder` first if the user wants to approve the script before paying.
