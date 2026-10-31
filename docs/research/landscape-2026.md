# Shipcast industry research: how to get from POC to best-in-class quality (Oct 2026)

**Method.** I ran about 45 web searches and fetches, mostly against GitHub, official docs and pricing pages. I checked licenses, star counts and last-push dates for about 120 repos directly through the GitHub API on 2026-10-31. I also read the Shipcast repo's `docs/ARCHITECTURE.md` and its `packs/*` files, so the recommendations build on what is already there. Anything marked **[unverified]** comes from secondary sources or from my own knowledge and was not confirmed against a primary source in this session.

---

## 1. Industry landscape (A–H)

### A. Motion graphics and animated explainers
| Product | What defines it in 2026 | Price |
|---|---|---|
| **Jitter** | Browser canvas, Figma (and Figma Draw) import, animation presets, custom easings, text effects (Mar 2026), image-to-video, shaders. Exports 4K MP4, GIF and Lottie JSON (Lottie on paid plans) ([toolradar](https://toolradar.com/tools/jitter), [autoae](https://autoae.online/blog/jitter-vs-autoae-2026)) | Free (720p, watermark); $12 per editor per month |
| **Rive** | State machines (interactive logic), tiny `.riv` runtime files. Exports H.264, WebM, GIF and PNG sequences. Runtimes are MIT ([Rive runtimes](https://rive.app/docs/runtimes)) | Editor $0, $9, $32, $120 per seat ([makerstack](https://makerstack.co/reviews/rive-review/)) |
| **Canva** | "Creative OS", Video 2.0 with a redesigned timeline, *Magic Video* auto-assembly, Magic Grab/Expand, brand kits, Affinity now free ([fonearena](https://www.fonearena.com/blog/?p=467703), [interviewkickstart](https://interviewkickstart.com/ai-for-all/canva-ai-features)) | Freemium |
| **Fable** | **[unverified]**: I could not confirm its current product state |
| **Creatomate / Shotstack** | Template plus JSON API (covered in §4) | $54 for 2,000 credits / $39 for 200 minutes |

Best in class here means four things: a brand kit feeds every scene automatically; named easing and text-animation presets; a design-tool import path (Figma); and multi-format export (MP4, alpha WebM/MOV, GIF, Lottie).

The format trending right now is **kinetic typography plus UI "fake-screen" animation**: rebuilt product UI rather than screen recordings, with stat count-ups, animated charts, logo stings and animated tweet or headline cards. The HyperFrames `motion-graphics` skill lists exactly this taxonomy.

### B. Product launch, promo and demo videos
- **HeyGen**: Avatar IV/V and a "Video Agent" at 20 credits per minute. The $29 Creator plan gives about 30 minutes of Avatar IV a month. **Synthesia**: $29 a month for 10 minutes, $89 for 30 minutes plus API access, and custom avatars cost $1k a year ([creatify comparison](https://creatify.ai/blog/heygen-vs-synthesia-(2026)-pricing-avatars-and-which-one-fits-your-team)).
- **Screen Studio** ($29/mo): auto-zoom on clicks, smoothed cursor, padded wallpaper backgrounds. Its look ("zoom-to-click, soft shadow, gradient background") is now the default visual grammar for SaaS demos. **Arcade** (from $50 per seat, Growth plan) and **Supademo** make clickable interactive demos that also export to video or GIF ([trainn](https://trainn.co/blog/arcade-vs-screen-studio/), [supademo](https://supademo.com/blog/screen-studio-alternatives)).
- **InVideo AI** ($25/mo, 50 AI minutes) and **Pictory** ($29/mo) go from prompt or script to a stock-footage video with voiceover ([aitoolsatlas](https://aitoolsatlas.ai/tools/invideo-ai)).

What people pay for in this category: (1) footage that looks like the real product, with zoom and cursor polish; (2) narration that sounds human; (3) on-brand typography; (4) one master edit that ships in 16:9, 1:1 and 9:16; (5) speed, meaning minutes rather than days.

Common launch-video structures:
- 30–60 s **hook → problem → reveal → 3 feature beats → social proof → CTA/logo lockup**.
- The 15 s teaser.
- "Release notes" changelog reels.

### C. Short-form vertical (Reels, Shorts, TikTok, Stories)
- **Submagic** ($19/$39): 35+ animated caption styles, including **Hormozi** (heavy uppercase sans, the active word highlighted in yellow or green, emojis), **MrBeast/Beast** (bold stroked text, pop-in) and **Ali Abdaal** styles. Also 48 languages, keyword highlight, emoji insertion, magic B-roll, silence removal and eye-contact correction ([toolsforhumans](https://www.toolsforhumans.ai/ai-tools/submagic), [fluxnote](https://fluxnote.io/guides/submagic-pricing-2026)).
- **OpusClip** (from $15): ClipAnything, a multimodal clip finder for clips up to 15 min. A 0–99 *Virality Score* built from hook, flow, value and trend. Auto-reframe with speaker and object tracking, B-roll and AI voiceover ([tooliverse](https://tooliverse.ai/tools/opusclip), [aitoolsatlas](https://aitoolsatlas.ai/tools/opusclip/pricing)).
- **Captions.app (Mirage)**: AI editing of raw footage plus generated faceless videos ([captions.ai](https://www.captions.ai/features/faceless-video-ai-generator)).

The canonical caption styles to support are:
1. Karaoke word highlight (the active word changes color).
2. Word-by-word pop with scale overshoot.
3. Hormozi: 2–3 word chunks, uppercase, color on keywords, emoji.
4. Beast: thick stroke and drop shadow, bounce.
5. Clean or "Apple" style: sentence case, subtle fade.
6. Boxed or highlighter background.
7. Behind-subject text (needs segmentation).
8. Typewriter.

Animated styles reportedly lift watch time 15–25% over static captions, at some cost to readability ([dev.to/clamper](https://dev.to/clamper_ai/how-ai-caption-styles-affect-watch-time-and-engagement-409i), **[unverified study]**).

### D. LinkedIn carousels, document posts and single-image posts
- **Taplio**: AI trained on 500M+ posts, a viral library of 4M+ posts, and a link-to-carousel feature. $39 a month with no AI, $65 with AI ([supergrow](https://www.supergrow.ai/blog/taplio-review)).
- **PostNitro**: AI carousels with scheduling and an API, publishing to LinkedIn, IG, TikTok, X and Threads, with team workspaces. **Contentdrips**: personal-branding auto-fill (name and avatar on every slide) and style matching from your own images. **aiCarousels**: fast and single-user ([postnitro compare](https://postnitro.ai/compare/aicarousels), [contentin](https://contentin.io/blog/best-linkedin-carousel-generators/)).
- On performance, document (PDF) posts average about 6.6% engagement, the highest of any format. Native video is up 36% YoY, while overall reach is down about 50% in 2026 ([dataslayer](https://dataslayer.ai/blog/linkedin-algorithm-february-2026-whats-working-now)). Some argue carousels are losing their edge ([reeset substack](https://reeset.substack.com/p/linkedins-2026-algorithm-shift-why)).

Proven carousel structure:
- **6–10 slides**, one idea per slide ([oktopost](https://www.oktopost.com/blog/linkedin-carousel-pdf-best-practices/), [decktopus](https://www.decktopus.com/blog/linkedin-carousel-best-practices)).
- Slide 1 is the hook: a bold claim or number, and a "swipe →" affordance.
- Slide 2 is the stakes or problem. Slides 3–N are a numbered framework or steps. N-1 is a recap or cheat sheet. N is the author card plus a single CTA.
- Common angles: listicle, before/after, myth vs fact, framework, teardown, "how we built X". Shipcast's pack already has six angles.

### E. YouTube thumbnails and social cards or banners
- **Bannerbear** ($49 for 1,000 credits): image, video and PDF templates, background removal, face detection, Lottie layers, auto subtitles. **Placid** (from $19) is cheaper for plain images ([bannerbear blog](https://www.bannerbear.com/blog/bannerbear-vs-placid/)).
- YouTube **Test & Compare** tests up to 3 thumbnails, and since Dec 2025 also titles or title-plus-thumbnail combos. The winner is chosen by **watch-time share**, not CTR, over up to 14 days ([influencermarketinghub](https://influencermarketinghub.com/youtube-test-compare/), [ppc.land](https://ppc.land/youtube-expands-a-b-testing-to-include-titles-alongside-thumbnails/)). Shipcast should ship 3 variants per video by default.
- Thumbnail rules:
  - One focal subject, ideally a face with a high-arousal emotion.
  - 0–4 words that complement the title rather than repeat it.
  - Extreme contrast, 2–3 saturated colors.
  - Keep key elements in the center 70%, and keep the bottom-right clear because the duration badge sits there.
  - It must read at 160 px wide.
  - Sources: [thumbnailtest](https://thumbnailtest.com/guides/youtube-thumbnail-explained/), [vidIQ](https://vidiq.com/blog/post/youtube-thumbnail-tips/), [quso](https://quso.ai/blog/youtube-thumbnail-size).

### F. Instagram and LinkedIn stories
These are mostly static or short-animated 9:16 cards with polls or link stickers. The quality bar is safe zones (see §5), a large type scale, and 3–5 frame sequences. No dedicated leader stands out. Canva, Bannerbear and Creatomate templates dominate.

### G. Copywriting
- **Taplio** and **Typefully** ($8–$39; AI from the $19 tier) for X and LinkedIn ([aiproductivity](https://aiproductivity.ai/pricing/typefully/)).
- The differentiators are voice cloning from past posts, hook libraries, per-channel formatting (LinkedIn line breaks with the hook above the "…see more" fold of about 210 chars **[unverified]**; X 280 chars or threads; YouTube title ≤60 chars plus description chapters), and "humanizer" passes that strip AI tells.

### H. Audio
Commercial tools bundle stock music libraries (Epidemic, Artlist), AI voice (ElevenLabs) and auto-ducking. The platform norm is **-14 LUFS integrated and -1 dBTP** across YouTube, TikTok, IG, FB, X and LinkedIn ([forasoft](https://www.forasoft.com/learn/audio-for-video/articles-audio/lufs-targets-per-platform-2026), [opus](https://opus.pro/blog/best-loudness-normalizers)).

---

## 2. Open-source building blocks (licenses checked via the GitHub API on 2026-10-31)

Legend: ✅ permissive or compatible with MIT Shipcast · ⚠️ conditions apply · ❌ avoid as a bundled dependency (non-commercial, AGPL, or revenue-gated)

### Programmatic video
| Project | License | Notes |
|---|---|---|
| **heygen-com/hyperframes** | ✅ Apache-2.0 (76k★, active today) | HTML, CSS and seekable animation, rendered deterministically to MP4 through headless Chrome and FFmpeg. About 450 registry blocks. Skills plus CLI (`preview`, `render`, `beats`, `transcribe`, `tts`, `remove-background`, `snapshot`, `compare`) ([repo](https://github.com/heygen-com/hyperframes)) |
| remotion-dev/remotion | ❌/⚠️ Source-available "Remotion License". Free for individuals and companies of up to 3 people, otherwise a Company License from $25 per seat per month or $0.01 per render (Automators, $100 minimum) ([license](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md), [pricing](https://www.remotion.dev/docs/license/pricing)) | Don't make it core. Your users' companies would inherit the obligation |
| motion-canvas/motion-canvas | ✅ MIT (19.6k★) | Editor-centric |
| redotvideo/revideo | ✅ MIT (4.2k★) | Headless Motion Canvas fork |
| ManimCommunity/manim / 3b1b/manim | ✅ MIT | Math and diagram explainers |
| mifi/editly | ✅ MIT, but **stale** (last push May 2025) | |
| mltframework/mlt | ⚠️ LGPL-2.1 | Fine as an external binary |
| Vanilagy/mediabunny | ⚠️ MPL-2.0 (file-level copyleft, OK as a dependency) | Pure TS mux and demux, WebCodecs |
| FFmpeg | ⚠️ LGPL, or GPL with x264 | Don't bundle it; detect the system binary (Shipcast already does via `doctor`) |

### Animation formats
- **lottie-web** ✅ MIT, but last pushed Sep 2025. **dotlottie-web** and **dotlottie-rs** ✅ MIT and active, so prefer dotLottie.
- **Rive** runtimes (`rive-wasm`, `rive-runtime`) ✅ MIT. The editor is proprietary.
- **GSAP** ⚠️ The *Standard "No Charge" License*. It has been 100% free, including all former Club plugins (SplitText, MorphSVG), for commercial use since 30 Apr 2025 ([Webflow](https://webflow.com/blog/gsap-becomes-free)). But it is **not OSI** and has a *Prohibited Uses* clause: you may not use it in tools whose visual, no-code animation building "competes with Webflow" ([gsap.com/standard-license](https://gsap.com/standard-license/)). An AI content studio is arguably not a Webflow-style visual animation builder, but **don't vendor GSAP into the repo**. Install it from npm, document the license, and keep a CSS/WAAPI or Anime.js fallback (HyperFrames supports seven runtime adapters).

### Image and design rendering (stills, cards, PDFs)
| Project | License |
|---|---|
| vercel/satori (JSX to SVG, flexbox only) | ⚠️ MPL-2.0 (fine as a dependency) |
| linebender/resvg | ✅ Apache-2.0 |
| **kane50613/takumi** (Rust JSX/HTML to PNG/WebP, flex, grid and block, 2–10× faster than Satori+resvg, no browser) ([vercel community](https://community.vercel.com/t/takumi-rust-based-jsx-to-image-rendering-engine-inspired-by-satori/34499)) | ✅ Apache-2.0 |
| vercel/og-image | archived, so don't use it |
| Polotno SDK | ❌ Commercial: free for non-commercial use only, $899/mo self-serve ([polotno](https://polotno.com/sdk/pricing/self-serve)) |
| lovell/sharp | ✅ Apache-2.0 |
| pdf-lib / pdfkit | ✅ MIT |
| puppeteer / playwright | ✅ Apache-2.0 |
| devices.css (picturepan2, marvelapp) for CSS device mockups | ✅ MIT (stale but static CSS) |
| Fonts: fontsource (MIT), Inter (OFL-1.1); icons: tabler (MIT), simple-icons (CC0; brand trademarks still apply) | ✅ |

### Screen recording and "Screen Studio" alternatives
- **siddharthvaddem/openscreen**: ✅ MIT (40k★). Auto-zoom with easing, cursor smoothing and click effects, backgrounds, motion blur, offline captions, built on Electron and PixiJS. It was **archived on 2026-10-17**, so treat it as a reference implementation to port ideas from, not a dependency.
- **CapSoftware/Cap**: ❌ AGPL-3.0 except the `cap-camera*` and `scap-*` crates, which are MIT. **webadderall/Recordly**: ❌ AGPL-3.0 plus an attribution requirement.
- Recommendation: build scripted capture in Shipcast itself. Use Playwright with a recorded cursor path and click timestamps, then do the zoom and cursor rendering in HyperFrames keyframes. That way it stays deterministic and re-renderable.

### TTS (code license vs. **weights** license)
| Model | Code | Weights | Verdict |
|---|---|---|---|
| **Kokoro-82M** | Apache-2.0 | ✅ Apache-2.0, 8 langs, 54 voices, 24 kHz ([HF](https://huggingface.co/hexgrad/Kokoro-82M)). TTS Arena Elo about 1056, #32 ([offlinetts](https://offlinetts.com/blog/tts-arena-leaderboard-2026/)) | Keep as the fast default |
| **Chatterbox** (resemble-ai) | MIT | ✅ MIT (emotion exaggeration control, cloning) | Adopt as the "expressive" tier |
| **Qwen3-TTS** | Apache-2.0 | ✅ Apache-2.0 (voice design from text, cloning, 1.7B) | Adopt, needs a GPU |
| Dia (nari-labs) | Apache-2.0 | ✅ Apache-2.0 (dialogue) | Optional |
| Sesame CSM-1B | Apache-2.0 | ⚠️ Apache-2.0 per card, but there is an open question whether the Llama license applies ([HF discussion](https://huggingface.co/sesame/csm-1b/discussions/2)) | Skip |
| Orpheus | Apache-2.0 | ⚠️ Llama 3.2 Community License | Optional, user opt-in |
| kyutai pocket-tts / DSM | MIT / Apache-2.0 | ✅ **[weights license unverified]** | Watch (CPU-friendly) |
| microsoft/VibeVoice | MIT | ⚠️ **[unverified]**: Microsoft restricted the TTS release after misuse reports | Skip |
| Piper | rhasspy/piper MIT (archived); successor OHF-Voice/piper1-gpl is ❌ GPL-3.0; voices are licensed per voice | Skip |
| F5-TTS | MIT | ❌ CC-BY-NC-4.0 (Emilia data) ([vantaige](https://vantaige.io/ai-tool/f5-tts)) | Avoid |
| XTTS-v2 (Coqui / idiap fork, MPL-2.0 code) | MPL-2.0 | ❌ Coqui Public Model License, non-commercial **[from knowledge]** | Avoid |
| Fish-Speech | — | ❌ Fish Audio Community License (revenue threshold; hosted service needs a deal) | Avoid |
| IndexTTS2 | — | ❌ bilibili Model Use License | Avoid |
| NeuTTS Air | — | ❌ NeuTTS Open License (revenue-gated) | Avoid |

### Music generation
- **ACE-Step 1.5**: ✅ MIT. It runs in under 4 GB of VRAM, takes under 10 s per song on a 3090, and was trained on royalty-free data. Quality sits between Suno v4.5 and v5 ([AMD blog](https://www.amd.com/en/blogs/2026/commercial-grade-ai-music-generation-on-amd-ryzen-ai-and-radeon-ace-step-1-5.html)). **Adopt it.**
- YuE: Apache-2.0 code, for full songs with vocals. It is heavy. **[weights license unverified]**
- MusicGen (audiocraft): MIT code, ❌ **CC-BY-NC-4.0 weights**.
- Stable Audio Open: ⚠️ Stability Community License, free below $1M revenue, not OSI ([search summary](https://stability.ai/news/stable-audio-open-research-paper)). Offer it only as user opt-in.

### Royalty-free music and SFX for offline use
- **Kenney audio**: ✅ CC0. You can bundle it ([cinevva](https://app.cinevva.com/guides/free-sound-effects-music), [opengameart CC0](https://opengameart.org/content/cc0-sounds-library)).
- **Sonniss GameAudioGDC bundles**: about 200 GB, royalty-free, no attribution. ⚠️ Repackaging them inside another distributed library is likely not allowed **[unverified]**, so offer a "download the bundle" helper rather than bundling.
- Pixabay: ⚠️ use is fine, but **standalone redistribution is prohibited** ([Pixabay terms](https://pixabay.com/service/terms/)), so you can't ship a Pixabay pack.
- Free Music Archive: licensed per track, often CC-BY or CC-BY-NC, so filter per track. Incompetech (Kevin MacLeod): CC-BY, so auto-insert the credit line ([incompetech FAQ](https://incompetech.com/music/royalty-free/faq.html)).
- Beat detection: **librosa** ✅ ISC; aubio ❌ GPL-3.0; essentia ❌ AGPL. HyperFrames also has a `beats` CLI command.

### ASR, captions and word alignment
- **whisper.cpp** ✅ MIT (54.8k★). DTW word timestamps are usable but loose.
- **faster-whisper** ✅ MIT.
- **WhisperX** ✅ BSD-2. wav2vec2 forced alignment gets under 100 ms word boundaries, which is good enough for karaoke ([forasoft](https://www.forasoft.com/learn/ai-for-video-engineering/articles-ai/whisperx-diarization-word-level-timestamps)). Per-language alignment model licenses **[unverified]**.
- **stable-ts** ✅ MIT, for alignment of a *known* script. This is ideal, because Shipcast already knows the TTS script.
- whisper-timestamped ❌ AGPL. sherpa-onnx ✅ Apache-2.0. libass ✅ ISC, for ASS subtitle burn-in.

### Background removal, segmentation and upscaling
- rembg ✅ MIT; BiRefNet ✅ MIT; BEN2 ✅ MIT; SAM2 ✅ Apache-2.0 (behind-subject captions).
- BRIA RMBG-2.0 ❌ CC-BY-NC **[from knowledge]**.
- Real-ESRGAN ✅ BSD-3. upscayl ❌ AGPL. chaiNNer ❌ GPL-3.

### Local image generation
- ✅ FLUX.1 [schnell] Apache-2.0; ✅ FLUX.2 [klein] 4B Apache-2.0; ✅ Z-Image-Turbo Apache-2.0 ([localaimaster](https://localaimaster.com/blog/best-local-image-models-compared)).
- ⚠️ SDXL CRAIL++-M **[from knowledge]**. ❌ FLUX.1 [dev] (non-commercial).
- ComfyUI ❌ GPL-3.0. That is fine as a separately installed process called over HTTP, never vendored.

---

## 3. Claude Code and agent-skills ecosystem for content

| Repo | License | What it does well |
|---|---|---|
| **heygen-com/hyperframes** skills (`hyperframes`, `-core`, `-animation`, `-creative`, `-keyframes`, `-audio`, `-registry`, `-cli`, `media-use`, `product-launch-video`, `faceless-explainer`, `motion-graphics`, `pr-to-video`, `embedded-captions`, `slideshow`, `music-to-video`) | ✅ Apache-2.0 | Covers the whole video stack: deterministic-render rules, 24 named text effects, scene blueprints, audio mixing (`<hf-audio-group>`, ducking, EQ and compressor), registry search. This is already Shipcast's engine. |
| [anthropics/skills](https://github.com/anthropics/skills) (185k★) | Mixed. `canvas-design`, `algorithmic-art`, `theme-factory`, `brand-guidelines` and `slack-gif-creator` are ✅ Apache-2.0. `docx`, `pptx`, `pdf` and `xlsx` are ❌ "© Anthropic, all rights reserved" (verified from the LICENSE.txt files) | `canvas-design` and `theme-factory` work for poster or card aesthetics. `slack-gif-creator` shows a GIF pipeline. |
| [greensock/gsap-skills](https://github.com/greensock/gsap-skills) (17.6k★) | ✅ MIT | Official GSAP usage rules: timelines, ScrollTrigger, SplitText |
| [LottieFiles/motion-design-skill](https://github.com/LottieFiles/motion-design-skill) (2.6k★) | ✅ MIT | Timing, easing, choreography and Disney principles for agents. Good to load next to HyperFrames. |
| [remotion-dev/skills](https://github.com/remotion-dev/skills) (5.9k★) | ⚠️ No LICENSE file, and the Remotion license applies to output use | 12 skills (best-practices, captions, render, maps, saas…). Useful as a *reference* only. |
| [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) (57.5k★) | ✅ MIT | 36+ skills: copywriting, social-content, launch strategy, CRO, ads, email. The strongest copy layer for (G). |
| [charlie947/social-media-skills](https://github.com/charlie947/social-media-skills) (4.5k★) | ✅ MIT | 16 skills built on a shared `about-me.md`/`voice.md` voice foundation across LinkedIn, IG, X and YouTube. The right pattern for voice consistency. |
| [digitalsamba/claude-code-video-toolkit](https://github.com/digitalsamba/claude-code-video-toolkit) (2.4k★) | ✅ MIT | End-to-end narrate, score, generate, compose, render. Uses Qwen3-TTS, FLUX.2 and ACE-Step (it validates the same model choices), but needs a cloud GPU (Modal). |
| [browser-use/video-use](https://github.com/browser-use/video-use) (30k★) | ✅ MIT | Agent-driven editing of existing footage, with -14 LUFS, -1 dBTP and LRA 11 normalization targets |
| [nexu-io/open-design](https://github.com/nexu-io/open-design) (105k★) and [motion-anything](https://github.com/nexu-io/motion-anything) | ✅ Apache-2.0 | Local-first design agent workspace and a chat-native motion layer. Worth mining for design-QA prompts. |
| [vercel-labs/skills](https://github.com/vercel-labs/skills) (`npx skills`) | ✅ MIT | The installer Shipcast already uses for engine skills |
| calesthio/OpenMontage (73.6k★) | ❌ AGPL-3.0 | 12 agentic video pipelines. Study it, don't copy code. |
| aabrole/claude-video-thumbnail-skill | ✅ MIT (2★) | 4 thumbnail concepts, asks 16:9 vs 9:16 first. Small, but a useful pattern. |
| inference-sh/skills (carousel, thumbnail) | No license, cloud-API dependent | Skip |
| skills.sh directory | — | The Remotion skill is reportedly the #4 most-installed with 126k+ installs ([aividpipeline](https://aividpipeline.com/blog/remotion-agent-skills-guide-2026)). Video skills are the hottest category. |

Recommendation: install HyperFrames, gsap-skills, the Lottie motion-design skill and marketingskills as **engine skills**, the way you already do through the `skills` CLI, so their licenses stay with them. Write Shipcast-owned skills for carousel, thumbnails, brief and social-copy, borrowing the voice-file pattern from charlie947.

---

## 4. Architecture patterns and recommended decomposition

### What the SaaS players do
- **Shotstack**: a JSON *Edit* made of `timeline → tracks (layers) → clips {asset, start, length, transition, effect}`, plus `output {format, resolution, aspectRatio, fps}`, plus `merge: [{find, replace}]` for `{{FIELD}}` placeholders. Templates are saved Edits ([core concepts](https://shotstack.io/docs/guide/getting-started/core-concepts/)). Billing is per rendered minute ($39 for 200 minutes, $0.30/min PAYG) ([pricing](https://shotstack.io/pricing/)).
- **Creatomate**: *RenderScript* JSON (elements with keyframes and compositions), or a template ID plus `modifications` ([how-to](https://creatomate.com/how-to/programmatic-video-editing)).
- **Remotion Lambda**: splits the frame range into chunks (`framesPerLambda` or `concurrency`, at most 200 functions). Each chunk is encoded with a keyframe at its boundary, and stitching starts while rendering continues ([docs](https://www.remotion.dev/docs/lambda/rendermediaonlambda)).
- **Mux** **[from knowledge, not re-verified]**: upload, transcode to an ABR ladder, then *derived assets on demand by URL* (thumbnails and storyboards from timestamp params), with webhooks for state changes.
- Common to all of them: **(1) a declarative spec separate from the renderer**, **(2) async jobs with webhook or SSE progress**, **(3) content-addressed asset caching**, **(4) cheap preview vs. expensive final**, **(5) templates = spec + named variables**.

### Recommended decomposition for Shipcast
Keep the current "data dir is the bus" design. It is the right local-first choice: restartable, no DB server, and a second worker can share the folder. Add *capability services* behind the worker. Each one is an optional local HTTP sidecar on `127.0.0.1`. Docker is optional, and every service also runs with `node …` or `uv run …`.

```
web ──HTTP/SSE──► api ──fs──► ~/.shipcast (campaigns, jobs/, cache/, models/)
                                 ▲
worker (claude -p, packs) ───────┤── calls ──► render   (Node: HyperFrames, Chrome pool, FFmpeg)
                                 │             stills   (Node: Takumi → Chrome fallback, pdf-lib, sharp)
                                 │             media    (Python/uv: TTS, ASR+align, music, rembg, upscale)
                                 │             qa       (Node: lint + measure; no LLM)
                                 └── engine (shared lib: store, spec schema, presets, cache)
```

| Service | Responsibility | API sketch |
|---|---|---|
| **engine** (lib) | Spec schemas: `Storyboard`, `Scene`, `CaptionTrack`, `AudioMix`, `PlatformPreset`. `brand.json` to design tokens. Content-hash cache `cache/<sha256>/` | TS types plus JSON Schema, shared by all |
| **render** | Compile Storyboard to HyperFrames HTML (or let Claude author the HTML directly). `preview` = 540p at 15 fps or a contact sheet via `hyperframes snapshot`. `final` = full res, chunked across N Chrome workers, then FFmpeg concat | `POST /render {project, preset:"reels", quality:"preview"\|"final", range?}` → `{jobId}`; `GET /jobs/:id` SSE `{frame, total, eta}`; result `out/<preset>.mp4` |
| **stills** | Carousel slides, thumbnails, OG cards, banners, story frames, PDF assembly | `POST /stills {template, props, sizes:["1080x1350","1280x720"], format}`; `POST /pdf {pages:[png], meta}` |
| **media** | `tts` (Kokoro, Chatterbox, Qwen3), `asr` (whisper.cpp or faster-whisper), `align` (stable-ts or WhisperX, script-aware), `music` (ACE-Step), `sfx` (local CC0 index), `cutout` (BiRefNet), `upscale` (Real-ESRGAN), `image` (FLUX schnell / Z-Image, opt-in). A model manager downloads on first use, writes the license into a manifest, and refuses non-commercial weights unless the user opts in | `POST /tts {text, voice, engine, ssml?}` → `{wav, words:[{w,t0,t1}]}`; `POST /align {audio, text}`; `POST /music {prompt, bpm?, seconds, stems?}`; `GET /models` (with license field) |
| **qa** | Deterministic gates: safe-zone collision (DOM bounding boxes vs. the preset mask), text overflow, WCAG contrast, caption CPS and words per chunk, loudness (`ffmpeg ebur128`/`loudnorm` two-pass), black or frozen frames, duration and spec compliance per platform, file size. Emits a JSON report that is fed back to Claude for a self-fix loop, plus contact-sheet PNGs for vision critique | `POST /qa {artifact, preset}` → `{pass, issues:[{rule, severity, frame?, bbox?, fix}]}` |
| **job queue** | Keep the filesystem queue (`jobs/<id>.json` plus an atomic rename lock). Optionally use `node:sqlite` later. No Redis or BullMQ needed locally | — |

Caching and preview rules:
- Hash every TTS line, music prompt and still by its inputs, so revisions re-render only what changed.
- Render scenes independently and concat them, so editing scene 3 never re-renders scenes 1–2.
- Always show a preview (contact sheet plus a 540p proxy) before spending a final render or Claude turns.

Licensing hygiene: run GPL/AGPL tools (ComfyUI, FFmpeg GPL builds) only as user-installed external processes, and keep Shipcast's repo MIT-clean.

---

## 5. Quality techniques and platform specs

### Motion craft
- **Easing:**
  - Entrances use expo/quint-out, roughly `cubic-bezier(0.16,1,0.3,1)`.
  - Exits use ease-in, `cubic-bezier(0.7,0,0.84,0)`.
  - Moves and toggles use ease-in-out, `cubic-bezier(0.65,0,0.35,1)`.
  - Use spring or back-out with *small* overshoot (1.05–1.1) for pops.
  - Never use linear except for continuous drifts or Ken Burns.
  - Source: [impeccable motion-design ref](https://git.secluded.site/agent-skills/blob/main/vendor/impeccable/skill/reference/motion-design.md).
- **Durations at 30 fps:**
  - UI micro-moves 150–300 ms ([Material guidance via parachutedesign](https://parachutedesign.ca/blog/ux-animation/)).
  - In video, text entrances 300–600 ms, scene transitions 400–800 ms.
  - Hold every readable line at least 1 s plus 0.3 s per extra word.
- **Choreography:** stagger siblings by 40–80 ms, keep one hero motion per beat, move with overlap rather than in sequence, and use match cuts or whip transitions between scenes. Give everything a subtle secondary motion (1–2% drift or scale) so frames never feel dead.
- **Typography:**
  - At most 2 families.
  - Scale ratio of at least 1.333.
  - Headlines 80–140 px on a 1080-wide canvas; body text never below 36 px in video or 28 px on carousel slides **[practitioner heuristic]**.
  - Tight tracking on large display type, and 3–7 words per on-screen line.
- **Pacing:**
  - Hook within 0–1.5 s (motion plus a claim on frame 1, no logo intro).
  - Shot or beat changes every 1.5–3 s for short-form.
  - Snap cuts and hits to musical beats (librosa or `hyperframes beats`). Land SFX "whooshes" 2–4 frames *before* the visual hit.
- **Product shots:** rebuilt UI or a scripted capture; auto-zoom to 1.5–2.2× on the action with ease-in-out at 600–900 ms; a soft drop shadow and rounded window on a gradient (the Screen Studio grammar).
- **Encode:** H.264 High, yuv420p, `-movflags +faststart`, CRF 16–18, 30 fps (60 for UI scrolling), AAC 48 kHz. X requires ≤60 fps, H.264 High, AAC LC, progressive, mono or stereo ([docs.x.com](https://docs.x.com/x-api/media/quickstart/best-practices.md)).

### Captions
- **Words per chunk:** 3–5 for short-form.
- **Lines:** at most 2 lines and 32–42 characters per line.
- **Reading speed:** about 12–17 characters per second on mobile.
- **Display time:** at least 1 s and at most 6 s per caption.
- **Font:** 48–80 px sans at 1080 width, with a heavy stroke or shadow for contrast.
- **Position:** the lower-middle band, above the platform UI, roughly y = 1150–1400 on 1920.
- **Timing:** word timing from forced alignment. Because Shipcast knows the TTS script, align the known text rather than trusting ASR.
- Sources: [opus.pro](https://www.opus.pro/blog/video-captions-for-maximum-readability), [kineclip](https://kineclip.com/blog/caption-readability-checklist-short-videos-2026/).

### Audio mix
- **Master:** -14 LUFS integrated, -1 dBTP, LRA ≤11. Use two-pass `loudnorm` ([video-use](https://instagit.com/browser-use/video-use/social-media-loudness-normalization-targets/)).
- **Rules of thumb** (common practice, not a platform rule):
  - Voiceover about -16 to -14 LUFS short-term.
  - Music bed 12–18 dB under the VO while speech is present, sidechain-ducked with a 100–300 ms release.
  - SFX transients peaking at about -6 dBFS.
  - High-pass the VO at 80 Hz, de-ess, light compression (3:1).
  - A 0.5 s music fade-in and a 1–2 s tail on the logo lockup.

### Platform spec table (2026)
| Placement | Canvas (px) | Ratio | Length / limits | Safe zone (keep critical content inside) |
|---|---|---|---|---|
| **Instagram Reels** | 1080×1920 | 9:16 | up to 3 min ([planoly](https://planoly.com/blog/instagram-updates-jan-2025)); grid cover crops to 1080×1440 (3:4) | Meta: top 14% (**~269 px**), bottom 35% (**~672 px**), sides 6% (**~65 px**) ([adsuploader/Meta](https://adsuploader.com/blog/meta-ads-safe-zones)). Organic minimum is about 250 top and 250–450 bottom |
| **Instagram/FB Stories** | 1080×1920 | 9:16 | 60 s per card **[from knowledge]** | top 14% (**270 px**), bottom 20% (**380 px**) |
| **IG feed / carousel** | 1080×1350 (4:5) or 1080×1440 (3:4) | 4:5 / 3:4 | up to 20 slides **[from knowledge]** | Grid shows the 3:4 center crop |
| **TikTok** | 1080×1920 | 9:16 | 60 min upload, 10 min in-app; 4 GB mobile / 10 GB desktop ([argil](https://www.argil.ai/blog/how-long-can-youtube-shorts-be)) | top **~160**, bottom **~480**, right **~140**, left **~120** ([adkit](https://adkit.so/tools/safe-zones/tiktok), [spilno](https://spilnoagency.com.ua/en/instructions-us/tiktok-ads-creative-sizes-2026)) |
| **YouTube Shorts** | 1080×1920 | 9:16 (up to 1:1) | ≤3 min | Sources disagree: top 120–380, bottom 300–380, right 96–120 ([clipspeed](https://www.clipspeed.ai/blog/youtube-shorts-size.html), [adaptlypost](https://adaptlypost.com/blog/social-media-safe-zones-2026-complete-guide)). **Use a unified conservative mask** |
| **YouTube long-form** | 1920×1080 / 3840×2160 | 16:9 | — | Title-safe 90% |
| **YouTube thumbnail** | 1280×720 (design at 1920×1080) | 16:9 | ≤2 MB, JPG/PNG; Test & Compare 3 variants | center 70%; keep the bottom-right clear (timestamp) |
| **YouTube banner** | 2560×1440 | — | ≤6 MB | **1546×423** center ([havecamerawilltravel](https://havecamerawilltravel.com/youtube-banner-size/)) |
| **LinkedIn image** | 1080×1350 / 1200×1200 / 1200×627 | 4:5 / 1:1 / 1.91:1 | — | ~60 px margin |
| **LinkedIn document (carousel)** | 1080×1350 (or 1080×1080) per page | 4:5 | PDF ≤100 MB, ≤300 pages; 6–10 slides recommended ([trymypost](https://www.trymypost.com/blog/linkedin-pdf-carousel-specs)) | ~80 px margin; the title bar overlays the top on mobile **[unverified]** |
| **LinkedIn video** | 1080×1350 or 1080×1920 / 1920×1080 | 4:5, 9:16, 16:9 | 3 s–15 min, ≤5 GB ([postnitro](https://postnitro.ai/blog/post/linkedin-post-specs)) | captions are a must (sound-off) |
| **LinkedIn banner** | 1584×396 | 4:1 | ≤8 MB | the avatar covers the bottom-left |
| **X image** | 1600×900 or 1080×1350 **[ratio advice from knowledge]** | 16:9 / 4:5 | ≤5 MB (GIF ≤15 MB) | — |
| **X video** | 1280×720 / 720×1280 / 720×720 (API reference sizes) | 1:3–3:1 | 0.5 s–20 min (default), 125 min (Premium), 8 GB / 16 GB ([docs.x.com](https://docs.x.com/x-api/media/quickstart/best-practices.md)) | — |
| **X header** | 1500×500 | 3:1 | ≤2 MB | the avatar covers the bottom-left |
| **OG / link card** | 1200×630 | 1.91:1 | **[from knowledge]** | center 1000×500 |
| **Audio (all)** | — | — | **-14 LUFS, -1 dBTP** | — |

The Shorts safe-zone sources disagree with each other. Ship one **unified 9:16 mask** that covers all three platforms: top 270, bottom 672, left 65, right 140. A single 9:16 master is then safe everywhere.

---

## 6. Prioritized recommendation

**P0: quality gates and presets (largest quality lift, little new tech)**
1. A **`PlatformPreset` module** in `engine`, generated from the §5 table: canvas, fps, codecs, LUFS target, safe-zone mask and size limits. Every pack renders against presets, not ad-hoc sizes.
2. A **`qa` service** with deterministic linting: DOM bounding boxes vs. the safe-zone mask, text overflow, WCAG contrast, caption CPS and chunking, `ebur128` loudness, frozen or black frames, file size. Then a **critique loop**: write contact sheets plus the QA JSON, have Claude look at the frames and fix them, and allow at most 2 iterations. Today packs end when Claude says "done". Gating on measurable checks is what separates POC output from pro output.
3. A **finishing pass on every video**: two-pass `loudnorm` to -14 LUFS and -1 dBTP, `+faststart`, yuv420p. This is cheap and catches the most common amateur tells.

**P1: audio and captions (the most "felt" quality gaps)**
4. A **script-aware alignment** path: Kokoro or Chatterbox output plus the known script, through stable-ts (MIT) or WhisperX (BSD-2), giving word timings under 100 ms. Ship a **named caption style library** of 8 styles: karaoke, word-pop, Hormozi, Beast, clean, boxed, behind-subject (BiRefNet or SAM2), typewriter. Implement them as HyperFrames components, so the existing `captions` pack's four "looks" become a first-class picker shared by every short-form pack.
5. A **voice tiers** setting: Kokoro (fast, Apache), plus Chatterbox (MIT, expressive) and Qwen3-TTS (Apache, voice design) as an opt-in GPU tier. Hard-block F5, XTTS, Fish, IndexTTS and NeuTTS weights in the model manager.
6. **Music and SFX.** Use ACE-Step 1.5 (MIT) for brief-matched instrumental beds at a chosen BPM. Bundle a small curated **Kenney CC0 SFX kit** (whoosh, pop, click, riser, impact). Cut on beats with librosa or `hyperframes beats`. Use automatic VO ducking through HyperFrames `<hf-audio-group>`. Skip MusicGen and Stable Audio Open.

**P2: visual system and product footage**
7. **Brand tokens**: `brand.json` to CSS variables (type scale, palette roles, radii, motion tokens: easing names and durations) consumed by *all* packs, plus a named motion vocabulary from LottieFiles' motion-design skill and gsap-skills (both MIT).
8. **Scripted product capture**: Playwright drives the real site; record the cursor path and clicks; HyperFrames keyframes add auto-zoom, cursor smoothing and the window-on-gradient look; devices.css (MIT) adds mockups. Port ideas from OpenScreen (MIT, archived). Never take code from Cap or Recordly (AGPL).
9. A **Storyboard spec** (a Shotstack-like JSON of scenes, layers, timing, variables) that Claude writes *first*. Render it into a reviewable storyboard (thumbnails plus VO lines) before full authoring. Then render scenes independently with content-hash caching, so revisions re-render only changed scenes, and keep a 540p preview separate from the final render.

**P3: stills and copy**
10. A **stills service**: Takumi (Apache-2.0) for fast cards, thumbnails and banners, falling back to Chrome for complex CSS; pdf-lib for carousel PDFs. Thumbnails: BiRefNet cutout of a logo, product shot or face, a 3-variant default for YouTube Test & Compare, and a 160 px legibility check in QA. Optional local FLUX.1 schnell or Z-Image-Turbo (Apache) for backgrounds.
11. Rewrite the **carousel templates** around the 6–10 slide hook, framework, recap and CTA structure, with author-card personalization (Contentdrips' differentiator), and export a PDF plus a 4:5 MP4.
12. **Copy**: install `coreyhaines31/marketingskills` (MIT) as an engine skill and adopt the voice-file pattern from charlie947 (`voice.md` per user). Add per-channel formatters: LinkedIn fold-aware hook, X 280 chars or thread, YouTube title of 60 chars or fewer plus chapters, IG first line plus hashtags. Add a humanizer pass and A/B hook variants.

**Adopt (all permissive):** HyperFrames (Apache-2.0), dotLottie (MIT), Rive runtime (MIT), Takumi and resvg (Apache-2.0), sharp (Apache-2.0), pdf-lib (MIT), Playwright (Apache-2.0), Kokoro, Chatterbox and Qwen3-TTS (Apache-2.0/MIT), whisper.cpp, faster-whisper and stable-ts (MIT), WhisperX (BSD-2), ACE-Step 1.5 (MIT), librosa (ISC), BiRefNet and rembg (MIT), SAM2 (Apache-2.0), Real-ESRGAN (BSD-3), FLUX.1 schnell, FLUX.2 klein and Z-Image (Apache-2.0), Kenney CC0 SFX, libass (ISC).

**Use with care:** GSAP (free but non-OSI, with a Webflow-competition clause; install from npm, don't vendor); Satori and mediabunny (MPL-2.0, fine as dependencies); FFmpeg (detect the system binary).

**Avoid as dependencies:** Remotion (company license), Polotno (commercial), MusicGen and F5/XTTS/Fish/IndexTTS/NeuTTS weights, Stable Audio Open (revenue-gated), BRIA RMBG-2.0, FLUX.1 dev, and any AGPL or GPL code (Cap, Recordly, upscayl, whisper-timestamped, OpenMontage, aubio, essentia, ComfyUI, MinIO) unless it runs as a separately user-installed process.

Why this order: P0 and P1 fix what viewers notice first (audio levels, caption timing, elements under the platform UI, and overflowing text) using mostly tools Shipcast already has. P2 adds what the paid tools charge for (on-brand motion, a polished product look, cheap revisions). P3 brings the stills and copy packs up to the level of Taplio and PostNitro.