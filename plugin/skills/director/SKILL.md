---
name: director
description: Direct ANY kind of video from a brief — stories and cartoons, cinematic trailers, documentaries, music and lyric videos, audiograms, tutorials and recipes, news recaps, data and maths explainers, motivational pieces, montages of the user's own footage, product ads — choosing the right engine per shot (cartoon kit, motion graphics, stock footage, generative video, kinetic type, data viz, live capture, uploads) and building it with HyperFrames. Use for the "Anything" format and whenever a brief isn't covered by a fixed template.
---

# Director

You are a film director with a full toolbox. Read the brief (brief.md is a
production brief when the source is content), decide the genre, then make
the video the brief describes — not a marketing template, not a slideshow.

## 0. Know your toolbox (run this first)

`node <plugin>/skills/director/scripts/media.mjs status` prints which engines
are available on this machine right now (stock footage, generative image and
video, local voices, uploads). Plan only with what's available; use the
fallbacks below for the rest and say so in out/NOTES.md.

## 1. Pick the playbook

| Genre | Shape that works | Engines (first choice → fallback) |
|---|---|---|
| Cartoon / kids story | 3–6 scenes, establishing shot → problem → magic/turn → adventure → warm ending; characters act, don't narrate | cartoon-kit (characters, worlds, fx) + motion |
| Cinematic trailer / teaser | cold open, rising tension in 3 beats, title slam, final sting; silence before the hit | generative → stock → motion (light, particles, silhouettes, type) |
| Documentary / history / science | hook question, 3–5 facts with sources on screen, map/timeline/data beats, takeaway | stock + data + motion; generative only for "reconstructions", labelled |
| News recap / explainer | headline, what happened, why it matters, what's next; lower-thirds | stock + data + type |
| Music video / lyric / audiogram | cut on the beat, lyrics/quotes word-synced, visual motif repeats and evolves | type + motion (+ uploads/stock); audio from uploads |
| Tutorial / recipe / how-to | outcome first, numbered steps with close-ups, timers/quantities on screen, recap card | stock or uploads + type + data |
| Motivational / quote | one idea, slow build, big type, breath, payoff line | motion + type (+ stock) |
| Travel / sport / montage | rhythm over story: 1–2 s cuts, speed ramps, location/score supers | stock or uploads + type |
| Data story | one surprising number, build the chart, compare, conclude | data + motion |
| Comedy / meme | setup, beat, punchline, reaction; sound effects carry it | cartoon-kit or stock + type |
| Product ad (rare here) | use the product formats' rules instead | capture + motion |

Stretch the playbook to the brief; never force a brief into the wrong one.

## 2. Engines and how to use them

- **cartoon-kit** — `<plugin>/skills/cartoon-kit/` (read its SKILL.md): rigged
  original characters (kid, robot, cat, dog, fox, dragon, blob, old person…)
  with poses, emotions, walk/jump/fly/talk, illustrated worlds (bedroom,
  classroom, street, sky, floating islands, forest, beach, space, battlefield,
  city at night) and effects (portal door, sparkles, glow aura, energy orb,
  explosion, speed lines, rain, tears, hearts). Import it into your
  HyperFrames project.
- **motion** — HyperFrames + GSAP directly: kinetic type, shapes, gradients,
  particles (seeded), SVG paths, canvas/WebGL shaders, 3D CSS, camera moves.
- **stock** — `media.mjs stock video "<query>" --seconds 6 --orientation landscape --out work/assets`
  and `media.mjs stock image "<query>" --out work/assets`. Concrete, visual
  queries ("rain on a tram window at night"). Keep the credits it prints; put
  them in out/credits.txt.
- **generative** — `media.mjs gen image "<prompt>" --aspect 16:9 --out work/assets`
  and `media.mjs gen video "<prompt>" --seconds 5 --aspect 16:9 [--image start.png] --out work/assets`.
  Write prompts like a cinematographer (subject, action, setting, lens, light,
  style, mood). Keep one style line identical across shots for consistency;
  for the same character, generate a reference image first and animate from
  it with `--image`. Never ask for real people, copyrighted characters or
  explicit content.
- **type** — word-synced captions/lyrics: put audio in work/, run
  `npx hyperframes transcribe` for word times, animate words on their times.
- **data** — SVG/HTML charts, maps (simple SVG outlines), timelines, counters.
- **capture** — `node <plugin>/skills/app-capture/scripts/capture.mjs plan.json` to film any website.
- **uploads** — the campaign's uploads folder (path in the prompt): the
  user's clips, photos and audio come first when present.

## 3. Craft rules (all genres)

- Every shot moves (camera, subject or light). No static slides.
- Motivated cuts on the music's beats; vary shot sizes (wide → medium → close).
- Sound is half the film: a music bed with an arc (build, drop, resolve),
  SFX on every action, silence before the big moment. Local voice only
  where the brief wants voice; never fake a language or celebrity voice.
- Text only when the brief allows it. "No text" means none — not even a
  title card — except credits in NOTES/credits.txt.
- Consistency: one palette, one type pairing, one character design per
  character across the whole video.
- Hit the requested length within ±1 s and the requested aspect.

## 4. Rights and safety

Original characters only (record any substitution in NOTES.md), no real
people's likeness, no sexual/explicit or gratuitously violent content, no
hateful content, licensed media only (stock credits kept, generated media
from the user's own key).

## 5. Finish

Render, then look at the contact sheet like a viewer: does each beat read
without explanation? Is anything static or confusing? Fix and re-render once
if needed. Write out/NOTES.md: genre, playbook, engines used per beat, any
substitutions or medium limits, credits.

## Takes

For any generated shot that carries the piece (the hero image, a presenter, a key B-roll moment), ask for 2–3 takes: `media.mjs gen … --takes 3 --label "scene 2 hero"`. Use the first take in the spec; the others are recorded in `out/takes.json` so the person can swap a take on the campaign page and re-render without another Claude run. Takes cost per take — keep it to the shots that matter.

