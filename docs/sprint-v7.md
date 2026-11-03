# Sprint v7 — Plan the whole content program, in a calmer app

Two tracks:

1. **Content calendar.** Plan every post for every channel in one place, make each one with Shipcast's formats, write the per-channel copy in your brand voice, and get it out — LinkedIn and Instagram first, then YouTube, X, TikTok and the rest.
2. **A simpler, modern app.** Shipcast grew a page per sprint. Fold them into a clear shell with fewer top-level places, one design system and progressive disclosure.

---

## Research (Nov 2026)

### Open-source schedulers — integrate with, don't copy

| Tool | Licence | What we take |
|---|---|---|
| **Postiz** | AGPL-3.0 | Ideas (calendar + preview per channel, "customer" separation, sets of channels). **Integration over HTTP**: its Public API (API key; list channels, upload media, create/schedule/list/delete posts, 30+ platforms incl. Instagram, TikTok, YouTube). Calling a self-hosted instance's API is not distribution of its code; no Postiz code enters Shipcast. |
| **Mixpost Lite** | MIT | Ideas only (daily/weekly/monthly slot views, hashtag groups, dynamic variables, drafts). Lite has no API (API is Pro) and only Facebook Pages, X and Mastodon. |
| Bulkit, Wilder, Socioboard and others | various | Reviewed for patterns (posting slots, queues, approval states); nothing to vendor. |

Rule as always: **no third-party code in the repo**; AGPL/unlicensed projects are ideas and HTTP APIs only.

### Platform publishing (official APIs, your own developer apps)

| Platform | Path | Notes |
|---|---|---|
| **LinkedIn** (personal) | Self-serve *Share on LinkedIn* product → `w_member_social`, `/rest/posts`, `/rest/images`, `/rest/documents` | No partner review. Text, link, image, multi-image and **PDF document (carousel)** posts. ~150 posts/member/day. Company pages need Community Management API approval → via Postiz. |
| **Instagram** | Instagram API with Instagram Login (`instagram_business_content_publish`) | Professional account only. Images, carousels (1–10), reels. **Media must be at a public URL** Meta can fetch → needs a tunnel/host; v7 routes Instagram through Postiz or a user-provided public media base URL. 25–50 posts/24 h. |
| **YouTube** | Data API `videos.insert` (own Google project, OAuth) | New projects: uploads are **private until the project passes Google's audit**; quota now its own bucket (~100 uploads/day). Shorts = vertical ≤ 3 min. |
| X, TikTok, Threads, Bluesky, Facebook… | via Postiz | X API is paid; TikTok needs an audited app. |

So: **three ways to publish, chosen per channel** — *Manual* (post kit + reminder, always works), *Direct* (LinkedIn, YouTube with your own app keys), *Postiz* (everything else, if you run it).

### Calendar UX patterns (Buffer, Later, Notion templates, Mixpost)
Month / week / list views + a status board (Idea → Draft → Ready → Scheduled → Published); quick-add; drag to reschedule with clear drop targets; "Today" + jump; per-channel preview of the actual post; posting slots per channel; ideas backlog beside the calendar; avoid deep nesting.

---

## Track 1 — Content calendar

### Data model (`~/.shipcast/calendar/`)
- **Post**: `{ id, title, status: idea|draft|ready|scheduled|published|failed, at?, tz, channels: [{ channel, account?, caption, firstComment?, hashtags[], mediaFrom?: {campaign, step, files[]}, publish: manual|direct|postiz, state, url?, error? }], format?, pillar?, campaign?, step?, trend?, notes, createdAt, updatedAt }`.
- **Plan**: pillars (themes with share %), cadence per channel (posts/week, preferred slots), date range.
- **Channels**: LinkedIn, Instagram, YouTube, X, TikTok, Threads, Facebook, Pinterest, Newsletter, Blog — with limits (caption length, hashtags, media types/sizes) used for validation and previews.
- Atomic JSON files per month; ICS feed (`/api/calendar.ics`) to subscribe from Google/Apple Calendar; CSV import/export.

### Features
1. **Calendar** — month, week and list views; status board; drag to reschedule; quick-add; filters by channel, pillar, status; "Today".
2. **Ideas backlog** — unscheduled ideas from you, from **Trending** cards ("Add to calendar") and from the plan generator; drag an idea onto a day.
3. **Plan my month** — one Claude call reads the brief, brand voice, Trending and your cadence, and fills a month with balanced ideas (pillars, formats, hooks), all as drafts you approve.
4. **Make it** — a post becomes a Shipcast deliverable (the right format for its channel) in its campaign; when it renders, the files attach to the post automatically.
5. **Per-channel copy** — caption editor per channel with live limits, brand score (existing scorer), hashtag sets, first comment; **realistic previews** of a LinkedIn post / Instagram post or carousel / YouTube card.
6. **Publish** — manual post kit (files + copy, one-click copy, reminder at the time) · direct LinkedIn and YouTube with your own app keys (OAuth on localhost) · Postiz bridge. A publisher loop in the agents service (no Claude) sends due posts, retries, records the URL.
7. **After posting** — mark published (manual) or record the live URL; feeds the learning loop later (engagement in v8).

## Track 2 — Modern, simpler app

- **New shell**: left sidebar with six places — **Create**, **Calendar**, **Library**, **Ideas** (Trending + backlog), **Brand** (voice + kit), **Insights** (quality + learning) — and **Settings** (Setup, agents, skills, connections) at the bottom. Header keeps status + ⌘K.
- **Command palette (⌘K)**: new piece, jump to a project/post, add idea, plan month.
- **Design system**: tokens (colour, type scale, spacing, radius, elevation), light/dark, one button/field/card/badge set; consistent empty states and loading.
- **Simplify Create**: one input, formats grouped by channel with search, advanced options folded away.
- **Settings in one place**: tabs for Connections (Claude, keys, publishing accounts), Generation, Agents, Skills.
- Accessibility: keyboard, focus rings, contrast; responsive down to tablet.

## Milestones

| M | Scope |
|---|---|
| M1 | Calendar store + API + channel catalogue + ICS/CSV + tests |
| M2 | New app shell, design tokens, sidebar IA, ⌘K, Settings consolidation (UI only; existing pages move in) |
| M3 | Calendar UI: month/week/list/board, drag & drop, quick-add, post drawer with per-channel copy, previews, brand score; Ideas backlog + Trending "Add to calendar" |
| M4 | Plan my month (Claude) + Make it (post ↔ deliverable linking) |
| M5 | Publishing: manual kit + reminders; LinkedIn direct; YouTube direct; Postiz bridge; publisher loop |
| M6 | Simplify Create/Library/Brand/Insights in the new shell; docs, README, CHANGELOG; live end-to-end run |

## Testing
Unit: store (atomic writes, month files, status transitions, validation per channel), ICS/CSV, plan parsing, publisher (fake clock, retries, per-channel adapters against recorded HTTP fixtures — no network). API tests for every route. UI: typecheck + build + Chrome screenshots of each page in light/dark for review. Live: plan a month for the Shipcast project, make two posts, publish one manually.

## Risks
- **OAuth on localhost** — redirect to `http://localhost:4317/oauth/<provider>/callback`; tokens in secrets.json only; never logged.
- **Instagram public media URL** — Postiz or a user-set public base URL; never silently upload media anywhere.
- **Posting is outward-facing** — nothing publishes without the post being explicitly scheduled by the user; a global "publishing paused" switch; dry-run mode in tests.
- **UI churn** — the shell lands first behind the same routes; pages move in without behaviour changes, then get simplified.

## Sources
[Postiz vs Mixpost](https://openalternative.co/compare/mixpost/vs/postiz) · [Postiz Public API](https://docs.postiz.com/public-api) · [Mixpost repo](https://github.com/inovector/mixpost) · [Share on LinkedIn (self-serve)](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin) · [LinkedIn PDF carousel via API](https://opentweet.io/answers/can-you-post-a-linkedin-pdf-carousel-via-api) · [Instagram content publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing) · [YouTube upload limits 2026](https://singhamandeep.com/?p=1574) · [Notion content calendar templates](https://www.notion.com/templates/collections/best-10-content-calendar-templates-for-ux-ui-designers)

## Status (2026-11-03)

| M | State |
|---|---|
| M1 store + API | Done — ten channels with limits, statuses, plan, ICS, CSV |
| M2 app shell | Done — sidebar IA, ⌘K, tokens, light/dark, tabbed Settings, old routes aliased |
| M3 calendar UI | Done — month/week/list, drag & drop, backlog, drawer with per-channel copy, checks, brand score, previews |
| M4 plan + make | Done — live run: 10 drafts for two weeks in 43 s; Make it rendered a carousel and attached its PDF |
| M5 publishing | Done — manual kits + reminders (verified live), direct LinkedIn/YouTube, Postiz bridge with withdraw-on-change, publisher loop with retries and pause |
| M6 simplify | Done — Create grouped with search; pages restyled in the shell |

Open: touch drag on phones (move via the drawer for now); Pinterest board picker for Postiz; LinkedIn company pages (needs Community Management API approval); engagement numbers back into the learning loop (v8).
