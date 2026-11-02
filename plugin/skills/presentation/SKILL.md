---
name: presentation
description: Write a presentation — pitch deck, sales deck, webinar, investor update, board or conference talk — as a Shipcast slides spec (slides.json) that the stills service renders into designed 16:9 slides, a PDF and an editable PowerPoint (PPTX) with speaker notes. Use when someone asks for a deck, slides, a pitch, a presentation or a PPTX.
---

# Presentation (slides spec)

A deck is a story told one idea at a time. You write the story, the slides and
the speaker notes; the stills service owns design, the PDF and the editable
PPTX.

Read `./catalog.md` first: it lists every theme, layout and field with limits.
Never invent a layout or field.

## Output

1. `out/slides.json` — `{ "title", "theme", "slides": [ { "layout", "fields", "notes" } ] }`.
2. `out/NOTES.md` — the audience, the one thing they should remember, the story arc in one line per slide, and why this theme.

Don't render anything yourself — the worker renders `slides.json`, checks every slide for overflow and small text, and sends problems back.

## Story shapes

- **Pitch / sales deck** (10–14): `title` → `statement` (the shift or the pain) → `cards` (what goes wrong today) → `bullets` or `product` (the solution, with a real screenshot) → `timeline` (how it works) → `product` (the aha moment) → `metrics` or `quote` (proof — real only) → `comparison` (before/after) → `pricing` (only real prices) → `closing`.
- **Investor update / board** (8–12): `title` → `metrics` (headline numbers) → `chart` (trend) → `bullets` (wins, misses, asks) → `timeline` (next quarter) → `closing` (the ask).
- **Webinar / talk** (12–20): `title` → `agenda` → per part a `section` and 2–4 teaching slides (`statement`, `bullets`, `chart`, `comparison`, `product`) → recap `bullets` → `closing`.

## Writing

- One message per slide. The headline is the takeaway, written as a sentence ("Payments wait until the evidence agrees").
- ≤ 5 bullets of ≤ 12 words. If you need more, split the slide.
- Speaker notes on every content slide: 2–5 sentences of what to *say* (not what's on the slide), including the transition to the next slide.
- Real screenshots from `assets/` wherever the product is the point. Never invent customers, logos, quotes, prices or numbers; label demo data as demo data.
- Theme: `brand` (default — brand-colour title/section/closing, light content), `light` (conservative audiences), `dark` (launches, keynotes, developer audiences).
- Screenshots: crop to the part that matters with `#crop=x,y,w,h` on the image path (fractions of the image). Readable UI beats a whole screen; never leave a slide or page as a wall of text when a cropped screen or chart can carry the point. A crop that cuts a card or panel is widened to show all of it; one wholly inside a panel stays a zoom. The checker reports UI text that lands too small and how far to tighten — for phone formats, show roughly 400–600 px of the screen's width at most.
