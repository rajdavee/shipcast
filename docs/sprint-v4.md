# Sprint v4 — from 15-second shorts to 10-minute YouTube videos

Goal: any length, edited like a creator would edit it, in your own voice if
you want — without becoming a template factory.

## What the research says (summary)

- **Shorts** (15–45 s): decide in 1–2 s, visual change every 1.5–3 s,
  captions always on, loopable ending.
- **YouTube long-form** (5–10 min sweet spot for faceless): 30 s cold open
  (prove the title → why it matters → what's coming), chapters, a re-hook
  every 60–90 s, biggest moment at 50–70 %, CTA after the payoff.
- **Editing** that's automatable: punch-ins on emphasised words, beat-snapped
  cuts, whoosh/riser/hit rules, ducking, kinetic captions (word pop, keyword
  highlight, emoji, karaoke), chapter cards, progress bar, end screen.
- **Platform risk**: YouTube's "inauthentic content" policy (Jul 2025)
  demonetises mass-produced template videos. Our edge — Claude writes
  bespoke scenes per video — is also our defence; we add a variety guard.
- **Pipeline for long videos**: render each chapter as its own composition,
  cache by content hash, concat with ffmpeg (same codec/fps → no
  re-encode), mix audio once over the whole timeline.

## Backlog (ranked by impact ÷ effort)

1. ✅ **Bring-your-own ElevenLabs** — key in Setup, with-timestamps alignment
   → word timings, Kokoro fallback.
2. **Chaptered long-form** — storyboard `chapters[]`; per-chapter render with
   a hash cache; ffmpeg concat; one audio mix; chapter cards; YouTube
   description timestamps, SRT/VTT sidecars.
3. **Long-form script skill + YouTube pack** — cold-open template, re-hooks,
   mid-video climax, chapters → timestamps, 3–10 min target.
4. **Caption presets** — word-pop (Hormozi), keyword highlight, emoji,
   karaoke; per-format defaults (Shorts = word-pop).
5. **Edit-rhythm pass** — punch-ins on emphasised words, SFX by rule
   (whoosh on transitions, riser before reveals, hit on lands), progress bar.
6. **Length control** in the UI — 15 s · 30 s · 60 s · 3 min · 5 min · 10 min.
7. **Variety guard** — rotate layouts/looks/pacing; warn when a storyboard
   repeats scene patterns from the last videos.
8. **B-roll** — optional free Pexels key; one query per sentence; attribution
   ledger.
9. **Shorts repurposer** — slice a long video into 3–5 vertical clips at the
   strongest beats.
10. **Short-film kits** — kinetic-type story, data story, two-voice dialogue,
    motion comic (later: Lottie/Rive characters).

Later / optional: Chatterbox (MIT) as a local voice upgrade; ACE-Step for
local music generation (GPU); footage ingest (auto-editor, PySceneDetect,
stable-ts).

## Definition of done
Rendered and watched frame by frame; long videos render in chapters within
sane memory; captions readable in the safe zone; tests + CI green.
