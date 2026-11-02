# Changelog

## Unreleased — sprint v6: Shipcast that gets better on its own

- **Background agents** — a new `agents` service runs scheduled jobs that wait for your own campaigns, stay out of quiet hours and share a daily cap of Claude runs; Setup → Background agents to switch them on or off, change how often they run, run now or pause.
- **Learning loop** — quality checks, the creative director's notes, brand-voice slips, eval scores and your revision notes become categorised incidents; repeat problems turn into short per-format lessons that go into that format's prompt, each on trial and kept only if its problem gets rarer. New **Learning** page.
- **Trend radar** — Hacker News, Reddit's marketing communities, Google Trends and YouTube, plus one web-search pass on your subscription, become evidence-backed trend cards that are merged over time. New **Trending** page with *Make one like this*.
- **Quality in the loop** — a critic scores every non-video piece at full size after its first clean render and the weakest fixable thing is fixed in the same session; video review sheets show each scene settled instead of mid-transition; nearly empty scenes go back as fixes; legibility is measured as UI text size on the canvas; crops that clip a card widen to show all of it.
- **Nightly quality check** — an opt-in project that re-makes two formats per run in rotation and scores them; *Quality over time* on the Learning page.
- **New formats** — TikTok/Instagram photo carousels, quote and testimonial cards, app store screenshot sets, Product Hunt launch kit.

## Unreleased — sprint v5: every marketing material

- **Brand voice** — learn a voice from your own copy or links; sliders, lexicon, claims and per-channel rules; every asset scored and fixed against it; *Check any copy* with one-click rewrite.
- **Presentation** — designed 16:9 decks as PDF and an editable PPTX (real text boxes over the design, speaker notes), written by Shipcast's own OOXML writer.
- **PDF documents** — one-pagers, sales sheets, case studies, datasheets, ebooks, whitepapers and reports with contents, running heads, SVG charts, tables and a per-page overflow / empty-page audit.
- **Ad sets** — hook variants × 13 placement sizes with auto-fitting type, disclosure lines and an ads.csv upload sheet.
- **Email** — inbox-safe HTML (tables, inline styles, Outlook buttons, dark-mode hints), plain text, subject/preview variants, upload zip, and checks for Gmail clipping, spam phrasing, links and the postal address.
- **Landing pages** — responsive page, per-section snippets, copy deck, phone/desktop previews.
- **Print** — posters, flyers, roll-ups and booth banners with bleed and crop marks.
- **UGC ad** — a labelled synthetic presenter for hook and CTA, real screens in between, one voice throughout.
- **Trend brief and competitor teardown** — evidence-backed signals and original briefs; optional YouTube Data API key.
- **Gen service** — model registry with real prices and licences, router by tier, safety guard, budgets, cache, disclosure sidecars, free placeholder mode.
- **Zoomed screenshots** — `#crop=x,y,w,h` on any image path, in every format.
- **Eval** — `node tools/eval.ts <campaign…>` scores finished work on a creative-director rubric.
- **Fixes** — the supervisor restarts each service once with backoff and waits out a taken port (it could multiply renders before); content prompts pick Anything reliably; stock footage from Pixabay and Unsplash (Pexels as fallback).

## 1.1.0 — 2026-11-02

Anything: make any kind of video, not just launch content.

- **Product or content?** The research step decides. Content gets a production brief — genre, format, beats with timings, look, sound, original characters, cited sources for factual pieces — and every format follows it (no product claims or CTA unless asked).
- **Director** skill with playbooks for stories and cartoons, trailers, documentaries, news, music and lyric videos, tutorials and recipes, motivational pieces, montages and data stories, choosing the engine per shot.
- **Media engines** (`media.mjs`): Pexels stock video and photos, generative images and video through fal.ai or Replicate, CC0 sound effects from Freesound — all with your own keys from Setup, credits kept, explicit prompts refused.
- **Cartoon kit**: nine original rigged characters (kid, robot, cat, dog, fox, dragon, blob, elder, bird) with emotions and actions, fourteen illustrated parallax worlds, twelve effects and camera moves — seek-safe for HyperFrames.
- **Anything** format: follows the brief's own length and shape; Home recognises a video brief and switches to it.
- Skills page no longer goes blank.

## 1.0.0 — 2026-11-02

Ready to leave running: long campaigns look after themselves, your app and your disk.

- **Your app has a lifecycle** — app setup records how to start and stop it (with PID files). Shipcast restarts it before any step that needs it (after a sleep or reboot), stops it when a campaign is packaged, deleted, or stops short after a failure or cancel, and the campaign page has a *Your app* bar with Start and Stop.
- **Claude usage limits pause, not fail** — the reset time is read from the limit message; steps that need Claude wait (renders and packaging keep going) and the interrupted session resumes by itself. The card shows when.
- **Unlock more** — keys the app step couldn't get are listed with what they unlock; add one later and Shipcast wires it in, restarts the app and captures again.
- **Safety check before running a project** — known worm loaders (`global['!']`, `global.i=`), eval of decoded data, code hidden past long whitespace in configs, install hooks that download code and auto-run VS Code tasks pause the app step until you type RUN.
- **Disk** — render leftovers are cleared after the hub; *Free up disk space…* shows the size and can drop the app copy.
- **Progress for long runs** — a stage strip (research → run the app → capture → plan → assets n of m → package), a time-left estimate, and browser notifications when it needs you or is ready.
- **Re-render all with the latest engine** — every finished video, carousel and post re-renders from its spec, chapters included, then the hub rebuilds.
- **Engine** — explainers with captions keep chips in the top row and diagrams shrink to fit; 4:5 videos keep captions in a lower third; long chips wrap; tree values and wrapped headlines fit; captions step aside for the outro; dark logos sit on white chips everywhere; service calls ride out restarts; stuck child processes are killed by group; npx heals a broken cache.
- **Doctor** checks Docker and zip for full campaigns. 45 tests cover the full-campaign flows end to end.

## 0.9.0 — 2026-11-01

Point it at your app and walk away: a full campaign, explained on the real product.

- **Full campaign from a running app** — connect a repo or folder plus env vars; Shipcast sets the app up on a copy (installs, a throwaway database or Docker service, seed data), diagnoses and fixes failures for several rounds, and logs what it did in `setup.md`. It logs in for real and captures 20–30 screens and filmed flows, then plans the campaign and makes every asset. Runs in the background for 2–4 hours.
- **Asks only when it must** — when something can't be fixed locally (a licence key, a credential, a decision), the step pauses with one specific question, the reason, and typed fields (secret ones masked). Your answer resumes the same session; secrets go to a 600-mode `secrets.env`, never back to the UI, and are scrubbed from every output. Desktop notification when it needs you.
- **Campaign plan → jobs → hub** — one campaign line, pillars, an asset list with a short brief each and a 2–4 week calendar; Shipcast queues a job per asset, then packages everything in an offline `index.html` hub (videos, carousels, posts, captions, calendar) with a zip, stops the app it started, and notifies you.
- **Feature Explainer** — narrated "how it works" videos (90 s – 7 min) on the real product: rules verified in code first, calm "Part N" cards, the camera walking real screens with drawn highlights and caption chips, filmed click-throughs, and diagrams (ladder of levels, worked-example table, flow, one-record tree, who-does-what matrix, recap).
- **Product Tour** — music-led promos told in moving UI: the messy before, a form filling itself, an option picked, an action passing (or stopped by) a checks rail, real screens, CTA.
- **Social Posts** — feed (1:1), portrait, wide and story images per post, with per-platform captions and alt text.
- **Capture** — `text=` selectors, exact element boxes for every hero screenshot, filmed flows with a gliding cursor, human typing, scroll and hover (each with a timeline the video auto-zooms from), dark mode, and missed targets that warn instead of stopping the take.
- **Transitions** — `blur`, a motion-blurred whip, and `push`.
- **Resilient long runs** — steps that hit a network or API blip retry up to twice on their own.

## 0.8.0 — 2026-11-01

Sketch it before you make it, and a hub of the best community skills.

- **Drawing board** — after picking a direction, Shipcast sketches the video Excalidraw-style: a hand-drawn frame per beat (kinetic type, product shot, big number, logo storm, 3D cards, presenter, cinematic shot…), the line in handwriting, the director's note, arrows between. Rewrite, swap scenes, reorder, add or drop beats; the approved board becomes the plan every step follows.
- **Brainstorm, continued** — reply to the directions in your own words ("mix 1 and 3", "more playful") and get reworked ones; Claude suggests the formats that fit and applies them in one click.
- **Skill Hub** — 19 curated packages from 14 repos (HyperFrames, GSAP, taste-skill, Anthropic's creative skills, diagram-design, marketingskills, humanizer, ffmpeg-skill, Emil Kowalski's motion skills and more), each pinned to a commit, licence-checked and installed into Shipcast only. Formats ask for roles; the hub assigns the strongest skill. Add any skill repo by GitHub URL.
- **Scriptwriting skill** — Shipcast's own: hooks, structures from 15-second shorts to 10-minute videos, story spines, open loops, writing for the ear.
- **Music that follows the story** — the score thins out under quiet scenes and comes in full on the big moments.
- **Mascot looks** — blob, bot, orb and sticky note for the animated presenter.
- HyperFrames workflow skills are pinned to the last release that shipped them, so formats keep working on fresh machines.

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
