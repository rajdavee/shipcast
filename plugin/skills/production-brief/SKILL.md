---
name: production-brief
description: Turn any content brief that is NOT a product to market — a story, cartoon, film trailer, music video, documentary, explainer, news recap, recipe, tutorial, meme, motivational piece, travel montage, kids' lesson, data story — into a Shipcast production brief (brief.md, brand.json, intent.json) that every format then follows. Use when the research step decides the source is content, not a product.
---

# Production brief (for any content)

The user described a piece of content, not a product. Your job is a short,
concrete production bible — what we're making, for whom, how it looks and
sounds, beat by beat, and which engine makes each shot. Downstream formats
only read what you write here.

## 1. Read the brief like a director

Decide and write down:
- **Genre** (one or two words: cartoon story, cinematic trailer, documentary,
  music video, lyric video, audiogram, tutorial, recipe, news recap, data
  story, motivational, travel montage, kids' lesson, comedy sketch, horror
  teaser, sports highlight, product ad…).
- **Format**: length, aspect (16:9 / 9:16 / 1:1 / 4:5), platform if implied.
- **Audience and feeling**: who it's for, the one emotion it must leave.
- **Must-haves** the user asked for (beats, timings, sounds, "no text").

## 2. Research only what the content needs

Documentary, history, news, science, education, sport, travel: look up the
facts (WebSearch/WebFetch) and keep sources in brief.md. Stories, cartoons,
music visuals, comedy: no research — invent. Never research a "product".

## 3. Rights and safety (non-negotiable)

- **No copyrighted or trademarked characters** (anime, cartoon, film, game,
  comic heroes, mascots) and no real person's likeness. Design an original
  equivalent in the same spirit — different name, silhouette, colours,
  costume — and record the mapping in brief.md ("Requested: X → Ours: Y,
  because we don't use others' characters"). A famous gadget/place gets an
  original twist too.
- **No sexual or explicit content, no gore beyond PG-13, no deepfakes, no
  real-person impersonation, no hateful content.** If the brief needs any of
  that, write a refusal line in brief.md and make the closest acceptable
  version (or nothing).

## 4. Write the files (in the current directory)

`brief.md`:
```
# <working title>
**Genre** · **Format** (length, aspect) · **Audience** · **Feeling**
## Logline
## Characters / subjects   (original designs: look, palette, personality, voice)
## World / locations       (what each place looks like, time of day, light)
## Beats                   (numbered, with seconds: what we see, what we hear)
## Look                    (style words, palette hexes, type, camera language, references in words)
## Sound                   (music style and arc, key SFX, voice: yes/no, language)
## Engines per beat        (see below)
## Rights & safety notes
## Sources                 (only if researched)
```

`brand.json` — the look as a palette: `{"name": "<title>", "oneLiner":
"<logline>", "colors": {"background","surface","text","muted","primary",
"secondary"}, "fonts": {"display","body"}, "voice": "<tone words>"}` (Google
Fonts names; pick for the genre — rounded for kids, condensed for trailers,
serif for documentary…).

`intent.json` — `{"kind": "content", "genre": "...", "aspect": "16:9",
"seconds": 45, "engines": ["cartoon-kit", "motion", "stock", "generative",
"type", "data", "capture", "uploads"]}` (only the engines you plan to use).

## Engines (what Shipcast can make a shot with)

| Engine | Best for |
|---|---|
| `cartoon-kit` | original 2D characters (kids, robots, animals, creatures) acting, emoting, walking, flying, talking; illustrated worlds; magic effects |
| `motion` | design-led motion graphics, kinetic type, title sequences, abstract visuals, particles, light, shaders |
| `stock` | real footage/photos of real things (cities, nature, food, people working, sport) — needs a free Pexels key; otherwise skip |
| `generative` | photoreal or painted shots no other engine can make (needs the user's fal/Replicate key or local ComfyUI; check availability before relying on it) |
| `type` | lyrics, quotes, word-synced captions to a voice or song |
| `data` | charts, maps, timelines, comparisons, maths |
| `capture` | real websites/apps filmed live |
| `uploads` | the user's own clips, photos, audio in the campaign's uploads |

Prefer engines that are available now; plan a fallback for any optional
one (e.g. generative → cartoon-kit or motion).
