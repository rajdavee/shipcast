---
name: event-kit
description: Make a webinar or event kit from one brief as five Shipcast specs that share one source of truth (out/event.json) — a registration landing page (landing.json), 16:9 title, agenda and speaker slides (slides.json), three promo posts at 1080×1080, 1080×1350 and 1200×627 (graphics.json) and invite, reminder and replay emails (email.json) — rendered by the Shipcast stills service and cross-checked so date, time, timezone, speakers and the registration link match everywhere. Use when someone asks for a webinar, live demo, workshop, meetup or launch-event promotion kit.
---

# Webinar / event kit (landing + slides + graphics + email specs)

An event fails quietly when the pieces disagree: a post says 5 pm, the email
says 17:00 CET, the page says GMT. Write the facts once and copy them.

Read `./catalog.md` first — it has the landing, slides, graphics and email
catalogs. Never invent a layout, section, block or field.

## 1. `out/event.json` first — the single source of truth

```json
{ "title": "Make a launch kit from one link", "date": "Tue 18 Nov 2026", "time": "17:00", "timezone": "GMT",
  "url": "https://shipcast.dev/webinar", "speakers": [ { "name": "Founder, Shipcast", "role": "Live demo" } ] }
```

- Date, time and timezone from the format options or the brief. If none is given, pick a weekday about two weeks out at a sensible hour for the audience and flag it as **to confirm** at the top of NOTES.md.
- One time format and one timezone abbreviation. Every piece copies `date`, `time` and `timezone` **character for character**; never "5 pm" in one place and "17:00" in another, never a second timezone.
- `url` is the registration link (from the options or the brief; otherwise the product URL + `/webinar`, flagged in NOTES.md). Every piece links to it — the replay too: the replay lives on the same page after the event.
- **Speakers:** names only from the options or the brief. Otherwise a role label ("Founder, Shipcast") or `[Speaker — to confirm]`. Never invent a person, a title, a photo or a guest.

## 2. The pieces

1. `out/landing.json` — sections in this order: `event` (eyebrow = the kind, headline = the outcome, sub, date/time/timezone, `where`, `length`, `cta` "Save your seat", `url`), `features` headed "What you'll learn" (3–4 concrete takeaways), `agenda` (3–6 `"17:00 | title | one line"` — agenda times only here and on the agenda slide), `speakers` (`"name | role"`), `faq` (4–6: is it recorded, how long, cost, who it's for, what to prepare), `cta` (repeat the register button and the date). No stats or testimonials you can't source.
2. `out/slides.json` — at least: `title` (kicker = the kind, title, subtitle, `meta` = "Tue 18 Nov 2026 · 17:00 GMT"), `agenda`, `team` (heading "Speakers", the same people as event.json), then whatever the session needs, ending with `closing` (cta + the registration URL). Speaker notes on every slide.
3. `out/graphics.json` — three `event-promo` cards in `out/promo/`: `instagram-post` (1080×1080), `linkedin-image` (1080×1350), `linkedin-landscape` (1200×627); same theme; title ≤ 9 words; `date`, `time`, `timezone`, `url` copied from event.json; `speakers` the same names; `cta` ≤ 24 characters.
4. `out/email.json` — three emails named `invite`, `reminder`, `replay`. Each states the date, time and timezone exactly as event.json and has one `cta` block linking to the registration URL. Invite: the outcome, who it's for, what they'll learn. Reminder: short, "tomorrow at …", the one thing they'll see. Replay: "Missed it? The recording of … (18 Nov 2026, 17:00 GMT) is up", same link. No agenda times in emails or posts.
5. `out/NOTES.md` — what to confirm (date, speakers, link), and a send schedule (invite −14 days, reminder −1 day and −1 hour, replay +1 day).

Don't render anything yourself — the worker renders all four specs and checks
them together (dates, timezones, register links, speaker names, page width,
overflow, email limits) and sends every problem back.

## Word budgets and legibility

- Promo posts: title ≤ 9 words; the date ticket must stay on one line per value — keep `date` ≤ 16 characters ("Tue 18 Nov 2026").
- Slides read from the back of the room: ≥ 20 px type, one message per slide.
- Landing hero headline ≤ 10 words; FAQ answers ≤ 40 words.
- Plain words: no "excited to", "unlock", "supercharge", "game-changer".
