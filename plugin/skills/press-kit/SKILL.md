---
name: press-kit
description: Make a press kit as Shipcast specs — out/document.json (a press release in press-release pages: release line, headline, subhead, dateline, lead, body, 1–2 attributed quotes, "About <company>", media contact, ### end mark), out/fact-sheet.json (a one-page fact sheet) and out/press-kit.json (the logo files and 3–6 full-resolution screenshots to bundle) — rendered by the Shipcast stills service into PDFs and out/press-kit.zip with a README. Never invents people, quotes or numbers. Use when someone asks for a press release, press kit, media kit, news announcement or fact sheet.
---

# Press kit (document specs + zip)

A journalist gives a release about ten seconds: the headline and the first
paragraph decide whether they read on, and the kit decides whether they can
write the story without emailing you. Plain, checkable facts beat adjectives.

Read `./catalog.md` first (the document catalog: `press-release` and
`fact-sheet` layouts). Never invent a layout or field.

## Honesty rules (checked after rendering)

- **No invented people, quotes, numbers, customers or awards.** Every fact comes from the brief, `product-facts.md`, the source or the format options; note the source of each in `out/NOTES.md`.
- **Quotes** (1–2) only from a person the brief or the user names, word for word if they gave words. If nobody is named, the name is `[Placeholder — quote from a named spokesperson]` and the words say what kind of quote goes there; the page labels it "Placeholder — needs a real, approved quote". A role label ("Founder, Shipcast") is fine as attribution when the brief gives the role but no name.
- **No unsourced superlatives** ("the fastest", "the only … that", "industry-leading", "#1"): say what is measurably true, or cite the source in the same sentence ("according to …", "[1]"). Plain words — no "excited to announce", "revolutionary", "seamless", "game-changer".
- Media contact: the one the user gave, else the brief's press/contact email; if there is none, `press@<domain> (to confirm)` and say so in NOTES.md.

## Output

1. `out/document.json` — `{ "title": "<company> — press release", "size": "a4|letter", "theme": "clean", "pages": [...] }`, 1–2 `press-release` pages:
   - page 1: `release` ("For immediate release" or an embargo line), `headline` (≤ 120 characters, the news in plain words: who did what), `subhead` (one sentence with the second most important fact), `dateline` ("BERLIN, 3 November 2026" — city in capitals, the real date), `lead` (≤ 60 words answering who, what, when, where, why), `body` (the facts: what it does, who it's for, availability, pricing, how to try it — short paragraphs, `### ` subheads allowed);
   - last page (or page 1 if it fits): more `body` if needed, `quotes` (`"exact words | Name, Role, Company"`), `company`, `about` (the boilerplate, 50–100 words, the same text on the fact sheet), `contact` (lines: name or role, email, phone). The `###` end mark is drawn on the last page for you.
   - Total ≤ 800 words without the boilerplate and contact (aim for 400–600). Inverted pyramid: most important first; nothing important after the quotes.
2. `out/fact-sheet.json` — one `fact-sheet` page, same `size` and `theme`: `title`, `tagline`, `facts` (5–9 `"label | value"`: Founded, Headquarters, Founders — names only if the brief names them —, Product, Pricing, Availability, Website), `highlights` (3–6, ≤ 14 words each), `numbers` (≤ 4 `"value | label | source"`, verified only — leave out rather than guess), `image` (a cropped real screenshot), `about` (the boilerplate), `contact`.
3. `out/press-kit.json` — what goes in the zip, all paths relative to the brief folder:

```json
{ "screenshots": [ { "file": "assets/screens/home.png", "caption": "The studio home screen" }, "…3–6 in total" ],
  "logos": ["assets/logo.svg"] }
```

   Screenshots go in **uncropped, at full resolution** (no `#crop`): journalists crop their own. Use the brief's real screens only; logos are the brief's own files (brand.json `logo`, plus any other logo files in assets/).
4. `out/NOTES.md` — sources for every fact; what the user must confirm (placeholder quotes, the media contact, embargo time) before sending.

Don't render anything yourself — the worker renders the release and the fact
sheet, builds `out/press-kit.zip` (press-release.pdf, fact-sheet.pdf, logos/,
screenshots/, README.md) and sends problems back: dateline, headline length,
word count, boilerplate, contact, quote attribution, banned phrases,
superlatives, page fit, type under 8 pt.

## Legibility

- Release body prints at ~11 pt; never shrink type to fit — cut words or move the quotes to page 2.
- The fact sheet is one page: if it overflows, drop a highlight before shortening the boilerplate.
- Paper: `letter` for a US audience, otherwise `a4`.
