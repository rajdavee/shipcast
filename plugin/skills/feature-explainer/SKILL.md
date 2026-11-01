---
name: feature-explainer
description: Direct a narrated, chaptered "how this feature works" video (90 s – 8 min) on the real product UI — a camera that travels across real screens with drawn highlights and caption chips, filmed click-throughs, and clear diagrams of the rules (levels, worked examples, flows, who-does-what) — as a Shipcast storyboard. Use for feature explainers, onboarding videos, help-centre videos, "how X works", release walkthroughs and dashboard tours.
---

# Feature explainer

Read `shipcast:storyboard` first (format, fields, voice rules) and
`./catalog.md` (every scene and field you may use). This skill adds the shape
and the craft of a great product explainer: the video a customer-success lead
would send instead of a 40-minute call.

The viewer arrives with one question ("how do approvals work?", "which
spending limit applies to me?"). They leave able to answer it themselves and
knowing exactly where to click. Clarity beats hype. Calm confidence beats
energy.

## 1. Understand before you write (do this first)

1. Read `brief/product-facts.md`, `brief/assets/app/screens.json`, the
   campaign brief, and the source code for the feature (models, policies,
   config, validation rules, permission checks). Explainers die on vagueness;
   the code tells you the real rules, limits, defaults, roles and edge cases.
2. Write `work/model.md` for yourself: the feature in 5–8 bullet rules
   ("the allowance resets on the 1st; top-ups never expire; the most
   specific limit wins: person > team > workspace default"), the
   roles involved and what each can see or do, one worked example with real
   sample-data numbers, and 2–3 edge cases the code protects against.
3. List the screens and flows you need to *show* each rule. Look at every
   candidate image. If something you need wasn't captured, capture it now
   (section 4) — never explain a screen you can't show.

## 2. Shape (scale it to the length)

| Length | Narration | Parts | Scenes |
|---|---|---|---|
| 90 s | ~210 words | 2–3 | 12–18 |
| 3 min | ~420 words | 3–4 | 25–35 |
| 5 min | ~700 words | 4–6 | 40–55 |
| 7–8 min | ~1,000 words | 6–8 | 55–75 |

1. **Cold open, no card (≤ 20 s).** Name the question in the viewer's words,
   then one diagram that frames the whole idea (a `tree` of one record and
   its many outcomes, a `flow`, or a `ladder`). End with what they'll know
   by the end. No logo, no greeting.
2. **The model.** The rule in one picture: `ladder` for priorities and
   tiers, `flow` for what happens in order, `table` for a worked example,
   `tree` for one-thing-many-views. Real numbers from the sample data.
3. **One part per surface or role** ("What your team sees", "What admins
   control", "Platform settings"). Each part is mostly real UI:
   `walkthrough` scenes on screenshots (2–4 steps each, one idea per step)
   and `recording` scenes for actions (buying, creating, approving,
   filtering). Open each part with the role in the kicker (`TEAM ADMIN ·
   BILLING`).
4. **A real-world example** told as a mini story with the actual screens:
   "a team hits its limit mid-month → their admin raises it → finance
   approves with a reason".
5. **Protection and edge cases** — what's locked, validated, audited
   (`checklist`, `table`, or a `walkthrough` on the audit log).
6. **Who does what** — a `matrix` of roles × abilities when roles matter.
7. **Recap** — a `checklist` of what they can now do, then the `outro`
   (or a quiet logo card) with the one next step.

Set `"chapterCards": "part"` so parts open with the calm "PART 2" card, and
`"card": false` on the cold open.

## 3. Craft rules

**Walkthroughs (the heart of it)**
- Boxes come from `screens/<name>.marks.json` (exact element positions,
  0–1 fractions) whenever a mark exists — copy the numbers. Without a mark,
  look at the image and estimate generously (a little air around the
  element), never a guess you haven't checked against the picture.
- Order steps the way an eye reads the screen: top-left → bottom-right, or
  the order a user would act. Max 4 steps; split into two scenes otherwise.
- Chip LABEL = where or what, in 1–3 words (`TOOLTIP`, `AUTO-APPROVE`,
  `SPEND HISTORY`, `STEP 2`). Chip text = what to notice, with the value
  that matters wrapped in `*stars*` (`Shown before you submit *$500 left
  this month*`). Use `+$1,200+` for a positive/green figure. Quote UI labels
  exactly as they appear on screen.
- `click` only where the viewer would actually click.
- Give each step ≥ 2.5 s of screen time; a 3-step walkthrough is ~9–11 s.

**Recordings**
- Use a recording when motion explains better than a still: typing a value
  and seeing the total update, a menu opening, a filter changing a list.
- Caption chip times are seconds from the scene start; line them up with the
  recording's `.json` actions (each action has `at`).

**Diagrams**
- One diagram per rule; light the answer (`highlight`) and say why in the
  voice line. Numbers in diagrams must match the screens.
- Alternate: UI → diagram → UI. Never more than three UI scenes in a row
  without a diagram or part card, never two diagrams of the same kind back
  to back.

**Voice (spoken, not written)**
- ~140 words/minute, second person, present tense: "You'll see the cost
  before you click."
- One sentence per walkthrough step, said while that step is on screen.
  Name the exact button or column.
- Cause → effect: "Because Sam's personal limit is the most specific, she
  can spend five hundred on travel this month."
- Never: "simply", "just", "seamless", "powerful", "robust", "leverage",
  "game-changer", "in today's world".
- Say numbers the way people say them ("thirty thousand dollars", "five
  hundred a month").

**Truth**
- Only rules you verified in code or on screen; only numbers from the sample
  data or `product-facts.md`. Show "Real product UI · sample data" in the
  cold open or first part kicker. No invented customers, quotes or metrics.
- Fictional sample names in the app are fine to show — they are the demo
  workspace.

**Look**
- Default ground is dark with the brand accent (calm, editorial). Keep the
  whole video on that one ground: `statement`, `title` and `stat` switch to a
  light or brand ground, so in an explainer say those lines with a `part`
  card, a diagram or a walkthrough chip instead. The `outro` is the one
  brand-coloured moment. Music: a
  low bed (`"mood": "chill"` or `"cinematic"`, `"gainDb": -24`) — the voice
  leads. Captions `"none"` unless the prompt asks (chips already carry the
  words); keep `clean` for social cut-downs.

## 4. Capturing what's missing

When `out/app.json` from the app step exists, the app is still running and
you may capture more with the capture tool (path in the prompt):

```json
{ "base": "<app url>", "out": "work/cap", "dark": false,
  "steps": [
    { "goto": "/login" }, { "fill": "input[type=email]", "env": "SHIPCAST_LOGIN_EMAIL" },
    { "fill": "input[type=password]", "env": "SHIPCAST_LOGIN_PASSWORD" }, { "click": "button[type=submit]" },
    { "goto": "/settings/limits" },
    { "shot": "limits", "marks": { "set": "text=Set limit", "approvals": "text=Approvals", "history": "text=Spend history" } },
    { "record": "raise-limit", "actions": [ { "click": "input[name=amount]" }, { "type": "1200" }, { "wait": 800 }, { "move": "text=Save" }, { "wait": 1200 } ] }
  ] }
```

Export the login first if it lives in a file (`export SHIPCAST_LOGIN_PASSWORD="$(cat <app>/work/app/.shipcast-login)"` in the same command, never printed). Copy what you keep into `brief/assets/app/` (with its
`.marks.json` / `.json`) and reference it as `assets/app/<file>`. Clean
the page before each shot (cookie banners, chat launchers, dev toolbars,
"Map unavailable" placeholders) with `eval`. Never perform destructive actions
(delete, send, pay for real) — stop at the confirmation screen.

## 5. Output

- `out/storyboard.json` (chapters, `chapterCards: "part"`).
- `out/script.md` — the narration by part, readable on its own.
- `out/NOTES.md` — the rules you explained and where each was verified
  (file:line or screen), plus anything you couldn't show.
