---
name: photo-carousel
description: Write a TikTok photo-mode / Instagram carousel as a Shipcast deck spec (deck.json) — 5–10 phone-first slides that the Shipcast stills service renders at 1080×1920 (TikTok) and 1080×1350 (Instagram 4:5), plus an optional MP4 with an original music bed and the post caption. Use when someone asks for a TikTok carousel, photo post, slideshow post or Instagram swipe post.
---

# Photo carousel (deck spec, phone-first)

Why this format: photo carousels are one of the fastest-rising formats on
TikTok, and on Instagram carousels out-engage Reels on engagement rate in the
2026 benchmarks. People swipe them with a thumb, full-screen, sound often on —
so every slide is one thought in big type.

Read `./catalog.md` first: themes, layouts and fields (with character limits).
Never invent a layout or field.

## Output

1. `out/deck.json` — same shape as a carousel deck. Sizes are set by the run; you write one deck:

```json
{
  "theme": "bold",
  "handle": "@acme",
  "motion": "energetic",
  "slides": [
    { "layout": "cover", "fields": { "title": "5 invoice *mistakes*", "subtitle": "#3 costs you a week" } },
    { "layout": "statement", "fields": { "title": "You send it. Then you *wait*." } },
    { "layout": "cta", "fields": { "title": "Get paid *sooner*", "button": "Link in bio", "url": "acme.com" } }
  ]
}
```

2. `out/caption.md` — two H2 sections:
   - **TikTok** — a first line that adds to the cover (not a repeat), 1–3 short lines, 3–5 hashtags (one broad, the rest niche). ≤ 300 characters total reads best.
   - **Instagram** — hook line, 3–6 short lines of value, a "save this" or question CTA, then 5–10 hashtags in a final block.
   Add an **Alt text** line per slide set (what the slides show, ≤ 200 chars).

Don't render anything yourself — the worker renders both sizes, checks every slide and sends problems back.

## Rules

- **5–10 slides.** Slide 1 `cover`, last slide `cta`. 7 is the sweet spot.
- **One thought per slide, ≤ 12 words on screen** outside `points`/`compare`. Headlines ≤ 6 words; wrap the one word that matters in `*stars*`.
- **Cover** = the payoff or the tension in ≤ 6 words ("5 invoice mistakes", "I stopped chasing clients"). A number or a strong opinion. Never "Introducing X". The cover is also the grid / profile thumbnail.
- **Slide 2 must pay off the cover immediately** — the swipe-through rate decides reach.
- **Big readable type.** The template sizes type for a phone; your job is to keep copy short enough that it never shrinks. `points` max 4 items on 9:16, each "Title — detail" with the detail ≤ 8 words.
- **Safe zones (TikTok 9:16).** The app covers the top 150 px (tabs), the right 140 px (like/comment/share column) and the bottom 420 px (caption, sound, slide dots). The template pads for them; copy that pushes into them comes back as feedback. Instagram 4:5: keep the key words inside the centred 3:4 area (the profile grid crops the sides).
- **Visual slides.** At least two slides carry something other than type: a `step`/`image` with a real screenshot from `assets/` (crop with `#crop=x,y,w,h` to the part that matters — UI text must stay readable on a phone), a `stat` (real numbers only), `compare`, `note`.
- `cta` button for TikTok/Instagram is "Link in bio", "Follow for part 2" or "Save this" — not a URL to type.
- Real claims only: no invented stats, quotes, customers or results.

## Music

With `motion` set, the worker also makes `carousel.mp4` per size: slides with push-ins and transitions over an original, royalty-free bed (mood: `uplifting`, `tech`, `chill`, `energetic`, `cinematic`, `playful`). Post the PNGs as a photo carousel and pick a sound in the app (business accounts: the commercial music library), or post the MP4 as a video — never add a copyrighted track to the file.

Finish with `out/NOTES.md`: the angle in one line, the theme and mood and why, and which slide you expect people to save.
