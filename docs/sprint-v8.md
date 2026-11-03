# Sprint v8 — Pulse: Shipcast learns what actually works for you

Until now Shipcast learned from its own checks (did the text fit, was the crop readable). This sprint closes the real loop: **what happened after you posted**. Every published post reports back; Shipcast works out which formats, hooks, pillars, times, visuals and copy patterns win *for this brand*, explains why in plain words, and quietly steers everything it makes next — while still trying new things.

## Research (Nov 2026)

| Source | What we can read | How |
|---|---|---|
| **YouTube** | views, likes, comments (Data API `videos.list?part=statistics`); watch time, average view %, subscribers gained (Analytics API) | Same Google app as uploads; add `youtube.readonly` + `yt-analytics.readonly` scopes |
| **LinkedIn (personal)** | impressions, members reached, reactions, comments, reposts — `memberCreatorPostAnalytics` | Needs the **Community Management API** (partner approval) — not self-serve. So: Postiz if it has it, **native export import** (LinkedIn lets creators export post analytics), **screenshot reading**, or quick manual entry |
| **Instagram** | views, reach, likes, comments, saves, shares, profile visits (`/{media}/insights`, `instagram_business_manage_insights`) | Via Postiz analytics now; direct later with the user's Meta app |
| **Postiz** | per-post likes, comments, shares, impressions… for every platform it posts to | Public API `GET /analytics/post/{id}` — **30 requests/hour** → a polite queue |
| **Anything else** | whatever the platform shows | **Screenshot import** (vision reads the numbers, you confirm) or CSV |

Benchmarks say engagement must be read **against reach, not followers**, and posts must be compared **at the same age** (a post at 2 hours vs 7 days isn't comparable). Typical rates differ wildly by platform (LinkedIn ~3–6 %, Instagram ~0.5–3 %, TikTok ~3–4 %) — so Shipcast never mixes channels in one number; it compares each post with **your own** history on that channel.

## Ideas (the creative part)

1. **Lift, not likes.** Every post gets one number per channel: *how it did compared with your usual*, at the same age (24 h / 3 d / 7 d / 30 d snapshots). "2.1× your median reach on LinkedIn at 3 days." Small histories are shrunk toward the median so one lucky post can't fool it, and every claim carries a confidence.
2. **What works for you — the Playbook.** Each post is described by features: channel, format, pillar, weekday and hour, hook type (question, number, contrarian, story, how-to, list, before/after…), length, media (PDF carousel, video, single image, text), slide count, hashtags, link-in-comment, trend-linked, CTA type. A small regularised model (ridge regression on log-lift, per channel) estimates each feature's effect after accounting for the others. The Playbook shows the top wins and losses with effect size, sample size and confidence — and a short plain-English "why" written from those numbers (the narrative never invents a number).
3. **Forecast before you post.** Drafts get a predicted range ("likely 0.8–1.6× your usual") from the same model, so you see which planned post is the weak one *before* it goes out. After posting, Shipcast scores its own forecasts — it tells you how much to trust it.
4. **Explore while exploiting.** Plan my month uses **Thompson sampling** over formats, hooks and slots: most posts use what works, ~20 % deliberately test something new (marked "Experiment" on the calendar), so the Playbook keeps learning and never collapses into one format.
5. **Write like your winners.** Captions get your own top posts as style examples; hook variants are seeded from your best-performing hook types; "Make more like this" on a winner creates a follow-up idea with the same pattern; "Remix" turns a winner into the other channels' formats.
6. **Best times, learned.** A weekday × hour heat-map of your lift per channel; "Use suggested slots" updates the cadence.
7. **Trends that fit you.** Trend cards get a "fits you" score from the Playbook (a trend that's a format you win with ranks higher).
8. **Lessons with real evidence.** The learning loop gains performance incidents: posts far below your usual become evidence for lessons, and lessons are judged by **lift**, not just by QA rates. The critic is calibrated: does a higher critic score actually predict lift? Shown on Insights.
9. **Pulse UI.** Published posts on the calendar wear a lift badge and a heat tint; the post drawer gets a Performance tab (snapshots over time, vs-usual, why); Insights gets Performance (leaderboard, Playbook, heat-map, format × channel matrix, forecast accuracy, goal tracking); a weekly digest notification ("Tuesday's carousel is 2.4× your usual — make a follow-up?").
10. **Fast manual capture.** Where no API exists, the reminder at 24 h / 7 d asks for numbers: a 5-field quick form, a drop zone for a screenshot of the platform's stats (read and pre-filled), or the platform's own CSV/XLSX export.

## Milestones

| M | Scope |
|---|---|
| M1 | Metrics store: snapshots per post × channel × age, manual entry, CSV import (LinkedIn/IG export shapes + generic), normalisation (rates, weighted engagement), lift vs own baseline with shrinkage; API; tests |
| M2 | Collectors: YouTube stats (+ scopes), Postiz analytics queue (≤ 30/h), screenshot reading (vision, confirm before saving); a `metrics` agent job that snapshots at 24 h / 3 d / 7 d / 30 d and nudges for manual numbers |
| M3 | Features + hook classifier (deterministic first, one batched call for the rest) + per-channel ridge model + Playbook + Forecast + forecast scoring |
| M4 | Feedback: planner (Playbook block + Thompson-sampled experiments + suggested slots), captions from winners, hook-variant seeds, trend fit, performance lessons, critic calibration, "Make more like this" / "Remix" |
| M5 | Pulse UI: calendar badges/heat, drawer Performance tab, Insights → Performance (leaderboard, Playbook, heat-map, matrix, forecast accuracy, goals), digest notification |
| M6 | Demo history (clearly labelled sample data) for the showcase, docs, CI green, push |

## Rules

- Numbers come only from platforms, exports, screenshots the user confirmed, or the user. Nothing is estimated and shown as real; forecasts are always labelled as forecasts.
- No scraping behind logins. Tokens stay in the secrets store. Postiz limits respected.
- Experiments are visible and capped (default 20 % of planned posts, adjustable, can be off).
- The model is small, local and explainable — every claim links to the posts behind it.

## Testing

Unit: snapshot ages, normalisation, shrinkage, ridge fit on synthetic data with known effects (recovers them), Thompson sampling distribution, hook classifier, CSV shapes, Postiz rate queue, forecast scoring. API tests for every route. UI: typecheck/build + screenshots. Live: seed a realistic 90-day history, check the Playbook finds the planted effects, plan a month and confirm experiments + Playbook steer it.

## Sources
[LinkedIn Member Post Analytics API](https://ppc.land/linkedin-enables-third-party-analytics-access-with-new-member-post-api/) · [Instagram media insights](https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/) · [Postiz post analytics](https://docs.postiz.com/public-api/analytics/post.md) · [Buffer: 52M posts engagement study](https://buffer.com/resources/state-of-social-media-engagement/) · [Engagement rate vs reach](https://influenceflow.io/resources/engagement-rate-and-reach-metrics-the-complete-2026-guide-to-social-media-success)
