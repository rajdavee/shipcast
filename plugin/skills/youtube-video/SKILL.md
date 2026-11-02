---
name: youtube-video
description: Write a 3–10 minute narrated YouTube video as a chaptered Shipcast storyboard (storyboard.json with chapters[]) — cold-open hook, chapters with re-hooks, a mid-video peak, payoff, CTA — plus title options and a description. Use for "YouTube video", "long-form", "video essay", "tutorial video", "5/8/10 minute video".
---

# Long-form YouTube video

Read the `shipcast:storyboard` skill first — every rule about scenes, fields,
voice lines and the catalog applies. This skill adds the long-form shape.

## Structure that holds attention

Speech runs ~150 words/minute. Budget the script before writing scenes:

| Length | Words | Chapters | Scenes |
|---|---|---|---|
| 3 min | ~450 | 3–4 | 30–40 |
| 5 min | ~750 | 4–5 | 50–65 |
| 8 min | ~1,200 | 5–7 | 80–100 |
| 10 min | ~1,500 | 6–8 | 100–125 |

1. **Cold open (chapter 1, `"card": false`, ≤ 30 s).** 0–10 s prove the
   title with one concrete example; 10–20 s why it matters to the viewer;
   20–30 s what they'll get by the end. No logo, no "hey guys".
2. **Chapters.** Each opens with a one-line mini-hook, delivers one idea, and
   ends on an open loop into the next ("…but that only works if…").
3. **Re-hook every 60–90 s** — a question, a surprising number, a pattern
   break (`kinetic`, `stat`, `logos`, `compare`).
4. **The peak at 50–70 %** — the biggest reveal or demo goes here, not at the end.
5. **Payoff, then CTA** — answer what the cold open promised; one CTA after it.

## Visual rhythm (anti-"inauthentic content")

YouTube demonetises templated, mass-produced videos. Make every video
specific and varied:

- A new visual every 3–6 s; never the same scene type more than twice in a row.
- Use the product's real screenshots (`product`, `scroll`), real numbers
  (`stat`, `chart`), real tools (`logos`), real commands (`terminal`).
- Mix energy: calm explanation scenes, then a `kinetic` or `stack3d` beat.
- Vary transitions; `fade` into chapters is automatic via chapter cards.
- `broll` scenes (real stock footage behind one line) add texture to long videos — give a concrete visual `query`; about 1 in 4–6 scenes at most. Without a stock key they become cinematic shots automatically, so they're always safe.

## Output

1. `out/storyboard.json` with `chapters` instead of `scenes`:

```json
{
  "title": "…", "preset": "youtube",
  "voice": { "voice": "am_michael", "speed": 1 },
  "music": { "mood": "chill", "gainDb": -20 },
  "captions": "clean",
  "chapters": [
    { "title": "Cold open", "card": false, "scenes": [ … ] },
    { "title": "Why six tools happened", "scenes": [ … ] }
  ]
}
```

Chapter titles become chapter cards and the YouTube timestamps
(`chapters.txt` is written by the renderer — first chapter at 0:00, each
≥ 10 s, at least three).

2. `out/title.txt` — three title options (≤ 60 chars, curiosity + clarity).
3. `out/description.md` — two-line hook, a short summary, a `{{timestamps}}`
   line where the chapters go, links from the brief, 3 hashtags.
4. `out/NOTES.md` — the angle and the retention plan in a few lines.
