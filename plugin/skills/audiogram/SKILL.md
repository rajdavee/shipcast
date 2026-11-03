---
name: audiogram
description: Make an audiogram / founder clip — a 30–90 s vertical (1080×1920) and square (1080×1080) video of one spoken segment (a podcast excerpt from an audio file, or a founder voiceover of a script) with a waveform driven by the real audio, large burned-in karaoke captions, the speaker's lower-third, logo and optional cover art, as a Shipcast storyboard rendered by the render service. Use when someone asks for an audiogram, podcast clip, founder clip or "talking" social post without footage.
---

# Audiogram (storyboard with the `audiogram` scene)

An audiogram works when one sentence makes a scroller stop and the captions
carry the rest with the sound off. Pick the strongest 30–90 seconds, not a
summary of everything.

Read `./catalog.md` first; the `audiogram` scene and its fields are listed there.

## Output

`out/storyboard.json`, one `audiogram` scene (optionally a 2–3 s `logo-sting` or `outro` at the end — no other scenes):

Voiceover from a script (founder clip):

```json
{
  "title": "Why we built Shipcast",
  "preset": "vertical",
  "voice": { "voice": "am_michael" },
  "captions": "karaoke",
  "music": { "mood": "chill", "gainDb": -26 },
  "scenes": [
    { "scene": "audiogram", "vo": "Every launch I've done, the product was ready and the marketing wasn't…",
      "fields": { "name": "Maya Chen", "title": "Founder, Shipcast", "headline": "Why the launch kit *is* the product", "kicker": "Founder notes", "cover": "assets/founder.jpg", "style": "bars" } }
  ]
}
```

A recording from the brief (podcast excerpt): no `vo`, no voice — the file plays and is transcribed for the captions:

```json
{ "preset": "vertical", "voice": null, "music": null, "captions": "karaoke",
  "scenes": [ { "scene": "audiogram", "fields": { "audio": "assets/ep12.mp3", "from": 754.5, "to": 812, "name": "Maya Chen", "title": "Guest, The Build Show", "headline": "The *one* launch metric we watch", "kicker": "The Build Show · Ep 12", "cover": "assets/ep12-cover.png" } } ] }
```

`sizes` is set for you; every size is laid out from the same scene. Don't render anything yourself — the worker renders, checks and sends problems back.

## Rules

- **Length 30–90 s.** A script: 75–220 words (about 150 words a minute). A recording: `from`/`to` around one complete thought — start on a sentence, end on a full stop, never mid-word; listen-test it by reading the transcript in the brief or notes if there is one.
- **The hook is the first sentence.** Open with the claim, the surprise or the question — not "Hi, I'm…". The topic line (`headline`, ≤ 10 words) says what the clip is about; it is not a quote.
- **Captions are the content** for a muted feed: keep `"captions": "karaoke"` (or `boxed`). Don't repeat the spoken words in `headline`.
- **Speaker**: real name and real title from the brief. `cover`: a real photo or podcast artwork from `assets/`; leave it out rather than use a stock face or a generated person.
- **Script voice** (founder clip): first person, spoken rhythm, short sentences, one idea, one concrete example, end on a line worth repeating. Every claim from the brief; no invented numbers, customers or quotes. Plain words — no "game-changer", "unlock", "seamless", "excited to announce".
- **A recording is quoted, not rewritten.** Never put words in a real person's mouth; pick the segment, don't edit what they said.
- **Music**: `null` under a podcast recording (it has its own sound); for a voiceover a soft bed (`chill`, `gainDb` −24 to −28) or none.
- Waveform: `bars` (default) or `wave`. Theme: `dark` default; `light` or `brand` to match the brand.
- No platform logos or "as heard on" badges unless the brief has the right to use them; the podcast's own name goes in `kicker`.

Finish with `out/NOTES.md`: why this segment, the exact time range or script source, a post caption (≤ 2 lines + 3 hashtags) and alt text.
