# Architecture

Shipcast is a local-first studio. Everything runs on your machine, with your own
Claude Code login. There is no hosted backend, no database server and no API key
to paste.

```
             ┌────────────── your machine ───────────────────────────────┐
 browser ──► │  web (React, static)                                       │
             │     │  HTTP + SSE                                          │
             │     ▼                                                      │
             │  api  ──writes──►  ~/.shipcast/  ◄──polls──  worker        │
             │  (node:http)      campaigns/<id>/            │             │
             │                    campaign.json             │ spawns      │
             │                    events.ndjson             ▼             │
             │                    source/ brief/        claude -p ...     │
             │                    deliverables/<pack>/   (your login)     │
             │                                              │             │
             │                                skills: plugin/ (ours)      │
             │                                 + engine skills (installed)│
             └────────────────────────────────────────────────────────────┘
```

## Services

| Service | Path | Job |
|---|---|---|
| `web` | `apps/web` | The studio UI. Static files, served by `api` in production, by Vite in dev. |
| `api` | `services/api` | Tiny HTTP server on `node:http` (no framework). Reads and writes the data dir, streams events with SSE. Never runs Claude. |
| `worker` | `services/worker` | Picks queued steps from the data dir and runs them by spawning the `claude` CLI headless. Can run on its own (`npm run worker`) or inside the api process (default). |
| `engine` | `services/engine` | Shared library: data-dir store, pack registry, prompt templating, Claude stream parser, doctor checks, GitHub helpers. |

**The data dir is the bus.** `api` and `worker` never talk to each other directly.
A campaign is a folder; its state is `campaign.json`; its log is an append-only
`events.ndjson`. That keeps every piece restartable: kill the api and the render
keeps going; kill the worker and the queued steps wait for the next one. Want
renders on a bigger box? Point a second worker at the same folder.

Node ≥ 22.18 runs the TypeScript in `services/` directly (type stripping), so the
backend has no build step and no runtime dependencies.

## Campaign lifecycle

1. **Source** — a URL, a GitHub repo (`owner/repo`, cloned shallow through `gh`
   when available so private repos work), a local folder, or a pasted brief.
2. **Brief** — one Claude run with the `shipcast:brief` skill researches the
   source and writes `brief/brief.md` + `brief/brand.json` (colors, fonts, logo,
   claims, audience, hooks) + downloaded `brief/assets/`. Every deliverable
   reads this, so research happens once.
3. **Deliverables** — one Claude run per selected pack, **sequential** by default
   to stay friendly to subscription usage limits. Each run's cwd is
   `deliverables/<pack>/`; outputs land in `out/` and are matched by the pack's
   `outputs` globs.
4. **Revise** — any deliverable can be re-rolled with a note. Shipcast resumes
   the same Claude session (`--resume`) so the model keeps its context.

## Packs

A pack is a folder in `packs/` with a `pack.json` (name, category, options,
outputs, required skills and tools) and a `prompt.md` template. Adding a new
kind of deliverable is adding a folder — no code. See
[WRITING-PACKS.md](WRITING-PACKS.md).

Packs build on two kinds of skills:

- **Shipcast skills** (`plugin/skills/`) ship in this repo and are loaded per run
  with `--plugin-dir`, so nothing is written into your global Claude config.
- **Engine skills** are third-party skill packs (for example the HyperFrames
  video skills) that Shipcast installs on request with the `skills` CLI from
  their own repositories. They are never copied into this repo; their licenses
  stay with them.

## Security model

Claude runs with file and shell tools inside the campaign folder so it can
render video. Content fetched from websites is untrusted: the brief skill
treats it as data, never as instructions, and the tool allow-list is set in
`~/.shipcast/settings.json`. Run Shipcast on a machine (or container) you are
comfortable letting an agent build files on. The api binds to `127.0.0.1` only.
