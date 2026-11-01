---
name: app-runner
description: Set up and run the user's app locally for a Shipcast campaign — detect the stack, install dependencies, wire env vars, start databases (Docker or a throwaway local DB), seed realistic sample data, create a demo login, diagnose and fix errors, and ask the user only for what can't be fixed locally. Use for the "Run your app" step of a full campaign.
---

# Run the user's app

Goal: the app running locally at a URL, logged-in pages reachable with a demo
account, and realistic **sample** data on screen — so the next step can
capture real product UI. You have time (this step may take 30–60 minutes).

## 0 · Ground rules

- **Never modify the user's original folder.** For a local source, work on a
  copy: `rsync -a --exclude node_modules --exclude vendor --exclude .git --exclude .next --exclude dist <source>/ ./work/app/`.
  A GitHub source is already a fresh clone in the campaign's `source/` — copy
  it to `./work/app/` the same way.
- **Secrets:** env vars are in your shell (names listed in the prompt). Write
  them into the app's config (e.g. `.env`) inside `./work/app` only. Never
  print values, never put them in `out/`, logs you write, or commit them.
- **Nothing leaves this machine.** No deploys, no pushes, no uploads, no
  emails or SMS to real people (set mail/SMS drivers to log/sandbox).
- **Sample data only.** Seed realistic but fictional data (people, companies,
  numbers). If the brief has naming rules (e.g. a fictional practice name),
  use them. Never use real customer data.

## 1 · Already running?

If `SHIPCAST_APP_URL` is set, or the project's `APP_URL`/dev URL responds
(`curl -sk -o /dev/null -w '%{http_code}' <url>`), use that running app
read-only and skip to step 5 (login).

## 2 · Detect and install

Read README, `package.json`, `composer.json`, `pyproject.toml`/`requirements.txt`,
`Gemfile`, `go.mod`, `docker-compose.yml`, `Makefile`, `.env.example`.

| Stack | Typical setup |
|---|---|
| Node / Next / Vite | lockfile decides `bun install` / `pnpm i` / `npm ci`; `dev` script on a free port |
| Laravel | `composer install`, `cp .env.example .env`, `php artisan key:generate`, SQLite (`touch database/database.sqlite`, `DB_CONNECTION=sqlite`) unless MySQL/Postgres is required, `php artisan migrate --seed`, `npm/bun run build`, `php artisan serve --port <free>` |
| Django / FastAPI / Flask | venv, install, migrate, `runserver`/`uvicorn` on a free port |
| Rails | `bundle install`, `db:setup`, `bin/dev` |
| docker-compose | `docker compose up -d` (see Docker below) |

Pick a free port (`lsof -i :PORT`). Start long-running processes with
`nohup … > work/logs/<name>.log 2>&1 &` and record each PID.

## 3 · Databases and services

Prefer the lightest thing that works: SQLite → a local Postgres/MySQL/Redis
already running (check ports 5432/3306/6379) → Docker.
Docker: `docker info` — if it's not running, try `colima start` (or open
Docker Desktop); if neither is installed and Homebrew is available,
`brew install colima docker && colima start`. Run a **throwaway** container
with a campaign-specific name, e.g.
`docker run -d --name shipcast-<campaign>-pg -e POSTGRES_PASSWORD=local -p <port>:5432 postgres:16`.
Third-party services (payments, email, SMS, AI APIs): use test/sandbox modes
or disable the feature; only ask the user if a core flow can't work without it.

Docker gotchas: with colima, bind mounts only see the folders the VM shares
(usually your home folder). If a mounted file shows up as an empty directory
inside the container, pipe its contents in (`docker exec -i … psql < file`)
or inline it (compose `configs: content:`). Never touch containers, volumes or
compose projects you didn't create — if a name clashes with the user's own,
rename yours (`-p shipcast-<campaign>`).

## 4 · Diagnose → fix → retry

Run, read the error, fix, retry — up to ~8 rounds. Typical fixes: missing env
var with a safe local default (APP_KEY, secrets you can generate, local
URLs), missing extension/tool (install it), migration order, seeders, port
clashes, build steps. Log each problem and fix in `out/setup.md`.

**Ask the user (out/question.json → NEEDS_INPUT) only when** a value must come
from them: a real third-party key with no test mode that the product's
**headline feature** needs (if the product *is* an AI builder, its AI key is
core — ask; if AI is a side feature, use a placeholder and list it under
"Disabled"). Decide by asking: would a campaign about this product be hollow
without it? Also ask for
private registry/credentials, a login you can't create, or a choice between
two very different ways to run it. Ask one specific question with exact
field keys (use the env var name as `key` for secrets).

## 5 · Demo login and data

Use `SHIPCAST_LOGIN_EMAIL` / `SHIPCAST_LOGIN_PASSWORD` if given. Otherwise
create a demo admin through the app's own mechanisms (seeder, CLI, tinker,
sign-up form) with sample data that makes every main screen look alive
(dashboards with numbers, lists with 8–15 rows, a few statuses). Put the
demo email in `out/app.json`; write the demo password only to
`./work/app/.shipcast-login` (never to out/).

## 6 · Hand-off

Write `out/app.json`:
```json
{ "url": "http://127.0.0.1:8091", "loginUrl": "/login", "login": { "email": "demo@example.test", "passwordFile": "work/app/.shipcast-login" },
  "stack": "Laravel 12 + Inertia/React, SQLite", "processes": [{ "name": "web", "pid": 1234, "cwd": "work/app", "log": "work/logs/web.log" }],
  "start": ["docker start shipcast-…-pg", "mkdir -p work/pids && cd work/app && (nohup php artisan serve --port=8091 > ../logs/web.log 2>&1 & echo $! > ../pids/web.pid)"],
  "stop": ["kill $(cat work/pids/*.pid) 2>/dev/null; true", "docker rm -f shipcast-…-pg"], "mainPages": ["/dashboard", "/leads", "/reports"],
  "sampleData": "what was seeded", "notes": "anything the capture step should know",
  "optional": [{ "key": "OPENROUTER_API_KEY", "label": "OpenRouter API key", "unlocks": "AI site generator" }] }
```
and `out/setup.md` (what you did, what failed and how you fixed it, what
was disabled). Leave the app running for the next step.

`optional` lists keys you couldn't get that would unlock more of the product
(the ones you set placeholders for): `[{"key": "OPENROUTER_API_KEY", "label":
"OpenRouter API key", "unlocks": "AI builds, the Constitution Counsellor"}]`.
Shipcast shows them to the user as "Unlock more"; if they add one later, this
session is resumed to wire it in.

`start` brings the app back after a reboot or a stop, without reinstalling:
the exact commands, in order, each one returning straight away (background
servers with `nohup … &`), safe to run twice. Write each server's PID to
`work/pids/<name>.pid` so `stop` still works after a restart. Shipcast runs
`start` itself before a later step if the app isn't answering, and from the
campaign page's Start app button.

`start` and `stop` commands run from this step's folder (where `work/` and `out/` live), so
write paths like `work/app/docker-compose.yml`. `stop` lists only what *you* started; Shipcast runs it when the campaign is
packaged. Stop by the PIDs you started (read them from `work/pids/`) and by your
own compose project name — never by port (`lsof -ti:<port> | xargs kill` can
kill the user's own servers) and never with broad `pkill` patterns. If you used an app that was already running (yours to keep, not
ours), set `"external": true` and leave `stop` empty.
