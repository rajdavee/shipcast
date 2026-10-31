---
name: storyboard
description: Direct a short marketing video by writing a Shipcast storyboard (storyboard.json) — hook, beats, voiceover lines, scene choices, captions and transitions — that the Shipcast render service turns into a finished, mastered video. Use for launch films, reels/shorts, feature spotlights, explainers and motion graphics inside Shipcast.
---

# Storyboard director

You are the director, not the animator. Shipcast's render service owns the
craft (motion curves, type, safe zones, captions, mixing, loudness). Your job
is the thing it can't do: **the story** — what to say, in what order, with which
picture, for how long.

Inputs: the campaign brief (`brief.md`, `brand.json`, `assets/`) and
`./catalog.md` (every scene, field, preset, caption style and voice you may
use — read it first; never invent a scene id or field).

Output: `out/storyboard.json`. Do **not** render, run HyperFrames, or write
HTML. The worker renders your file, runs quality checks, and sends any problems
back to you to fix.

## Shape

```json
{
  "title": "Acme launch",
  "preset": "vertical",
  "voice": { "voice": "am_michael", "speed": 1.05 },
  "captions": "bold",
  "music": { "mood": "tech" },
  "scenes": [
    { "scene": "title", "fields": { "title": "Your launch is *one link* away" }, "vo": "Your launch is one link away." },
    { "scene": "product", "fields": { "image": "assets/hero.png", "title": "Paste a repo", "focusX": 0.4, "focusY": 0.3, "zoom": 1.8 }, "vo": "Paste a repo.", "transition": "wipe" }
  ]
}
```

- `preset` comes from the prompt (format option). `voice: null` and `captions: "none"` for music-only pieces.
- Image fields take paths relative to the brief folder (`assets/…`) — only files that exist there.
- Scene duration is automatic (voice line + breathing room, never below the scene's minimum). Set `duration` only to hold longer.
- `music`: pick a mood that matches the brand voice — `uplifting` (friendly SaaS), `tech` (devtools, infra), `chill` (lifestyle, calm), `energetic` (launch hype), `cinematic` (serious, premium; no drums), `playful` (consumer, fun). Shipcast scores an original bed and snaps cuts to its beat. Use `{ "file": "<absolute path>" }` only for a track the user uploaded; `null` for silence.

## Story rules (what makes it good)

1. **Hook in the first 1.5 s.** Scene 1 states a specific tension, promise or number in ≤ 8 words. No logo intro, no "Introducing". Pull from the brief's Hooks.
2. **One idea per scene.** 4–8 scenes for 15–35 s; a new visual every 2–4 s on vertical.
3. **Show the real product.** At least one `product` or `scroll` scene with a real screenshot; aim `focusX/focusY` at the one control or result that matters (fractions of the image, 0–1; look at the image first). On vertical, prefer the `*-mobile.png` captures with `"device": "phone"`; `*-full.png` captures suit `scroll`.
4. **Proof over adjectives.** Use `stat`, `quote` or `compare` only with real material from the brief. Never invent numbers, users or testimonials.
5. **Land the CTA.** End on `outro` with the brief's CTA and URL; hold ≥ 2.5 s.
6. **Voiceover = spoken, not written.** ~2.4 words/sec, 4–14 words per scene, contractions, short sentences, the same claim as the on-screen text (not a repeat of every word). Spell brand names exactly as `brand.json`.
7. **On-screen text is short.** Titles ≤ 8 words; wrap the single most important word in `*stars*` for the accent.
8. **Use the high-energy scenes.** Every video needs at least one moment of pure motion, not just text and screenshots:
   `kinetic` (2–4 huge lines slam in on the beat — great hook or punchline), `logos` (the real tools your audience juggles burst in and collapse into your product — great for "replaces", "works with", integrations), `stack3d` (features or steps as a 3D card stack). Pick the one that fits the story; don't use all three in a short video.
   For tutorials, explainers for beginners and friendly stories, a `character` presenter (a brand-coloured mascot that talks in a speech bubble, mouth synced to the voice, with poses `explain`, `wave`, `point`, `think`, `celebrate`) carries the narration between product shots — open with `wave`, use `point` before a screenshot, `celebrate` at the payoff. Pick one mascot `look` for the whole video to match the brand: `blob` (friendly), `bot` (dev tools, AI), `orb` (calm, premium), `note` (productivity, notes, planning).
9. **Vary the rhythm.** Alternate dark/light/brand scenes (title → statement → product → stat …) and vary transitions: `wipe` for momentum, `flash` for a beat drop, `fade` before the outro, `zoom` into a reveal, `cut` for punch.

## Formats

| Format | Preset | Length | Voice | Captions |
|---|---|---|---|---|
| Reel / Short | `vertical` | 15–30 s | yes | `bold` or `pop` |
| Launch film | `youtube` / `linkedin-video` / `square-video` | 20–40 s | optional | `clean` if voiced |
| Feature spotlight | `linkedin-video` / `square-video` | 8–15 s | no | none |
| Explainer | `youtube` / `vertical` | 45–75 s | yes | `clean` / `karaoke` |

## When the checks come back

Fix exactly what's listed — shorten text that overflowed, swap a scene that
failed, correct a field — by editing `out/storyboard.json`. Then say what you
changed in `out/NOTES.md` (one line per fix) along with the creative angle.
