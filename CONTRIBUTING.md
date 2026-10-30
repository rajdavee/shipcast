# Contributing

Thanks for helping. The easiest high-impact contribution is a **new format
pack** — see [docs/WRITING-PACKS.md](docs/WRITING-PACKS.md).

## Setup

```bash
npm install
npm run dev        # http://localhost:5173 (UI) + :4317 (api + worker)
npm test
npm run typecheck
```

## Layout

| Path | What |
|---|---|
| `apps/web` | Studio UI (React + Vite, plain CSS tokens in `styles.css`) |
| `services/engine` | Store, packs, Claude driver, doctor, GitHub helpers |
| `services/api` | `node:http` server, SSE, file serving |
| `services/worker` | Queue loop that runs steps |
| `packs/` | Format packs |
| `plugin/` | Shipcast's own skills, loaded per run with `--plugin-dir` |

## Rules of thumb

- Backend stays dependency-free. Reach for `node:` modules first.
- Anything a user can see in the UI should be explainable without reading code.
- Third-party skills are installed from their own repos, never vendored here.
- Keep PRs focused; include a screenshot for UI changes.
