# Sprint v10: Reports, the Friday report that writes itself

Marketers spend about a third of their week reporting. Shipcast already knows what was made, what was published and how it did. This sprint turns that into the report a marketer would otherwise assemble by hand, and sends it to the boss or client.

## Research (Nov 2026)

**Where marketers' time goes**

| Finding | Source |
|---|---|
| Reporting and analysis take ~32% of working hours, the biggest single drain (content management 18%, data management 14%) | [B2B Marketing × Kingpin](https://www.b2bmarketing.net/?p=13244) |
| 88% say most of their time goes on reporting; reporting time is up 57% in 10 years; only 18% of time is creative (1,721 senior marketers) | [PHD × WARC](https://www.phdmedia.com/emea/marketers-spend-more-time-reporting-than-creating/) |
| 45% spend ≥ ¼ of the week on admin. Top causes: slow approvals 38%, poor data 34%, too many tools 33%, budget justification 33% | [Optimizely, Aug 2026](https://www.optimizely.com/company/press/uk-survey-ai-admin/) |
| 84% work overtime; 18% of tasks are automated, 47% could be | [Adobe, Jan 2026](https://ppc.land/84-of-marketers-work-overtime-adobe-study-exposes-the-productivity-crisis/) |

**What a good report is.** Executives want three questions answered fast: *are we growing, are we spending well, what do we decide next?* Each section should cover what happened, why it happened, and what we do next. Numbers alone change nothing. ([Pedowitz](https://www.pedowitzgroup.com/how-do-i-create-marketing-reports-that-executives-actually-read?hsLang=en), [AgencyAnalytics](https://agencyanalytics.com/blog/weekly-marketing-reports), [Protocol 80](https://www.protocol80.com/blog/marketing-quarterly-report-template))

**The market.** AgencyAnalytics, Whatagraph (IQ+) and DashThis (AI Insights Pro) all now have dashboards with AI summaries, chat over data, anomaly flags and scheduled sending ([comparison](https://www.tryatria.com/blog/best-agency-reporting-tools)). Their gap is that they only see numbers. They don't know *what you made*, *why it worked*, or which content to make next. Shipcast has the work and its results in one place: the playbook (v8), the calendar (v7) and the campaigns.

**Website data** (official APIs, free)
- **GA4 Data API** (`runReport`, scope `analytics.readonly`): 200k tokens per property per day on standard properties ([quotas](https://developers.google.com/analytics/blog/2023/data-api-quota-management)).
- **Search Console** `searchanalytics.query` (scope `webmasters.readonly`): up to 25k rows; top rows only ([limits](https://developers.google.com/webmaster-tools/limits)).
- Both use the same Google app as the YouTube connection.

## The idea in one line

Every Friday the workspace gets a one-page report. It covers what we shipped, how it did, why, and what we do next. The numbers are checked and the writing is in plain English. You can edit it, share it, or ask it questions.

## What makes it ours (the creative part)

1. **What we did, then what it did.** The report opens with the work (posts published, campaigns made, experiments run) and joins each piece to its result. Other tools can't do this.
2. **Why, with evidence.**
   - **Change breakdown:** "Impressions +3,200: LinkedIn +2,900, YouTube +300" (channel waterfall).
   - **Volume vs quality:** "more posts" vs "better posts", i.e. posts × reach per post.
   - Playbook findings that explain the winners.
   - Every sentence carries the numbers behind it.
3. **Next week, one click.** Three recommendations, each tied to a real action: plan these posts, more like this, remix, move to the better slot, add the missing numbers. **Approve plan** puts them on the calendar.
4. **Posts → site → signups.** Shipcast adds UTM tags to every link it publishes (`utm_source=<channel>&utm_medium=social&utm_campaign=<post>`). GA4 can then credit visits and key events (signups, demos) to the post that drove them: "Tuesday's carousel sent 214 visits and 9 signups."
5. **Goals with pace.** Set targets (leads, followers, visits). The report shows progress and pace: "on pace for 82 of 100; +4/week closes the gap."
6. **Notable.** Anomaly flags against your own weekly history (robust z-score), plus streaks ("6 weeks of growth on LinkedIn").
7. **Notes on the timeline.** Mark outside events ("pricing page launched", "conference week"). They show on charts and the writer uses them to explain changes.
8. **Honest coverage.** The report says what it can't see ("3 LinkedIn posts have no numbers yet; GA4 not connected"). On Thursday a reminder asks for the missing numbers so Friday's report is complete.
9. **Written for the reader.** Audience modes:
   - *Boss*: outcomes, short.
   - *Client*: wins first, polite, no jargon.
   - *Team*: tactical detail.

   A writer that can't invent numbers: every figure in the text must appear in the fact sheet, or the sentence is dropped.
10. **Ask the report.** "Why did October dip?", "Compare this month with last", "Which pillar brings signups?" Answers come from the facts and your data, cite their numbers, and show a small chart.
11. **The week in one card.** A 1080×1350 image of the week (headline, three numbers, best post), for Slack or a build-in-public post.
12. **Every format a boss asks for.**
    - A web page, with a share link (read-only, revocable, optional expiry).
    - PDF, PowerPoint, email and Slack, and CSV of the data.
13. **Agency rollup.** For someone in several workspaces: every client's week on one screen, with the ones needing attention first. Each card only shows that workspace's own report.
14. **Time saved.** Each report counts the hours it saved, using the research's per-report estimates, shown modestly.

## Design

**Facts first, words second.** `report-facts.ts` builds a deterministic **fact sheet** for a period, compared with the previous period (and the same period last year when the data exists):
- KPI tiles with deltas and sparklines
- channel breakdown and change waterfall
- top and bottom posts by lift
- the work done
- website and search
- goals
- notable items, coverage and notes

The writer (one Claude call) turns facts into prose; a validator checks every number against the facts. With no Claude available, a template writer still produces a complete report.

**Storage** (per workspace, under `reports/`):
- `reports/<id>.json`: a frozen snapshot of facts plus prose. Edits keep a version.
- `reports/settings.json`: schedule, audience, recipients, goals.
- `reports/notes.json`
- `reports/shares.json`: hashed share tokens.

**Website connector.** A "Google Analytics & Search Console" connection reuses the Google app keys. The token is stored in the workspace secrets. The user picks the GA4 property and Search Console site from lists. A daily `site` job caches daily rows (sessions, users, key events, by source/medium and landing page; search clicks, impressions, CTR, position, top queries and pages), so reports never wait on Google.

**Delivery**
- Webhooks for Slack, Microsoft Teams, Discord and any generic URL.
- Email via SMTP. Shipcast has its own small client, with STARTTLS or TLS and no dependency.
- Default is *review first*: the report is prepared Friday morning and the owner gets a nudge. *Auto-send* is optional.
- The `report` agent job runs on the workspace schedule.

**Sharing.** `GET /r/<token>` serves a read-only page and its data. The token is 32 random bytes, stored only as a hash. It is revocable, has an optional expiry, and exposes no workspace ids, member emails or other routes. Sends are rate-limited.

**Permissions**
- Viewer: read reports.
- Editor: create, edit and ask.
- Admin: schedule, delivery, share links and Google connection.

## Milestones

| M | Scope |
|---|---|
| M1 | Fact sheet: periods, comparisons, KPIs, channel waterfall, volume/quality, top/bottom posts, work done, goals with pace, notable (robust z, streaks), coverage, notes; tests on seeded data |
| M2 | Writer + validator, audience modes, template fallback, recommendations tied to actions; report store, versions, API (create, list, read, edit, regenerate, delete) |
| M3 | Website: Google connection (GA4 + Search Console), property/site pickers, daily cache job, UTM tagging on publish, post → visits → key events; facts gain website and search sections |
| M4 | Outputs: report page UI (edit in place, hide sections, notes), share links, PDF, PowerPoint, CSV, week card image |
| M5 | Delivery: schedule, review-first / auto-send, SMTP email, Slack/Teams/Discord/webhook, Thursday missing-numbers reminder, `report` agent job |
| M6 | Ask the report (grounded Q&A with charts), agency rollup, time saved |
| M7 | Security review, sample data in the seeder, showcase, docs, CI green, push |

## Rules

- Numbers come only from stored data. Forecasts and paces are labelled as such. The text never contains a number that the facts don't.
- Share pages show only that report. Tokens are hashed. Revoking takes effect at once.
- Google tokens stay in workspace secrets. Only read-only scopes are used. Cached site data stays in the workspace.
- Email and webhooks go only to addresses the admin set. Sends are logged and rate-limited.

## Testing

- **Unit:** periods and comparisons, waterfall sums, volume/quality split, lift ranking, pace, robust z and streaks, coverage, number validator, template writer, UTM tagging, GA4/GSC response mapping (fixtures), SMTP dialogue (local fake server), webhook payloads, share token hashing and expiry, PPTX/CSV shape.
- **API:** every route signed in, with role checks, cross-workspace 404s, and share links that reach nothing else.
- **UI:** typecheck, build and screenshots.
- **Live:** seed 90 days, generate a weekly and a monthly report, check the planted effects show up in "why", export PDF/PPTX, and send to a local SMTP and webhook catcher.
