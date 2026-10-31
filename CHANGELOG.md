# Changelog

## 0.7.0 — 2026-11-01

Shipcast talks with you first, and videos get a voice and a face.

- **Brainstorm before a campaign** — when you give little to go on, Shipcast asks the 2–4 questions that change the work (audience, the one differentiator, what viewers should do next, tone), each with tappable answers tailored to your product, then offers three distinct creative directions. The chosen one and your answers steer the research and every deliverable. Skippable at every step; ~6 s per turn.
- **Animated presenter** — an original brand-coloured mascot for character-driven explainers: blinks, gestures (explain, wave, point, think, celebrate), mouth synced to the voiceover, speech bubble that lights up word by word.
- **Chatterbox voice (optional, local, MIT)** — a more natural free voice next to Kokoro and ElevenLabs, installed from Setup into its own environment; one warm worker serves every line; Kokoro is the fallback.
- **Variety guard** — a new storyboard that copies a recent video's structure gets one rewrite before it renders, so channels don't drift into the templated look platforms demonetise.

## 0.6.0 — 2026-11-01

Any length, edited like a creator, in your own voice if you want.

- **YouTube videos, 3–10 minutes** — chaptered storyboards: each chapter renders on its own (cached, so an edit re-renders one chapter), chapters join without re-encoding, one music bed and one master pass go over the whole video. Chapter cards, YouTube timestamps filled into the description, full SRT/VTT. New `youtube-video` skill: cold open, re-hooks every 60–90 s, peak at 50–70 %, varied visuals.
- **Shorts from a long video** — "Cut 3 Shorts" re-directs the strongest chapters natively for 9:16 (no crop, no Claude turn).
- **Short films** — `cinema` scene (letterbox, slow camera, grain, bokeh, a line that blurs into focus) and a `short-film` format with a real story arc.
- **Bring your own ElevenLabs** — connect your key in Setup → Voiceover; word timings come from ElevenLabs' alignment; Kokoro stays the free default and fallback.
- **Stock B-roll** — optional free Pexels key; `broll` scenes play real footage under a line, with credits.txt; without a key they become cinematic shots.
- **Editing** — punch-in zooms on the words that carry a line, soft hits and risers, alternating light scenes on dark brands, highlight and emoji caption styles.
- **Length control** on Home — 15/30/60 s for short videos, 3/5/8/10 min for YouTube.
- Renders that time out under load retry with a single worker.

## 0.5.0 — 2026-11-01

Save-worthy posts, videos with real energy, and a studio with fewer decisions.

- **Animated infographic posts** — the framework format that gets saved on LinkedIn. Four layouts (journey table, timeline, funnel, A-vs-B compare) and five looks (dotted board, night, hand-drawn sketch, editorial paper, glass). Dense cells with real platform logos and grouped chips, a cursor that tours and clicks each step, real author avatar and brand wordmark. Claude finds the idea and chooses the layout and look. GIF + MP4 + PNG + post text.
- **Video type fixed** — headlines were rendering at roughly half size (the fit pass measured scenes before they were mounted). Titles, statements, lists and charts now land at full size; stat numbers size to the frame.
- **New motion scenes** — `kinetic` (huge lines slam in on the beat), `logos` (the tools your audience juggles burst in and collapse into your product), `stack3d` (features as a 3D card stack). The storyboard skill asks for at least one per video.
- **Visual carousel layouts** — `platforms` (grouped real logos), `journey` (stage pills with logos), `note` (a hand-written sticky thought).
- **Studio** — Home is one input plus format tiles with real previews; projects are a live gallery; results open in a lightbox with Download, Copy post text and "Ask for changes" up front. Navigation is New, Projects and a status pill.
- **Logos** — one Iconify request per icon set with backoff; rate limits never poison the cache; dozens of dev-tool aliases.

## 0.4.0 — 2026-10-31

The studio, redesigned around one question.

- **Create**: one box ("What are you launching?") that detects website / repo / description, three goals (Launch kit, Social pack, Video only), and an optional *Customize* for individual formats, options and notes. Experimental formats are tucked away.
- **Project page**: a plain-language progress line ("Reel · rendering the video…"), a card showing what Shipcast learned (one-liner, brand colors, logo, screenshots), and a gallery where every result appears as it's ready.
- **Result drawer**: preview, Download, New version, *ask for changes* in plain words, plus Edit, Quality checks and Activity (with Claude's notes) for those who want them.
- **Library** with cover images; **Setup** merges accounts, local engines and preferences into one page; a top bar replaces the sidebar.
- New dark-first design system with light mode, uniform media cards, mobile layouts without sideways scrolling.
- Steps report plain-language phases (researching, writing the script, rendering, final review).

## 0.3.1 — 2026-10-31

- New scenes: typing **terminal** (command + streamed output) and animated **bar chart** for real benchmarks — the director picks them on its own for dev tools.
- **Animated carousels**: an MP4 version of every deck (push-ins, slide transitions, original bed, -14 LUFS), toggled in the format options or the slide editor.
- Format options the user picks are enforced on the spec, not left to the model.
- Transition overlay classes are namespaced so scene CSS can't collide with them.

## 0.3.0 — 2026-10-31

- **Music**: procedural, licence-free beds in 6 moods (uplifting, tech, chill, energetic, cinematic, playful); scene cuts snap to the beat; whoosh/impact/pop sound design on transitions and stats.
- **Director's review**: after a video passes QA, Claude reviews the rendered frames once and revises the storyboard if a human editor would (toggle in Settings).
- **Captions** studio format: upload a clip → transcription, word-timed captions (bold, pop, karaoke, boxed, clean, typewriter), optional hook title, mastered audio, QA — no Claude turn.
- **Live-site capture**: desktop, @2x phone and full-page screenshots with cookie-banner cleanup; phone-framed product scenes for vertical video.
- **Scene previews** in the editor (one frame per scene in ~20 s) and a music-mood picker.
- **Copy QA**: LinkedIn fold, X 280, YouTube title length, AI-cliché ban list, emoji cap — fixed in-session.
- **Reliability**: streamed PDF export, reusable self-healing Chrome tab, supervisor watchdog, contrast-solved accent tokens, readable captions on light footage.

## 0.2.0 — 2026-10-31

Rebuilt on a spec-and-services engine, grounded in [industry research](docs/research/landscape-2026.md).

### Services
- `render`, `stills`, `media`, `qa` capability services with a shared job API, supervised by `shipcast start` (or `docker compose up`).
- Storyboard compiler on HyperFrames: 10 original motion scenes (kinetic title, highlight statement, stat count-up, product zoom with cursor click, feature reveal, testimonial, before/after, page scroll, logo sting, CTA outro), 6 caption styles, 4 transitions, local fonts, poster first frame.
- Stills on a warm headless Chrome over raw DevTools: carousels (9 layouts × 4 themes), 4 thumbnail layouts, 5 card types, PDF export, auto-fit and layout audit.
- Media: Kokoro voice with script-aware word alignment, caption cues, sidechain-ducked mixing, two-pass loudness mastering; one-click voice setup.
- QA: platform presets, loudness, black/frozen detection, caption pace, plus HyperFrames layout/contrast/craft checks; findings go back to Claude (≤ 2 fix rounds).

### Studio
- Studio formats: Reel / Short, Launch Film, Feature Spotlight, Explainer, Carousel, Thumbnails & Cards — rendered in minutes, editable afterwards with no Claude run.
- Slide, graphics and scene editors; quality report per video; service health on Connections.

## 0.1.0 — 2026-10-31

First public release.

### Studio
- Paste a website, `owner/repo`, local folder or a written brief; pick formats or a bundle (Launch kit, Social week, Video only).
- Live run sheet with a feed of what Claude is doing, elapsed time, stop / retry / "make a new take", and revisions that resume the same session.
- Viewers for video, image sequences, PDFs, copy kits (per-post copy buttons) and the research brief (palette, fonts, logo, screenshots).
- Connections page: Claude Code and GitHub CLI sign-in without API keys, machine checks, one-click setup for local Kokoro voice and headless Chrome.
- Download everything as a zip; open the campaign folder.

### Formats
Launch Video, Product Promo, Explainer, Motion Graphics, Discovery Journey, Reel / Short, Changelog / PR Video, LinkedIn Carousel, Thumbnails & Cards, Launch Copy Kit, Talking-Head Captions.

Verified end to end on real sources: brief, carousel, copy kit, thumbnails, launch video, motion graphics, Discovery Journey, Reel / Short, Product Promo (Kokoro voice) and PR video. Explainer and Talking-Head Captions are built on the same engine but have not had a full real-world run yet.

### Architecture
- `web` (React + Vite), `api` (`node:http`, SSE), `worker` (queue loop) and `engine` (shared library); backend is dependency-free TypeScript run directly by Node 22.18+.
- The data dir (`~/.shipcast`) is the only shared state; any service can restart without losing work. Interrupted steps are requeued.
- Formats are folders (`pack.json` + `prompt.md`); third-party skills install from their own repos on first use.
