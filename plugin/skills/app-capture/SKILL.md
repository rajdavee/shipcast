---
name: app-capture
description: Capture real product UI from a running app for a Shipcast campaign — log in for real, walk the main flows, and save crisp desktop and mobile screenshots plus smooth walkthrough recordings of dashboards, using Shipcast's capture tool. Use for the "Capture the product" step of a full campaign.
---

# Capture the product

You have a running app (see the previous step's `out/app.json`, passed in the
prompt). Produce the raw material every film, carousel and post will use:
**real UI with sample data**.

## Tool

`node <plugin>/skills/app-capture/scripts/capture.mjs plan.json`
(the exact path is in the prompt). The plan is JSON: `goto`, `fill` (with
`env` for secrets — e.g. `SHIPCAST_LOGIN_PASSWORD` — never literal
passwords), `click`, `waitFor`, `wait`, `eval`, `shot` (+ `full`),
`record` (+ `seconds`, `scroll`), `mobile`. See the header of the script.
If the demo password lives in a file, export it first:
`export SHIPCAST_LOGIN_PASSWORD="$(cat work/app/.shipcast-login)"` in the
same shell command — don't print it.

## What to capture (aim for 15–30 files)

1. **Public pages**: home/landing (viewport + full), pricing, features.
2. **Login** for real, then every main screen in `mainPages`: dashboard,
   lists/tables, detail views, settings, analytics, onboarding.
3. **Hero moments**: the 3–5 screens that best show what the product does —
   capture each at 1440×900 @2x, plus a tighter crop-friendly version if a
   panel matters (use `eval` to scroll a panel into view).
4. **Walkthroughs** (`record`, 6–12 s): the dashboard scrolling, a list
   filtering, a key action happening. These become dashboard videos.
5. **Mobile** (`{"mobile": true}`): home + 2–3 key screens.

Before each shot: close cookie banners, toasts and dev toolbars (e.g. Herd,
Laravel Debugbar, Next.js dev indicator) with `eval`; make sure the screen is
populated — if a page is empty, go back and seed data (or note it).

## Output

- `out/screens/*.png|mp4` with descriptive names (`dashboard.png`,
  `leads-list.png`, `pipeline-walkthrough.mp4`, `home-mobile.png`).
- `out/screens.json`: `[{"file": "screens/dashboard.png", "title": "Dashboard", "shows": "what's on screen", "best_for": ["video", "carousel", "post"]}]`.
- `out/product-facts.md`: what the product verifiably does, as seen in the UI
  and code (features, plans/prices if shown, integrations that exist) — the
  campaign may only claim what's in this list. Mark anything uncertain.
- Look at every image you saved; reshoot anything broken, empty or covered.
- Never put credentials or env values in any file under `out/`.
