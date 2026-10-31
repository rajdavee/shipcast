# Shipcast v2 — from POC to studio-grade

Grounded in [research/landscape-2026.md](research/landscape-2026.md). The v0.1
loop was "Claude improvises a deliverable, we hope it's good". v2 is the model
the industry converged on (Creatomate, Shotstack, Bannerbear, Submagic):

> **Claude directs. Specs describe. Services render. Gates measure.**

1. Claude researches and writes a **spec** (storyboard / slide deck / thumbnail
   set / copy kit) against **platform presets** and **brand tokens**.
2. Dedicated **capability services** render the spec deterministically.
3. A **QA service** measures the result (safe zones, overflow, contrast,
   caption speed, loudness, black frames, spec compliance). Failures go back to
   Claude with the report — up to two fix passes.
4. Every spec is **editable in the studio**: change a headline, color, voice or
   caption style and re-render that scene only, without another Claude run.

## Services

All services are plain Node (TypeScript via type stripping) on `127.0.0.1`,
each with `/health` and a small job API, started together by `shipcast start`
or individually. `docker compose up` is optional.

| Service | Port | Owns |
|---|---|---|
| `api` (gateway) | 4317 | Studio UI, campaigns, connections, SSE, file serving |
| `worker` (director) | — | Claude runs: brief, specs, copy; QA fix loop |
| `render` | 4320 | HyperFrames compositions → preview stills / 540p proxy / final MP4·WebM·GIF |
| `stills` | 4321 | HTML templates → PNG/JPG/PDF (carousels, thumbnails, cards, banners, stories) |
| `media` | 4322 | Voice (Kokoro; Chatterbox/Qwen3 opt-in), transcription + alignment, music bed, SFX, cutout, finishing (two-pass loudnorm, faststart) |
| `qa` | 4323 | Deterministic gates + contact sheets; no LLM |

Shared library `engine`: store, job runner, platform presets, brand tokens,
spec schemas, content-hash cache, service client.

## Phases

- [ ] **P0 Foundation** — service kit (job API, health, client), supervisor, presets table, brand tokens, Services page in UI, docker-compose.
- [ ] **P0 Quality gates** — `qa` service (loudness, black/freeze, spec, size, stills dims/contrast, composition layout/safe-zone via HyperFrames check) + finishing pass + worker fix loop.
- [ ] **P1 Captions** — Shipcast caption-style library (karaoke, word-pop, bold-stroke "beast", keyword-highlight "hormozi", clean, boxed, typewriter, behind-subject) as HyperFrames components; script-aware timing.
- [ ] **P1 Audio** — voice tiers, curated CC0 SFX kit (downloaded on setup), beat-synced music bed, auto-ducking, -14 LUFS / -1 dBTP master.
- [ ] **P2 Storyboard engine** — storyboard spec (scenes → registry blocks or custom HTML, variables, durations, transitions, VO lines) → compiled composition; per-scene render cache; studio scene editor.
- [ ] **P2 Product footage** — scripted Playwright capture with cursor path → zoom/cursor keyframes, device frames.
- [ ] **P3 Stills** — template library (carousels ×6 structures, thumbnails ×3 variants, cards, banners, stories) with typed fields; studio slide editor.
- [ ] **P3 Copy** — channel formatters, voice file, hook A/B variants, humanizer pass.
- [ ] **UI** — format-first home, per-format editors, live previews, services/health page, onboarding checklist.
- [ ] **Verify** — real renders for every format, QA green, contact sheets reviewed.
