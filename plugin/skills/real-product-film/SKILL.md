---
name: real-product-film
description: Make a product film campaign from real recordings of the live product, explore it, record scripted takes on phone and desktop, build films with a moving device rig and phrase-led captions, then score every render against the brief and improve it until it stops getting better.
---

# Real product film

A film made from the product itself, not mock screens. The work is in five
passes, and each one leaves a file in `./out/` so the next run (or a person)
can pick up from it.

## 1 · Understand the product (`out/product.md`)

Before writing a word of script:

- Run the explorer on every view the brief names (`scripts/explore.mjs`). It
  opens dialogs and menus but never presses submit, confirm, delete, send, pay,
  save, publish, approve, decline or revoke.
- Read the result and write `out/product.md`: who uses each view, what each
  control does, the product's own words for things (use them verbatim in the
  script), and what the brief says that the product does not do. List every such
  mismatch under **Open flags**. Never paper over one in the copy.
- Check the call-to-action URL resolves. If it doesn't, use the main site and flag it.

## 2 · Rubric (`out/rubric.md`)

Turn the brief into numbered **B lines**: each one is something the brief requires,
pass or fail, and any fail blocks delivery. Add the craft lines **C1–C10**, each
scored 0–2:

| | Craft line |
|---|---|
| C1 | Hook lands in the first 1.5 s with a human moment, not a logo |
| C2 | Type: one display face, one text face, real hierarchy, nothing under 28 px on 9:16 |
| C3 | Motion has intention: the camera follows the action; nothing moves just to move |
| C4 | Transitions carry the story (into the result, out to the promise) |
| C5 | Real UI is legible: zooms land on what's being said |
| C6 | Captions: phrase-led, spoken word highlighted, never over fields or buttons |
| C7 | Voice: about 150 wpm, breaths between sentences, brand names said right |
| C8 | Sound: music arc, ticks on real taps, a payoff sound at the result |
| C9 | Ending: one promise, one URL, logo clean (no box behind it) |
| C10 | Length within 8 % of the target for every cut |

## 3 · Takes (`out/takes/`)

Write a take plan per flow: `scripts/takes.mjs plan.json`. Record at normal speed
on the phone (390 × 844) for people on the move and on the desktop (1440 × 900)
for operator screens. Put a `mark` before each beat the script talks about. The
film cuts on marks, and callouts and tap ticks come from the tap log.

- Use demo or fictional data only. Never real people's names, photos or messages.
- When the product needs a login, ask the user to sign in once in the visible
  window (`scripts/takes.mjs signin <url>`). Shipcast keeps that session private
  to the workspace. Never ask for or type a password yourself.
- Take a still of each result screen you might reveal full-screen (cards, reports).

## 4 · Films (`out/films/`)

Write a film spec per cut (`work/film-<cut>.json`) and render it with
`scripts/film.mjs work/film-<cut>.json out/films/<name>.mp4`. Build the main
film first (60–75 s), then the 30 s and 15 s cuts from the same scenes, then 6 s
bumpers without voice, all in 9:16 and 16:9.

- **Story:** a human moment → the problem in one line → the product doing it
  (real takes) → the result, revealed → one promise and the URL.
- **Type:** pick a display face with character and a calm text face from Google
  Fonts that fit the brand. Use a serif only for the promise line.
- **Voice:** set `pace` to 150, `pause` to 0.35 and a `pronounce` entry for every
  brand or product name. Listen to the first line before rendering everything.
- Read the build warnings. Voice longer than the footage, a cut off its target
  length or a logo with a background box must be fixed before scoring.

## 5 · Score, fix, repeat (`out/iteration-log.md`)

Pull frames from every render (one per scene plus the first and last second)
and look at them. Score each film against the rubric. Then fix the weakest
point first, re-render and score again. Log every pass in a table: pass, craft
score, B lines at risk, weakest points, fix applied. Stop when a pass raises the
score by less than one point, or at 18/20 with every B line met.

## Finish

`out/NOTES.md` lists the films with lengths and scores, the open flags, and what
a person should check before publishing.
