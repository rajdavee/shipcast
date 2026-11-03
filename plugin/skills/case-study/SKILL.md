---
name: case-study
description: Make a customer case study as two Shipcast specs — out/document.json (a 2–4 page PDF: customer snapshot, challenge, solution, results in big numbers, the customer's quote, what's next) and out/graphics.json (a 1080×1350 social summary card and a 1200×627 LinkedIn card) — rendered by the Shipcast stills service. Never invents customers, quotes or numbers: without a real story it builds a clearly labelled template. Use when someone asks for a case study, customer story, success story or proof for the decision stage.
---

# Case study (document + graphics specs)

Buyers read case studies when they're close to deciding: "did this work for
someone like me, and how much did it change?" That only persuades if every
name, number and word is real.

Read `./catalog.md` first — the document catalog, then the graphics catalog.
Never invent a layout or field.

## Honesty rules (non-negotiable, checked after rendering)

- **Never invent a customer, a person, a quote, a logo or a number.** Use only what the brief, `product-facts.md`, the source site (a published customer story, a public review) or the prompt's story option gives you. Note where each fact came from in `out/NOTES.md`.
- **Quotes are word for word** from that source (trim with "…" only), attributed exactly as the source does.
- **No real story? Build the template**, clearly labelled:
  - `"sample": true` on `document.json` — every page then carries *Sample — replace with your customer*;
  - customer "Sample Co", people "Name, Role, Company", numbers as obvious placeholders tied to what the product really does (e.g. "1 day | from brief to every asset | was ? weeks"), quote "Replace with a real quote from the customer, word for word.";
  - `"sample": "yes"` on both cards;
  - `out/NOTES.md` starts with `## What's needed to make this real`: the customer and their approval, 2–4 before/after numbers with how they were measured, one approved quote, their logo (with permission), and a 20-minute interview guide (5–7 questions).
- A customer's logo only if the brief has the file **and** the story is public; otherwise their name in text.

## Output

1. `out/document.json` — 2–4 pages:

| Page | Layout | What goes on it |
|---|---|---|
| 1 | `cover` | Kicker "Case study", the result as the title (≤ 12 words), one-line subtitle "How <customer> …", optional real product screenshot |
| 2 | `case-snapshot` | 3–6 snapshot facts (industry, size, region, customer since, products used), "at a glance" (≤ 3 sentences), the challenge (~200–260 words, their words where possible) |
| 3 | `article` | The solution: what they did, how it rolled out (~200–280 words; a cropped real screenshot or a `steps` list helps). Skip for a 3-page study and fold into page 4's body. |
| 4 | `case-results` | 2–4 results "value \| what it measures \| before → after or timeframe", how they got there (~120 words), the quote with who said it, what's next (2–3 sentences) |

2. `out/graphics.json` — the same story as two cards, same theme for both:

```json
{ "items": [
  { "type": "card", "layout": "case-card", "theme": "editorial", "preset": "linkedin-image", "name": "cards/case-study-portrait.png", "fields": { "client": "…", "title": "…", "stats": ["3× | faster month-end close"], "quote": "…", "who": "Name, Role" } },
  { "type": "card", "layout": "case-card", "theme": "editorial", "preset": "linkedin-landscape", "name": "cards/case-study-linkedin.png", "fields": { "…": "same fields" } }
] }
```

3. `out/summary.md` — a LinkedIn post (hook line with the result, 3–5 short lines, link placeholder for the PDF), and alt text for each card.
4. `out/NOTES.md` — sources for every fact, or the "what's needed" list for a template.

Don't render anything yourself — the worker renders both specs, checks page
fit, page fill, type size, the cards' safe margins and that a template is
labelled everywhere, and sends problems back.

## Word budgets and legibility

- Headlines state the result ("Month-end close in 2 days, not 9"), not the topic.
- Big numbers: ≤ 6 characters each ("3×", "-62%", "2 days"); one idea per number; say what was measured and over what period.
- Cards: title ≤ 10 words, 1–3 numbers, quote ≤ 140 characters (the 1200×627 card shows it at 24 px — keep it to ~100). Type that the template must shrink past its floor comes back to you.
- Pages: never under ~55% full and never overflowing — the checker flags both. Text under 8 pt is flagged; cut words instead.
- Paper: `letter` for a US audience, otherwise `a4`.

Follow the brand voice section of the prompt for tone; the customer's own words carry more weight than ours.
