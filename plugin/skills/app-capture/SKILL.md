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
passwords), `click`, `waitFor`, `wait`, `eval`, `shot` (+ `full`,
`marks`), `record` (+ `seconds`, `scroll`, or `actions`), `mobile`, and a
top-level `"dark": true`. Selectors are CSS or `text=Visible label`. See the
header of the script.
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
4. **Marks on every hero shot.** Add `"marks": {"name": "selector"}` for the
   3–6 elements a viewer should notice on that screen (the key number, the
   main button, a column, a filter, a status badge). They're saved as
   `<shot>.marks.json` and become exact highlights in explainer videos.
5. **Filmed flows** (`record` with `actions`, 8–20 s): the 3–5 things a user
   actually *does* — create a record, filter a list, change a setting and see
   the result, open a detail view, drag a card. `move`/`click`/`hover` glide a
   visible cursor, `type` types like a person, `scroll` eases. Stop at any
   confirmation that would send, delete or charge for real. Each recording
   gets a `.json` timeline the video uses to auto-zoom on clicks. Also a
   plain `scroll` recording of the main dashboard (6–10 s).
6. **Mobile** (`{"mobile": true}`): home + 2–3 key screens.

Before each shot: close cookie banners, toasts, chat launchers and dev
toolbars (e.g. Herd, Laravel Debugbar, Next.js dev indicator) and hide
broken placeholders ("Map unavailable") with `eval`; make sure the screen is
populated — if a page is empty, go back and seed data (or note it).

## Output

- `out/screens/*.png|mp4` with descriptive names (`dashboard.png`,
  `leads-list.png`, `pipeline-walkthrough.mp4`, `home-mobile.png`).
- `out/screens.json`: `[{"file": "screens/dashboard.png", "title": "Dashboard", "role": "team admin", "shows": "what's on screen", "marks": {"pipeline": {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.1}}, "best_for": ["video", "carousel", "post"]}, {"file": "screens/create-deal.mp4", "title": "Creating a deal", "actions": "click New deal → type name → pick stage → save", "seconds": 14}]`
  (copy each shot's marks in; describe each recording's actions).
- `out/product-facts.md`: what the product verifiably does, as seen in the UI
  and code (features, plans/prices if shown, integrations that exist) — the
  campaign may only claim what's in this list. Mark anything uncertain.
- Look at every image you saved; reshoot anything broken, empty or covered.
- Never put credentials or env values in any file under `out/`.
