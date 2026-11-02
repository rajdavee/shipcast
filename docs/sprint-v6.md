# Sprint v6 — Shipcast that gets better on its own

Four tracks, one idea: Shipcast should learn from every run, keep an eye on the
market for you, cover far more of the marketing surface, and catch quality
problems while it makes things — not only after.

| Track | What ships |
|---|---|
| A. Background agents | An `agents` service: scheduled jobs with budgets, quiet hours and a pause button |
| B. Learning loop | Lessons mined from past runs, QA failures, revisions and evals, fed back into every pack's prompt, measured, and retired when they don't help |
| C. Trend radar | A research agent that refreshes a **Trending** page: formats, hooks and topics rising now, each with "Make one like this" |
| D. More materials | ~14 new formats researched against 2026 data (TikTok photo carousels, app-store screenshots, Product Hunt kit, battlecards, case studies…) |
| E. Quality in the loop | Checks during generation (scene preflight, mid-run critic, legibility), plus a nightly golden-set regression and a quality history |

---

## A. Background agents (foundation)

A new service, `services/agents` (port 4325), supervised like the rest.

- **Jobs** live in `~/.shipcast/agents/jobs.json`: `{ id, kind, every, nextRun, lastRun, lastResult, enabled }`. Kinds: `learn`, `trends`, `golden`, `digest`.
- **One background Claude job at a time**, and only while no campaign step is running — foreground work always wins. A running job yields (pauses) when a step queues.
- **Budget**: background jobs may use at most `agentsShare` (default 25%) of the day's Claude runs; quiet hours (default 23:00–07:00 local, configurable) and a global pause switch in Setup.
- **Run log** in `~/.shipcast/agents/runs/<date>.jsonl`; the UI shows last run, next run, result, and a "Run now" button.
- No network or Claude call from a job without the user having switched that job on (trends is on by default with free sources only; learn is on; golden is off until the user opts in, as it renders real pieces).

## B. Learning loop — lessons from the past

**What it reads** (all local, already recorded):
- QA and audit feedback per step (`events.jsonl`: "Quality check found N issue(s)…", fix rounds, director's-review changes);
- user revision notes (`pendingNote`) — the strongest signal of what people didn't like;
- brand-score failures and fixes; eval reports (`tools/eval.ts` per-criterion scores and "one fix" notes);
- which takes / hook variants people picked.

**How it learns**
1. *Deterministic pass* (no model): classify every incident into a fixed taxonomy — `tiny-screenshot`, `text-overflow`, `caption-collision`, `blank-frame`, `off-brand-colour`, `weak-hook`, `placeholder-copy`, `clipped-crop`, `too-long`, `wrong-aspect`… — and count rates per pack over the last 30 runs.
2. *Synthesis pass* (one Claude call per pack with incidents): turn the top failure patterns and the user's own revision notes into at most 8 short, testable rules — "Carousel: show ≤ 500 CSS px of a screen per slide", "Reel: never put a caption over a headline scene" — each with evidence (incident ids) and the category it targets.
3. *Injection*: active lessons are appended to that pack's prompt (like the brand-voice brief), capped at 8 lines.
4. *Measurement*: each lesson records the failure rate of its category before it went live; after 10 more runs it's kept if the rate dropped, retired if it didn't. Nothing is permanent by default.
5. *Promotion*: a lesson kept for 30+ runs is flagged "proven" — a candidate to move into the pack's SKILL.md by a human (Shipcast never edits its own skills).

**UI — Learning page**: lessons per format with evidence, before/after rates, on/off toggle, "forget". Weekly digest card: "This week Shipcast stopped clipping cards (12% → 0%)".

## C. Trend radar — what's working in marketing now

**Sources** (free first; each optional):
- Hacker News (Algolia) — dev/startup topics *(have)*
- YouTube Data API — what formats get views per niche *(have, needs key)*
- Reddit public JSON — r/marketing, r/socialmedia, r/content_marketing, r/LinkedInTips, r/SaaS, r/startups (top/week) — tactics people discuss
- Google Trends RSS — `trends.google.com/trending/rss?geo=XX` — rising searches
- Claude web search (on the subscription) — weekly sweep of "what's working on LinkedIn / TikTok / Instagram this month", benchmark reports, platform feature launches

**Pipeline**
1. Collect (no model): fetch, dedupe, keep link + numbers + date.
2. Synthesize (one Claude call per refresh): cluster into **trend cards** — `{ id, kind: format | hook | topic | tactic | platform-change, platform, title, what, evidence[{url, metric, date}], strength: rising | steady | fading, firstSeen, lastSeen, recipe: { pack, preset, angle, hookPattern, structure[] } }`.
3. Merge with history: cards that keep showing up gain confidence; cards unseen for 3 refreshes fade and archive.
4. Personalize: if a product is set up, each card gets a one-line "for <product>: …" and the recipe adapts to its brand.

**UI — Trending page**: filters (platform, kind, rising only), card with evidence links and "seen since", and **Make one like this** → opens New campaign with the format, preset and a brief prefilled from the recipe. "Refresh now" and "last refreshed".

**Rules**: describe patterns, never copy posts or media; keep links, not content; no scraping behind logins; respect each source's terms and rate limits.

## D. More marketing materials

Research (Nov 2026): LinkedIn PDF/document posts are the top-engaging LinkedIn format (Buffer 45M-post study; Socialinsider 2026 benchmarks); Instagram carousels out-engage Reels; TikTok photo carousels are surging for small accounts though video still leads overall; founder-led, lo-fi video beats polish; B2B buyers want comparison pages, case studies and one-pagers early. Shipcast covers ~20 formats; the gaps that matter most:

| # | New format | Built on | Why |
|---|---|---|---|
| 1 | TikTok / IG photo carousel (9:16, 4:5) + music | carousel templates, new presets | Fastest-rising social format |
| 2 | Quote, testimonial & "post-screenshot" cards | graphics | Cheap, high-share proof |
| 3 | App Store / Play screenshot sets | graphics + device frames | Every app launch needs them |
| 4 | Product Hunt launch kit | graphics + copy | Gallery, thumbnail, tagline, maker comment |
| 5 | Social profile kit | graphics | LinkedIn/X/YouTube banners, avatars, OG + GitHub social preview |
| 6 | Battlecard & comparison page | document + landing | Top B2B asset for sales |
| 7 | Case study | document | Proof at decision stage |
| 8 | Newsletter issue (email + LinkedIn newsletter) | email + document | Owned-audience comeback |
| 9 | Blog / SEO article + hero image | markdown + graphics | Search + AI-answer visibility |
| 10 | Audiogram / podcast & founder clip | render: waveform scene + captions | Founder-led audio/video |
| 11 | Press kit | document + zip | Press release, fact sheet, logos, shots |
| 12 | Webinar / event kit | pipeline: landing + slides + emails + posts | One brief, whole event |
| 13 | Release-notes / changelog graphics & clip | graphics + reel | Ongoing product marketing |
| 14 | Pinterest pins & YouTube end screens | graphics presets | Long-tail discovery |

Each format: pack + SKILL.md + catalog + audits + a preview tile + one golden brief. Later: memes, booth/event print, merch mockups, interactive calculators.

## E. Quality during and after generation

**During**
- *Scene preflight (video)*: before the full render, render one still per scene and run the layout audit (text size, safe zones, legibility of screenshots, caption/headline collision, empty frames). Problems go back to Claude while it's cheap.
- *Critic pass (all formats)*: after the first clean render, one vision call scores the piece on the eval rubric; any criterion ≤ 2 gets one targeted revision. Budgeted per run; skipped on render-only.
- *Transition audit (video)*: sample mid-transition frames; flag half-wiped text and empty frames the eval keeps catching.
- *Learned lessons* (Track B) in every prompt.

**After**
- *Golden set*: 8 fixed briefs across formats re-made nightly (opt-in) → eval → score history; a drop of ≥ 0.3 on any format raises a regression card.
- *Quality page*: score per format over time, top failure categories, what the learning loop changed.

## Milestones

| M | Scope | Done when |
|---|---|---|
| M1 | Agents service, job store, scheduler, budgets, quiet hours, UI list + Run now | Jobs run on schedule, yield to foreground, tested with fake clock |
| M2 | Incident taxonomy + collector + lesson synthesis + prompt injection + measurement | Lessons appear from real runs; carousel tiny-screenshot rate measurable |
| M3 | Trend collectors (HN, Reddit, Google Trends, YouTube) + synthesis + store + Trending page + Make one like this | Page shows ≥ 10 evidence-backed cards; prefill works |
| M4 | Quality in the loop: scene preflight, transition audit, critic pass | Eval average on video ≥ +0.3 on the golden set |
| M5 | New formats 1–7 | Each renders, audits and passes its golden brief |
| M6 | New formats 8–14, golden set nightly job, Quality page | All live; docs, README, CHANGELOG |

## Testing

- Unit: scheduler (fake clock, yielding, budgets), taxonomy classifier on recorded events, lesson measurement maths, trend merge/decay, each collector against recorded fixtures (no network in tests).
- Service: agents service health/run-now; Trending and Learning API endpoints.
- Live: one real trend refresh; one learn pass on this machine's history; golden set run + eval before and after M4.
- Every commit: `npm test` green.

## Risks

- **Subscription quota** — background jobs share it: hard cap, foreground priority, quiet hours, visible spend.
- **Lessons that overfit** — measured and auto-retired; capped at 8 per pack; human toggle.
- **Trend noise / stale data** — evidence required on every card; decay; dates always shown.
- **Source terms** — public endpoints only, cached, rate-limited; no login scraping; links not content.
