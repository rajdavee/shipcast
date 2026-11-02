# Sprint v5 — marketing on steroids

Goal: every material a marketing team ships, at a quality they would pay
for — decks, PDFs, carousels, posts, ads, emails, landing sections, print,
infographics, images and videos — all in one brand voice, with hook variants,
platform-ready exports and a weekly trend brief. Photoreal people and products
(UGC ads, presenters, lifestyle shots) come from mixed-and-matched open and
hosted models.

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

## Materials marketers use (and what Shipcast makes after this sprint)

| Material | Today | This sprint |
|---|---|---|
| Social carousels (LinkedIn PDF, IG) | ✅ carousel pack | tone + brand score, hook variants |
| Social posts (all sizes) | ✅ social-post pack | variants, platform copy, AI label |
| **Pitch / sales deck, webinar slides** | — | **presentation pack** → PDF + editable PPTX + speaker notes |
| **One-pager, sales sheet, case study, datasheet** | — | **document pack** → print-ready PDF (A4 / Letter) |
| **Ebook / whitepaper / lead magnet / report** | — | document pack, long mode: cover, TOC, chapters, charts, CTA pages |
| **Static ads** (Meta, LinkedIn, Google Display, X) | — | **ad-set pack**: every IAB/social size × 3–10 hook variants |
| **Email / newsletter** | — | **email pack**: responsive HTML (tested table layout) + plain text + subject/preview variants |
| **Landing-page sections** | — | **landing pack**: hero, features, proof, pricing, FAQ, CTA → HTML/CSS + previews |
| **Posters, banners, roll-ups, event signage** | — | **print pack**: print sizes with bleed and crop marks, CMYK-safe colours |
| Infographics (static + animated) | ✅ | tone, data sourcing |
| Thumbnails, cards, OG images | ✅ | — |
| Launch copy, calendar, campaign hub | ✅ | per-channel voice, trend-aware calendar |
| Videos: tours, reels, films, explainers, YouTube | ✅ | realistic B-roll, UGC presenter, hook cuts |
| **Realistic images** (lifestyle, product in hand, people) | — | `gen` service: hero images for every material above |

## Backlog (ranked by impact ÷ effort)

### A. Shared brain (every material)

1. **Tone & Voice profile** — sliders (formal↔casual, serious↔playful,
   reserved↔bold, technical↔simple, humour), personality words, reading
   level, person, do/don't, lexicon (preferred + banned), emoji / hashtag /
   CTA policy, claims rules, locale, per-channel overrides. Learned from
   sample texts or URLs. Lives with the brand kit; every pack reads it.
2. **Brand score** — after each asset: banned terms, claims without a
   source, reading level, slider drift → % and a "fix it" rewrite (QA service).
3. **Hook variants** — 5–10 hooks per asset (pain POV, open loop,
   before/after, stat, contrarian) for posts, ads, emails and video cuts.
4. **Platform-native export** — TikTok / Reels / Shorts / LinkedIn / X /
   Meta ads / Google Display presets: sizes, safe zones (2026), lengths,
   caption placement, per-platform copy, hashtags, AI-label flag.

### B. New materials

5. **Document pack** (stills `document` kind) — page system for A4 / Letter:
   cover, section, two-column body, pull quote, stat row, chart, table,
   testimonial, CTA/back page; one-pager, sales sheet, case study, datasheet,
   ebook / whitepaper (TOC, page numbers, running heads). PDF with real text.
6. **Presentation pack** (stills `slides` kind) — 16:9 master with title,
   agenda, problem, solution, product shot, metric, comparison, timeline,
   team, quote, pricing, CTA layouts; PDF + PPTX (editable text boxes, images,
   speaker notes) written by our own OOXML writer.
7. **Ad-set pack** — one concept → every size (1080², 1080×1350, 1080×1920,
   1200×628, 300×250, 728×90, 160×600, 320×50, 970×250) × hook variants;
   text-ratio and safe-zone checks; naming that matches ad managers.
8. **Email pack** — table-based responsive HTML that survives Gmail/Outlook,
   dark-mode safe, inline CSS, alt text; plain-text twin; 5 subject + preview
   variants; launch, newsletter, nurture sequence (3–5 mails).
9. **Landing pack** — semantic HTML/CSS sections in the brand kit (hero,
   logos, features, how-it-works, testimonials, pricing, FAQ, CTA), responsive,
   plus desktop/mobile previews; copy follows the voice profile.
10. **Print pack** — poster (A3/A2/18×24"), roll-up (850×2000 mm), banner,
    flyer; 3 mm bleed, crop marks, 300 dpi images, print PDF.

### C. Realistic people and products

11. **`services/gen` (:4324)** — one generation service with adapters
    (`fal`, `replicate`, `comfyui`, `mflux`, `fake`), a model registry
    (capability, inputs, limits, licence + `commercialOK`, hardware, price,
    quality, prompt style), a router (fit × quality ÷ cost under a budget
    cap; an explicit model wins), content-hash cache, cost estimate before
    submit, spend cap per campaign. `media.mjs gen` becomes a thin client.
12. **Shot compiler** — 5-slot shot schema + camera/lens/light presets +
    per-model templates and word budgets. Packs write shots, not prompts.
13. **Hero-frame → motion** — the still first (real product cut-out, brand
    colours), then image→video with the frame pinned.
14. **Cast & product kits** — reference packs per synthetic actor and per
    product (BiRefNet cut-out); optional LoRA; reused across campaigns.
15. **UGC / presenter pack** — script → voice → portrait → InfiniteTalk
    (or Wan-S2V) talking clip, intercut with product screens and B-roll;
    "AI actor" disclosure built in.
16. **Finishing** — SeedVR2 / ESRGAN upscale, relight, background removal.
17. **Storyboard takes** — contact sheet of hero frames, 2–3 takes per
    shot, price per shot and total; approve, swap or regenerate one.

### D. Research for marketers

18. **Weekly trend brief** — HN + YouTube search + Claude web search for the
    product's niche → trending formats, hooks and topics mapped to
    ready-to-make briefs.
19. **Competitor teardown** — pasted ad links or screenshots → hook,
    structure, offer, CTA → "make ours" briefs.
20. **Compliance & disclosure** — C2PA / XMP "AI-generated" metadata,
    on-screen label for synthetic humans, claims check, consent record for
    any real face or cloned voice (otherwise refused).

### E. Carried over

21. ✅ Supervisor: no duplicate restarts, waits out taken ports.
22. ✅ Content prompts pick "Anything" more reliably.
23. Stock: real downloads in the "Anything" pack; footage cut to the beat.
24. ElevenLabs: voice per brand profile; credit counter in Setup.

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
- **Golden eval set** — 12 briefs across materials: SaaS pitch deck, B2B
  case-study PDF, ebook, LinkedIn carousel, Meta ad set, launch email,
  landing sections, event poster, DTC product-in-hand image set, UGC video
  ad, founder video, travel film. Each run produces a contact sheet; a
  vision-model judge scores realism, product fidelity, brand fit, hook
  strength, layout (alignment, hierarchy, overflow), text legibility and
  artefacts (hands, faces, morphing) 1–5; documents also pass a PDF check
  (fonts embedded, text selectable, page size, bleed) and emails an HTML
  check (inline CSS, width ≤ 640, alt text, link count); a
  person reviews the sheet. A release needs ≥4.0 average and no 1s.
- **Regression**: the existing 47 tests stay green; showcase campaigns
  (SiGMMa, Veracy) re-render unchanged.

## Order of work

1. Tone & Voice profile + brand score (A1, A2) — every later pack uses it.
2. Document pack (B5) and presentation pack with PPTX (B6).
3. Ad-set pack with hook variants and platform export (B7, A3, A4).
4. Email pack (B8) and landing pack (B9); print pack (B10).
5. Trend brief + competitor teardown (D18, D19).
6. `gen` service with fake + local adapters, shot compiler, cast/product kits,
   finishing, storyboard takes (C11–C17), compliance (D20).
7. fal key → live smoke, UGC/presenter pack, golden eval run, README and
   CHANGELOG, release.

## Needs from you

- A **fal.ai** key with a spend cap (best realism per dollar; covers Kling,
  Seedance, Wan, LTX, Qwen, FLUX, InfiniteTalk, SeedVR2). Replicate optional.
- A budget per test run (suggested: ≤ $5 per golden brief, ≤ $50 for the
  whole eval).
- Optional: an NVIDIA GPU box for ComfyUI if you want the open models run
  self-hosted instead of through fal.
