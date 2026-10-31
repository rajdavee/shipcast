# Architecture

Shipcast is a local-first studio built as a set of small services. Everything
runs on your machine with your own Claude Code login: no hosted backend, no
database server, no API keys.

> **Claude directs. Specs describe. Services render. Gates measure.**

```
browser ─► api :4317 ──fs──► ~/.shipcast/ ◄──fs── worker (director)
           (UI, SSE)          campaigns/           │  claude -p … (your login)
                              cache/ fonts/         │  writes specs: storyboard / deck / graphics
                              services/<name>/jobs  ▼
                                         ┌──── render :4320  storyboard → HyperFrames → MP4 (mastered)
                                         ├──── stills :4321  deck / graphics → PNG / JPG / PDF
                       HTTP job API ─────┼──── media  :4322  voice, word timing, captions, mix, finish
                                         └──── qa     :4323  measured quality gates
```

## Services

| Service | Port | Responsibility |
|---|---|---|
| `api` | 4317 | Studio UI, campaigns, connections, live events (SSE), file serving, spec editing |
| `worker` | — | The director: runs Claude for research and specs, renders specs through the services, feeds QA findings back to the same Claude session (≤ 2 fix rounds) |
| `render` | 4320 | Compiles a **storyboard** into a HyperFrames project (scenes, captions, transitions, local fonts, soundtrack), lints, renders, masters, runs QA |
| `stills` | 4321 | Renders **decks** (carousels) and **graphics** (thumbnails, cards, banners, stories) through one warm headless Chrome (raw DevTools protocol), with an auto-fit pass and a layout audit |
| `media` | 4322 | Kokoro voice, transcription, script-aware word alignment, caption cues (SRT/VTT), voice-over-music mixing with sidechain ducking, broadcast finish (-14 LUFS / -1 dBTP) |
| `qa` | 4323 | Deterministic checks: platform spec, codec, loudness, black/frozen picture, caption reading speed, image size limits; plus HyperFrames' in-browser layout/contrast/craft checks via render |

Every capability service uses the same kit (`services/engine/src/service.ts`):

```
GET  /health              → { name, ok, version, kinds, queued, running }
POST /jobs {kind, input}  → Job          (async)
GET  /jobs/:id[/wait]     → Job          (long-poll)
POST /run  {kind, input}  → Job          (submit + wait)
```

Jobs persist under `~/.shipcast/services/<name>/jobs`, so a restart requeues
in-flight work. Services find each other through `SHIPCAST_<NAME>_URL`
(defaults to `127.0.0.1:<port>`), so any of them can move to another machine.
`shipcast start` supervises all six as separate processes (restart with
backoff, free-port fallback); `docker compose up` runs each in its own
container.

## Specs

| Spec | Written by | Rendered by | Edited in |
|---|---|---|---|
| `storyboard.json` — preset, voice, captions, music, scenes (`scene` from the Shipcast scene library or `block` from the HyperFrames registry, with fields, voice line, transition) | `shipcast:storyboard` skill | render | Scene editor |
| `deck.json` — theme, preset, handle, slides (layout + fields) | `shipcast:carousel` skill | stills | Slide editor |
| `graphics.json` — items (thumbnail/card, layout, theme, preset, fields) | `shipcast:thumbnails` skill | stills | Graphics editor |

Claude receives a live `catalog.md` (generated from the services) listing every
scene, layout, field and character limit, so specs are always valid against
the running engine. Saving an edit in the studio re-renders the spec without a
Claude run.

## Quality pipeline (per video)

1. **Compile** — scenes sized to the preset's safe zones and the caption band, headlines auto-fit, accents contrast-corrected, fonts localized.
2. **Voice** — Kokoro per scene (cached by text+voice+speed), word timings aligned to the script.
3. **Mix** — voice over music with ducking, mastered to -14 LUFS / -1 dBTP.
4. **Render** — HyperFrames deterministic render; frame 0 replaced with the settled hook frame (the feed thumbnail).
5. **Gate** — `qa` (spec, loudness, black/frozen) + HyperFrames `check` (overlap, clipping, contrast, craft). Errors go back to Claude with fix hints.

## Formats

- **Studio formats** (`pack.json` with `spec`): reel, launch film, feature spotlight, explainer, carousel, thumbnails & cards. Fast, consistent, editable.
- **Freeform formats** (no `spec`): Claude builds directly with HyperFrames or brag skills — for one-off ideas the scene library doesn't cover.
- **Copy kit**: text deliverables.

## Data

A campaign is a folder: `campaign.json` (state), `events.ndjson` (log),
`brief/` (research + brand kit + assets), `deliverables/<step>/out/`, `uploads/`.
The api and worker share nothing but this folder and a mkdir lock.

## Security

The api and services bind to `127.0.0.1`; the api rejects foreign Host headers
and cross-site writes; services reject browser requests; files are served only
from inside a campaign (symlinks resolved); generated HTML is sandboxed. Claude
runs with a tool allow-list and is told to treat fetched content as data. See
[SECURITY.md](../SECURITY.md).
