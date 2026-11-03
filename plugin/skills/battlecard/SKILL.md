---
name: battlecard
description: Make a competitive sales battlecard and a public comparison page as two Shipcast specs — out/document.json (one Letter/A4 battlecard page for the sales team: their pitch vs ours, where we win, where they win, landmines and objections with answers, proof points, pricing notes, numbered sources) and out/landing.json (an honest "X vs Y" page: hero, ✓/✗/partial comparison table, who should pick which, FAQ, CTA) — rendered by the Shipcast stills service. Use when someone asks for a battlecard, competitive one-pager, "us vs them" page, alternative page or comparison page.
---

# Battlecard & comparison page (document + landing specs)

Sales reps use a battlecard in the middle of a call; buyers read a comparison
page when they've already shortlisted both. Both only work if they are
**accurate and fair** — one wrong claim about a competitor and the rep, the
page and the brand lose the buyer's trust (and may invite a legal letter).

Read `./catalog.md` first — it holds the document catalog, then the landing
page catalog. Never invent a layout, section or field.

## Honesty rules (non-negotiable, checked after rendering)

- **Every claim about the competitor has a numbered source** from the brief's research (`research.md`, `product-facts.md`, the user's notes) or a public page you fetched now — their site, docs, pricing page, changelog, public reviews. Cite it inline as `[1]` and list it in `sources` as `[1] title — URL, date checked`.
- **No source → it's out.** List it in `out/NOTES.md` under `## To verify` (claim, where it came from, how to check). Never put "to verify", "TBD" or a guess on the public page; the battlecard may only carry it if it's clearly an internal note *with* a source for the suspicion.
- **No disparaging language.** Describe differences plainly and specifically ("No self-hosted option [2]"), never "clunky", "outdated", "overpriced", "a nightmare", "the worst". The checker rejects those words.
- **Be honest about where they win.** At least two real points. Reps need them to avoid landmines; buyers trust a page that admits them.
- **No competitor logos, screenshots or brand colours.** Name them in text only. Our own logo and real screenshots only.
- Don't state their prices unless a source dated this month shows them; otherwise describe the model ("per seat, annual") and cite it.
- Their pitch is in their words (paraphrase their homepage, cite it), not ours.

## Output

1. `out/document.json` — one page:

```json
{ "title": "Battlecard", "size": "letter", "theme": "clean", "pages": [
  { "layout": "battlecard", "fields": {
    "competitor": "Acme", "updated": "Nov 2026 · Sales enablement",
    "theirPitch": "All-in-one invoicing for agencies [1].",
    "ourPitch": "…",
    "weWin": ["…"], "theyWin": ["…"],
    "objections": ["They have more integrations. | True for accounting tools [1]; we cover the three our buyers use — show the list."],
    "proof": ["…"], "pricing": "…",
    "sources": ["[1] acme.com homepage — checked 3 Nov 2026"] } } ] }
```

2. `out/landing.json` — sections in this order: `hero` (headline "Us vs Them: …" naming both in text; the sub says who each is for), `versus`, `choose`, `faq` (4–6 real objections), `cta`. Optional: one `media` section with our real screenshot. **No `logos` section.**
3. `out/NOTES.md` — `## To verify` (every unsourced claim), `## Sources` (all, with dates), and how often to refresh the card (quarterly, or when their pricing page changes).

Don't render anything yourself — the worker renders both, checks the page fits,
the sources, the ✓/✗ cells, banned words and logos, and sends problems back.

## Battlecard (one page — word budgets)

- `theirPitch`, `ourPitch`: ≤ 40 words each.
- `weWin`: 3–5 items, ≤ 18 words each, each one specific and provable.
- `theyWin`: 2–4 items, honest.
- `objections`: 3–5 "what the buyer says | what we answer" pairs; the answer acknowledges what's true first, then reframes, then gives proof.
- `proof`: 2–4 real, sourced points (customers, numbers, certifications).
- `pricing`: ≤ 50 words — how to talk about price, not a price war.
- Body type is ~12.5 px; anything that would need smaller type means too many words — the checker flags type under 8 pt and any overflow. Cut, don't shrink.
- Size: `letter` for a US sales team, otherwise `a4`. Mark it internal (the template does).

## Comparison page

- `versus.rows`: 6–10 rows a buyer actually decides on; cells are `yes`, `no` or `partial` only, detail and the `[n]` source go in the note. Include rows they win — an all-✓ column reads as an ad and buyers discount it.
- `choose`: 3–4 honest reasons for each side ("Pick Acme if you need a built-in CRM").
- Headline ≤ 10 words, factual ("Shipcast vs Acme: local-first or hosted?"), never "Why Acme sucks" or "Acme alternative that's better".
- Date the comparison in the FAQ or the table sources ("Checked November 2026").

Follow the brand voice section of the prompt for tone.
