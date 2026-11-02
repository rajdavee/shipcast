---
name: document
description: Write a print-ready marketing document — one-pager, sales sheet, case study, datasheet, ebook, whitepaper or report — as a Shipcast document spec (document.json) that the stills service renders into a PDF with real, selectable text plus page previews. Use when someone asks for a PDF, one-pager, sales sheet, case study, ebook, lead magnet, whitepaper or report.
---

# Document (document spec)

A marketing document is read, not skimmed: it has to earn every page. You
write the words and pick page layouts; the stills service owns typography,
grids, running heads, page numbers, contents and the PDF.

Read `./catalog.md` first: it lists every theme, size, layout and field with
limits. Never invent a layout or field.

## Output

1. `out/document.json` — `{ "title", "size", "theme", "footer", "pages": [ { "layout", "fields" } ] }`.
2. `out/summary.md` — 3–5 lines a marketer can paste when sharing the PDF (email intro or LinkedIn post), plus a suggested file name.
3. `out/NOTES.md` — the document type, who it's for, and why this structure and theme.

Don't render anything yourself — the worker renders `document.json`, checks each page for overflow, broken images and half-empty pages, and sends problems back to you.

## Shapes that work

- **One-pager / sales sheet** (1 page): a single `one-pager` page. Headline = the outcome; 3–4 benefits; up to 3 proof numbers; one CTA.
- **Datasheet** (2 pages): `one-pager`, then `table` (specs, integrations, security) or `features`.
- **Case study** (3–6 pages): `cover` → `case-study` (challenge, what changed, results, quote) → optionally `steps` (how they rolled it out), `stats`, `quote` → `cta`. Only real customers and results from the brief; for a product without customers, write a *worked example* clearly labelled as one (e.g. "Demo matter", "Illustrative scenario").
- **Ebook / guide / lead magnet** (8–16 pages): `cover` → `toc` → per chapter a `section` opener and 1–3 `article` pages, with `stats`, `chart`, `steps`, `comparison`, `quote` pages breaking up the reading → `cta`. Teach something genuinely useful; the product appears where it naturally helps, not on every page.
- **Whitepaper / report** (8–20 pages): `cover` → `toc` → executive summary `article` → chapters with `chart` and `table` evidence and cited sources → conclusion → `cta`.

## Writing

- Headlines state the point ("Payments wait until the evidence agrees"), not the topic ("Our approach").
- Article pages: about 280 words with an image, 420 without. Split long chapters across pages rather than cramming; but a page under half full looks unfinished — add substance or merge pages.
- Every number has a source (the brief, product-facts.md or a cited public source in `source`). Never invent customers, quotes, logos or statistics.
- Use real product screenshots from `assets/` on the cover, in articles and on the one-pager.
- The document speaks to the reader only. Never put production notes in it ("screens are from the demo seed", "described from the script") — those go in NOTES.md. A single honest label like "Fictional demo data" in the footer is enough.
- No placeholders: if the brief has no URL, use the product's domain from the brief or leave the field out. `[URL]`, TBD and lorem ipsum are flagged as errors.
- Pick the theme for the audience: `clean` (most B2B), `editorial` (thought leadership, finance, legal, premium), `dark` (developer and security products, launches).
- Size: `letter` for a US audience, otherwise `a4`.
- Screenshots: crop to the part that matters with `#crop=x,y,w,h` on the image path (fractions of the image). Readable UI beats a whole screen; never leave a slide or page as a wall of text when a cropped screen or chart can carry the point.
