---
name: release-notes
description: Make release-notes / changelog graphics for a product update as a Shipcast graphics spec — a "What's new" card per headline feature at 1200×627 and 1080×1350 (each with a real screenshot crop), a 1080×1350 summary card with ≤ 5 items — plus out/release-notes.md (a human changelog entry and a short social post), all carrying the same version and date. Use when someone asks for release notes, changelog graphics, "what's new" posts or product-update announcements.
---

# Release notes graphics (graphics spec + markdown)

Ongoing product marketing is mostly "here's what changed". People skim it,
so each card shows one change, on the real screen, with the version and date
that make it trustworthy.

Read `./catalog.md` first (layouts `whats-new` and `release-summary`). Never
invent a layout or field.

## Find the release (real changes only)

1. The format options (version, date, what changed) win.
2. Otherwise, when the source is a repository: its `CHANGELOG.md` (the newest entry), then GitHub releases (`gh release view --repo <owner/repo>` if `gh` works), then the newest tag and the commits since the previous one.
3. Otherwise the brief. Never invent a feature, a version number or a date; if you can't find a version, use the date only as `version: "Update"` and say so in NOTES.md.

Pick 1–4 **headline features** — changes a user would notice and care about (not refactors or dependency bumps). Translate each into the benefit ("Exports keep your fonts"), not the ticket title.

## Output

1. `out/graphics.json` — all in `out/release/`, one theme:

```json
{ "items": [
  { "type": "card", "layout": "whats-new", "theme": "midnight", "preset": "linkedin-landscape", "name": "release/01-fonts-landscape.png", "fields": { "version": "v2.4", "date": "3 Nov 2026", "title": "Exports keep *your fonts*", "sub": "PowerPoint files now embed the brand typefaces.", "image": "assets/screens/export.png#crop=0.55,0.1,0.3,0.35" } },
  { "type": "card", "layout": "whats-new", "theme": "midnight", "preset": "linkedin-image", "name": "release/01-fonts-portrait.png", "fields": { "…": "same fields" } },
  { "type": "card", "layout": "release-summary", "theme": "midnight", "preset": "linkedin-image", "name": "release/summary.png", "fields": { "version": "v2.4", "date": "3 Nov 2026", "title": "What's new in *2.4*", "items": ["Exports keep your fonts — PowerPoint embeds the brand typefaces", "…2–5 in total"] } }
] }
```

   - Every headline feature gets **both** sizes with identical fields.
   - `version` and `date` are **identical** on every card and in release-notes.md (same spelling: "v2.4" everywhere, "3 Nov 2026" everywhere).
   - `image` is a **real screenshot** of the feature from the brief's assets — never the logo, an icon or a marketing graphic — cropped to the part that changed with `#crop=x,y,w,h`. At 1080 px wide the UI text must land at ≥ 24 px: crop to about a third of a desktop capture's width or less. A shrunken whole screen comes back to you.
   - Summary card: 2–5 items, "Title — one line". More changes go in the changelog, not the card.
2. `out/release-notes.md`:

```markdown
---
version: v2.4
date: 3 Nov 2026
---
# v2.4 — 3 Nov 2026

## Changelog
### Added
- …
### Changed
- …
### Fixed
- …

## Social post
One or two sentences on the change people will care about, ≤ 280 characters, no hashtags pile-up.
```

3. `out/NOTES.md` — where each change came from (changelog line, release, commit) and alt text for each card.

Don't render anything yourself — the worker renders the cards, checks
version/date consistency, the screenshot on every feature card, readable
crops, the summary length and the changelog, and sends problems back.

## Word budgets

- Feature headline ≤ 8 words, the benefit; sub ≤ 100 characters.
- Plain words: no "excited to announce", "supercharge", "seamless", "game-changer".
