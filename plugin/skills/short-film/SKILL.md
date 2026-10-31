---
name: short-film
description: Write a 45–120 second narrated short film as a Shipcast storyboard — a real story arc (a person, a problem, a turn, a resolution) shot cinematically with the `cinema` scene (letterbox, slow camera, grain), quiet kinetic beats and the product as the turning point, never the hero. Use for "short film", "brand film", "story video", "origin story", "manifesto".
---

# Short film

Read `shipcast:storyboard` first; its rules on scenes, fields and voice lines
apply. This skill is about **story**, not features.

## The arc (in this order)

1. **Open on a person in a moment** (`cinema` with a `kicker` like
   "Tuesday, 11:42 pm"). Specific, sensory, no product. One line.
2. **The weight** — what this problem costs them, shown in 2–3 beats
   (`cinema`, `statement`). Small details beat big claims.
3. **The turn** — the moment something changes. This is where the product
   appears, briefly, as a tool in their hands (`product`/`scroll` with a real
   screenshot, or a `kinetic` beat). It is the turning point, not the hero.
4. **After** — the same person, lighter. Mirror the opening image or line.
5. **Close** — one quiet line, then `outro` with the brand (no hard sell; a
   soft CTA at most).

## Craft

- **Voice like a narrator, not an ad**: second person ("you") or a named
  character; short sentences; pauses (separate scenes) do the work. Speed 0.95.
- **Mostly `cinema` scenes** (60–70 %), each held 3–6 s; use the brief's real
  screenshots as `image` where they fit, otherwise leave `image` empty for
  the moody gradient. Mix in 1–2 `statement` or `kinetic` beats for rhythm.
- **Real footage**: `broll` scenes with a concrete visual `query` ("rain on a window at night", "hands on a laptop keyboard") make the film feel shot, not designed. They fall back to `cinema` shots without a Pexels key.
- **Music**: `{ "mood": "cinematic" }`. Transitions: mostly `fade`, one `cut`
  at the turn.
- **Never invent** testimonials, numbers or people presented as real. A
  "you" character or an illustrative persona is fine.

Output `out/storyboard.json`, plus `out/NOTES.md` with the logline (one
sentence) and the arc in five lines.
