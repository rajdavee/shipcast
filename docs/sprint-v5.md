# Sprint v5 — marketing on steroids

Goal: results a marketing team would pay for. Photoreal people using the
product, UGC-style ads, talking presenters, lifestyle shots — mixed and
matched from open and hosted models — plus the controls marketers expect:
a brand voice, hook variants, platform-ready exports and a weekly trend brief.

## What the research says (summary)

**Realism.** The polish in OpenMontage and Open-Higgsfield comes from the
models they call (Kling 3, Seedance 2, Veo 3.1, Nano Banana, OmniHuman via
fal / kie / Atlas), not from local magic. What they add on top is craft:

- a shot schema (subject · motion · scene · spatial · camera) with strict
  camera words and a per-model prompt length;
- camera / lens / aperture presets turned into prompt text;
- a hero still per shot, then image→video with the first (and last) frame
  pinned so the product never morphs;
- reference packs (3–8 images) or a LoRA for a consistent person;
- a storyboard approval with takes and a cost per shot before spending;
- a self-review pass on frames after render.

Neither repo can be reused as code: OpenMontage is AGPL-3.0 and the
Open-Higgsfield fork has no licence file. We rebuild the ideas in our own code
and call the models through their public APIs.

**Open models that matter now** (commercial use OK unless noted): FLUX.2 klein
4B (Apache, runs on a Mac via mflux), Qwen-Image / Qwen-Image-Edit-2511
(Apache; product-in-hand, multi-reference), Wan 2.2 A14B / TI2V-5B and
Wan 2.2-S2V (Apache; last open Wan), LTX-2.x (free under $10M revenue),
InfiniteTalk (Apache; image + voice → talking person), LatentSync 1.6 (Apache;
lip re-sync), SeedVR2 (Apache; image and video upscale), Real-ESRGAN, GFPGAN,
BiRefNet, IC-Light v1. Avoid for commercial work: FLUX.2 dev weights,
RMBG-2.0, IC-Light v2, CodeFormer, CatVTON/FitDiT. A Mac can do images
locally; realistic video needs a hosted API or a ComfyUI box with an NVIDIA GPU.

**Marketers.** Tools they love learn a voice from samples, enforce a lexicon
(hard bans, preferred terms), score every asset against the brand and offer a
fix, and generate many hook variants. 2026 short-form: the hook has 1.5–2 s;
UGC, founder-led and demo/testimonial formats win on conversion; creative
fatigues in 7–14 days on TikTok and 3–6 weeks on Meta; LinkedIn PDF carousels
lead organic engagement. AI disclosure is now required by Meta, TikTok and
Google, and the EU AI Act Art. 50 transparency duties apply from Aug 2026.

**Trend data.** Usable without scraping: Hacker News (free), YouTube Data API
search by date window (free key), Product Hunt (non-commercial), Claude's own
web search. Not to build on: Reddit (public API closing), pytrends (dead), X
(paid per read), TikTok Creative Center (no API). Competitor ads come in as
links or screenshots the user pastes.

## Backlog (ranked by impact ÷ effort)

### A. Realistic people and products

1. **`services/gen` (:4324)** — one generation service with adapters
   (`fal`, `replicate`, `comfyui`, `mflux`), a model registry (capability,
   inputs, limits, licence + `commercialOK`, hardware, price, quality, prompt
   style), a router (fit × quality ÷ cost under a budget cap, explicit model
   wins), content-hash cache, cost estimate before submit, spend cap per
   campaign. `media.mjs gen` becomes a thin client of it.
2. **Shot compiler** — 5-slot shot schema + camera/lens/light presets +
   per-model templates and word budgets. The director writes shots, not prompts.
3. **Hero-frame → motion** — generate the still first (with the real product
   cut-out and brand colours), approve, then image→video with the frame pinned.
4. **Cast & product kits** — reference packs per synthetic actor and per
   product (BiRefNet cut-out); optional LoRA training; reused across shots and
   campaigns.
5. **UGC / presenter pack** — script → voice (Kokoro / ElevenLabs) → portrait
   → InfiniteTalk (or Wan-S2V) talking clip, intercut with product screens and
   B-roll; captions; "AI actor" disclosure built in.
6. **Finishing** — SeedVR2 / Real-ESRGAN upscale, GFPGAN face pass,
   IC-Light relight for product shots, all optional per shot.
7. **Storyboard approval with takes** — contact sheet of hero frames, 2–3
   takes per shot, price per shot and total; approve, swap or regenerate one.

### B. Marketer controls

8. **Tone & Voice profile** — sliders (formal↔casual, serious↔playful,
   reserved↔bold, technical↔simple, humour), personality words, reading
   level, person, do/don't, lexicon (preferred + banned), emoji / hashtag /
   CTA policy, claims rules, locale, per-channel overrides. Learned from
   sample texts or URLs. Lives with the brand kit; every pack reads it.
9. **Brand score** — after each asset: banned terms, claims without a
   source, reading level, slider drift → % and "fix it" rewrite (QA service).
10. **Hook variants** — 5–10 hooks per asset (pain POV, open loop,
    before/after, stat, contrarian), rendered as cut variants of one master.
11. **Platform-native export** — TikTok / Reels / Shorts / LinkedIn / X
    presets: ratio, length, safe zones (2026), caption placement above
    auto-captions, per-platform copy, hashtags, AI-label flag.
12. **Weekly trend brief** — HN + YouTube search + Claude web search for the
    product's niche → trending formats, hooks and topics mapped to ready-to-make
    briefs. Competitor teardown from pasted ad links or screenshots.
13. **Compliance & disclosure** — C2PA / XMP "AI-generated" metadata,
    on-screen label for synthetic humans, claims check, consent record for any
    real face or cloned voice (otherwise refused).

### C. Carried over

14. Stock: real download tests for the "Anything" pack; footage cut to the
    beat.
15. ElevenLabs: voice per brand profile; credit counter in Setup.
16. Supervisor: no duplicate restarts, waits out taken ports — done.
17. Content prompts pick "Anything" more reliably — done.

## Safety rules (unchanged, now enforced in `gen`)

No sexual content, nothing involving minors, no real person's face or voice
without a stored consent record, no celebrities or public figures, no fake
"real customer" testimonials — synthetic actors are labelled as such. Every
synthetic-human asset carries metadata and (by default) an on-screen label.

## Testing

- **Unit** (fake providers, no network): registry filtering by capability,
  licence and budget; router choice; cache hits; cost estimate and cap;
  shot compiler output per model; safety guard (blocked prompts, missing
  consent, celebrity names); tone profile → prompt fragments; brand score.
- **Contract**: recorded fixtures for fal / Replicate / ComfyUI responses
  (queued → running → done, errors, rate limits, timeouts).
- **Live smoke** (opt-in, `SHIPCAST_LIVE=1`, with keys): one image per
  default model, one 5 s i2v, one 10 s talking head; asserts file, size,
  duration, cost logged.
- **Golden eval set** — 10 briefs (SaaS UGC ad, DTC product-in-hand, founder
  video, B2B LinkedIn carousel, travel film, recipe, fitness, fintech,
  developer tool, app store preview). Each run produces a contact sheet; a
  vision-model judge scores realism, product fidelity, brand fit, hook
  strength, text legibility and artefacts (hands, faces, morphing) 1–5; a
  person reviews the sheet. A release needs ≥4.0 average and no 1s.
- **Regression**: the existing 47 tests stay green; showcase campaigns
  (SiGMMa, Veracy) re-render unchanged.

## Order of work

1. `gen` service + registry + fal adapter + cache + cost cap + guard (A1, 13).
2. Shot compiler + hero-frame → motion (A2, A3) — first realistic B-roll.
3. Tone & Voice profile + brand score (B8, B9).
4. Cast & product kits + UGC/presenter pack (A4, A5).
5. Hook variants + platform export (B10, B11).
6. Storyboard takes + finishing (A6, A7).
7. Trend brief + teardown (B12); golden eval run; README and CHANGELOG.

## Needs from you

- A **fal.ai** key with a spend cap (best realism per dollar; covers Kling,
  Seedance, Wan, LTX, Qwen, FLUX, InfiniteTalk, SeedVR2). Replicate optional.
- A budget per test run (suggested: ≤ $5 per golden brief, ≤ $50 for the
  whole eval).
- Optional: an NVIDIA GPU box for ComfyUI if you want the open models run
  self-hosted instead of through fal.
