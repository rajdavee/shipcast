# Sprint v3 — creative quality + one-step UX

Goal: output people would post without editing, from one input, in as few
clicks as possible. Benchmark = the best posts and videos in the feed, not
"good for a tool".

## Where we are (honest gap list)

Infographic vs the reference post:
- Cells are sparse (2–3 chips). Reference packs 5–8 per row, groups several
  logos into one chip ("AI assistants" = 4 logos), and the box is full.
- Animation is row-level only. Reference tours *individual chips* with a
  cursor and a ring, highlights the stage, and moves a dot down a connector.
- No vertical stage connectors with arrowheads, no real avatar, no brand logo.
- One layout (table) and one look. Topics that are funnels, timelines,
  comparisons or loops are forced into the table.

Videos: competent but templated — same scene kit, little kinetic type, no
illustration, icons or camera language. ~25% of the bar.

UX: two-stage choice on Home (goal cards *and* "customize"), a side drawer
that covers the campaign, Setup as a top-level page, broken cover crops in
Recent, outputs scattered across tabs. Too many decisions before value.

## Sprint backlog

### S1 · Infographic v2 (ship first)
- Dense cells: up to 8 chips, **group chips** (`"AI assistants": ["ChatGPT","Claude","Gemini","Perplexity"]`).
- Chip-level cursor tour + ring, stage highlight, vertical connectors with arrowheads, travelling dot.
- Real author avatar (GitHub avatar via `gh`) and brand logo in the footer.
- **Layouts**: journey table, funnel, roadmap/timeline, comparison (A vs B), cycle, checklist. Claude picks the one that fits the idea.
- **Looks**: board (dotted), night, sketch (hand-drawn), paper (editorial), glass.
- Skill rewrite: research-heavy, more specific copy, platform mix, post text.
- Examples on Desktop: ≥6 posts across layouts/looks.

### S2 · One-step UX
- Home = one input + a row of format tiles with real previews (multi-select, smart default). No goal cards, no "customize" panel; options live in the result.
- Campaign = live gallery: cards appear with progress skeletons, finished cards show the real thing (GIF plays, video loops).
- Lightbox viewer replaces the drawer: media large, post text beside it, **Copy text** and **Download** as the main actions, "Ask for changes" input, "Try another look" strip.
- Setup becomes a status pill + modal; first-run checks inline.
- Motion: one orchestrated reveal per screen, no scattered effects.

### S3 · Adopt the market
- Install proven upstream skills at runtime (not vendored) where they beat ours — design/theme, motion, LinkedIn writing.
- Add renderer capabilities from OSS: GSAP plugins (SplitText, DrawSVG, MorphSVG — now free), Lottie animated icons, Rough.js hand-drawn style, Iconify everywhere.
- Credit and licence notes in docs; nothing copied into the repo.

### S4 · Motion video quality
- New scene kit: kinetic typography, 3D card stacks, UI zoom with camera moves, animated icon grids, data reveals, sticky-note/whiteboard explainers.
- 3 styles per format; director review compares frames with reference stills.
- Benchmark each format against 3 strong market examples before shipping.

### S5 · Carousel v2, polish, release v0.5
- Carousel layouts borrow the infographic system (frameworks, logos, notes).
- Full QA pass, README media refresh, tagged release.

## Definition of done (every item)
- Rendered and looked at frame by frame; no overflow, no empty space, no clipped text.
- Would a marketer post it as is? If not, it's not done.
- Tests + CI green; commits as rajdavee.

## Research notes (what we adopt, and how)

Ranked adoptions — all installed at runtime from upstream or used as npm
dependencies; nothing vendored:

1. **HyperFrames registry** (Apache-2.0) — ~450 blocks/components (kinetic
   type, count-ups, chart stories, flowcharts, Lottie characters). Storyboard
   and infographic skills pick blocks by tag; render runs `hyperframes add`.
2. **GSAP plugins** — SplitText, DrawSVG, MorphSVG are now free: kinetic text,
   hand-drawn strokes, icon morphs. Loaded from the CDN at render time.
3. **Hand-drawn stack** — Rough.js (MIT) for the sketch look (shipped in
   infographics), Excalidraw export for diagrams.
4. **Lottie** (dotlottie-web, MIT) through HyperFrames' adapter; LottieFiles
   assets fetched per user at runtime only (their licence forbids bundling).
5. **Satori + resvg** (MPL-2.0) for fast, deterministic stills.
6. **Vega-Lite / Mermaid** — Claude writes declarative charts/diagrams;
   GSAP staggers them in.
7. **Design skills to learn from** — anthropics/skills (canvas-design,
   theme-factory), nexu-io/open-design (brand-extract, motion-design,
   taste rules). Read for technique; check each licence before porting.

Avoid: Remotion (paid company licence binds users), a second video engine
(Motion Canvas/Revideo), anything that needs a paid API key.

Visual styles to support across formats: editorial data, Swiss kinetic
type, hand-drawn whiteboard, isometric/3D glass, bento SaaS, doodle +
stickers, dev/terminal.

UX patterns adopted: brand kit first (research step), live named progress
with partial previews, scoped "ask for changes", style picker with real
thumbnails, one primary action per screen, platform-ready downloads + copy.
