# Sprint v9 — Accounts, workspaces and data isolation

Shipcast was a single-person app: one data folder, one Claude login, every connection shared. This sprint makes it safe for several people on one install (a team server or a shared Mac):

- **Accounts** — email + password, secure sessions.
- **Workspaces** — every user has a private workspace; team workspaces with invited members and roles. Projects, calendar, numbers, brand voices, lessons, connections (LinkedIn, YouTube, Postiz, fal, ElevenLabs, stock…) and settings belong to a workspace and are invisible outside it.
- **Your own Claude** — each user connects their own Claude account; their runs use their own usage.
- **Existing data** moves into the first account's workspace.

## Decisions (agreed)

| Question | Choice |
|---|---|
| Sharing | Workspaces with roles (owner, admin, editor, viewer); personal workspace per user |
| Sign-in | Email + password (scrypt), HttpOnly session cookies; TOTP later |
| Claude | Per user: a token from `claude setup-token` (or an Anthropic API key), stored for that user only; the install owner may instead use this machine's Claude login |
| Existing data | Moved into the first account's personal workspace |

## Design

**One choke point.** Every module finds its data through `home()`. It becomes context-aware: inside a request or job, `home()` is that workspace's folder (`<root>/workspaces/<id>`); outside, the install root. The context is carried by `AsyncLocalStorage`, so the hundreds of existing call sites need no change and cannot forget the workspace. Machine-wide things (skills cache, fonts, icons, voice/chatterbox envs, service job queues, the trend radar's market data) explicitly use `rootHome()`.

**Layout**
```
~/.shipcast/
  auth/users.json, sessions.json, workspaces.json, invites.json   (0600)
  users/<uid>/secrets.json   (own Claude token, 0600) · users/<uid>/claude/ (CLAUDE_CONFIG_DIR)
  workspaces/<wid>/{campaigns,calendar,metrics,tone,lessons,evals,agents,gen,settings.json,secrets.json}
  skills/ fonts/ icons/ voice/ services/ trends/   (machine-wide)
```

**API gate.** Every `/api/*` route except sign-in/sign-up requires a session. The workspace comes from `X-Shipcast-Workspace` (or the session's last one); membership is checked and the handler runs inside that workspace's context. Roles: viewer = read; editor = make, edit, schedule; admin = connections, settings, members, publishing; owner = delete/transfer the workspace. Files under a workspace are served only to its members; campaign ids from another workspace are simply not found (404, no existence leak). OAuth `state` remembers the workspace, so a LinkedIn/YouTube connection lands in the workspace that started it.

**Sessions.** 32-byte random token in an HttpOnly, SameSite=Lax cookie (Secure over HTTPS); only its SHA-256 is stored; 30-day sliding expiry; sign out (this device / everywhere); password change kills other sessions. Login is rate-limited per email and per IP. Cross-site writes stay blocked by the existing Origin check.

**Sign-up.** The first account on an install becomes its owner (and gets the existing data). After that, sign-up is by invite link (single-use, 7 days, role chosen by the inviter) unless the owner turns on open sign-up.

**Background work.** The worker, publisher, metrics, learning, trends and golden jobs iterate workspaces and run each inside its context; Claude runs use the token of the user who started the step (background jobs: the workspace owner's). Machine-wide services (render, stills, media, qa, gen) stay on 127.0.0.1 and only accept paths under the install root.

**Migration.** On first sign-up, existing workspace-level data moves (same-disk rename) into the new personal workspace; a marker records it. Idempotent and logged.

## Milestones

| M | Scope |
|---|---|
| M1 | Context-aware `home()` + `rootHome()`; workspace dirs; machine-wide modules moved to root; tests prove two workspaces never see each other's data |
| M2 | Auth store (users, scrypt, sessions, rate limits), workspaces + members + roles + invites; first-user bootstrap + migration |
| M3 | API gate: session + workspace + role on every route, files, OAuth state; 404-not-403 for foreign ids; existing tests run signed in; new isolation tests across every route family |
| M4 | Background services per workspace (worker, agents, publisher, metrics, golden); per-user Claude (token/API key, CLAUDE_CONFIG_DIR) with the owner's machine-login option |
| M5 | UI: sign in / sign up / invite accept, workspace switcher, members & invites, account (password, sessions, Claude connection), role-aware UI |
| M6 | Security review pass, docs, CI green, push |

## Testing
Isolation matrix: user A and user B in separate workspaces — every list/read/write/delete route returns only their own data; cross-workspace ids → 404; viewer can't write; editor can't manage connections; removed member loses access immediately; sessions expire and revoke; rate limit; invite single-use; OAuth state bound to workspace; background jobs write into the right workspace; Claude env per user. Plus the full existing suite, signed in.
