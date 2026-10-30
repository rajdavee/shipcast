# Changelog

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
