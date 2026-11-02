---
name: quote-cards
description: Make quote and testimonial cards as a Shipcast graphics spec (graphics.json) — pull quotes, customer testimonials with name/role/initials avatar, and generic "post screenshot" cards — each rendered at 1080×1080, 1080×1350 and 1200×627 by the Shipcast stills service, plus captions and alt text. Use when someone asks for quote cards, testimonial graphics, social proof posts, review cards or a tweet-style card.
---

# Quote & testimonial cards (graphics spec)

Social proof is cheap to make and shared a lot — but only if it is real. A
card is the exact words, who said them, and nothing that distracts.

Read `./catalog.md` first (layouts, fields, presets). Never invent a layout or field.

## Honesty rules (non-negotiable)

- **Only real words.** Quotes, reviews and posts must appear in the brief, the source site/repo, `product-facts.md`, or the prompt's quotes option — copied word for word (trim with "…" only). Note where each came from in `out/NOTES.md`.
- **Only real people, attributed as the source attributes them.** Never invent a name, role, company, photo, rating, follower count or engagement number.
- **No real quote? Make it obviously sample copy**: placeholder words ("A real customer line goes here…" or a plausible line), name "Sample Person" / "Sample Co", and `"sample": "yes"` — the card is labelled *Sample copy — not a real customer* on the image. Say so in NOTES.md so the user swaps in a real one.
- The founder's or the brand's own lines (README, launch post, site copy) are real — attribute them to the brand or the founder by role.
- **No platform logos, verified badges or trademarks.** `post-card` is a generic post: avatar, name, handle, text, optional image, outline icons. Never write "Tweet", "on X", etc. on the card.

## Output

1. `out/graphics.json` — every card at all three sizes, recomposed by the template (not resized):

```json
{
  "items": [
    { "type": "card", "layout": "testimonial", "theme": "editorial", "preset": "instagram-post", "name": "card-1-square.png", "fields": { "quote": "We shipped our launch posts in an afternoon.", "name": "Jane Doe", "role": "Founder", "company": "Acme" } },
    { "type": "card", "layout": "testimonial", "theme": "editorial", "preset": "linkedin-image", "name": "card-1-portrait.png", "fields": { "…": "same fields" } },
    { "type": "card", "layout": "testimonial", "theme": "editorial", "preset": "linkedin-landscape", "name": "card-1-wide.png", "fields": { "…": "same fields" } }
  ]
}
```

Name files `card-N-square.png`, `card-N-portrait.png`, `card-N-wide.png`.

2. `out/captions.md` — one H2 per card: **LinkedIn** (2-line hook that adds context to the quote, ≤ 120 words, 3 hashtags), **Instagram** (hook line, 2–4 lines, 5–8 hashtags), **X** (≤ 270 chars), **Alt text** (the full quote and who said it, ≤ 250 chars).

Don't render anything yourself — the worker renders it, checks overflow, safe margins and type that had to shrink, and sends problems back.

## Layouts

- `pull-quote` — one striking line, set big. Best ≤ 120 characters; `source` is "Name, Role at Company" or "From our launch post". One `*accent*` phrase on the words that matter.
- `testimonial` — a customer quote (≤ 160 characters reads best, 220 max) with name, role, company. The avatar is initials unless the brief has their photo; never use a stock or generated face.
- `post-card` — a generic social post: the brand's own post (`avatar: "logo"`, the brand's name and handle) or a real public post quoted in the brief. ≤ 220 characters of text; an attached image only if it is a real screenshot (crop it with `#crop=x,y,w,h` so UI text stays readable — the wide size puts it in a narrow column).
- `quote-post` — the older minimal quote layout; prefer `pull-quote`.

## Legibility

- The quote is the hero: the template sets it at 40–100 px by length and flags it if it had to shrink further — shorten instead of fighting it.
- 1200×627 is short: keep wide-card quotes ≤ 130 characters and post text ≤ 160.
- Theme by mood: `editorial` (brand ground), `swiss` (light, sober B2B), `bold` (loud brand colour), `midnight` (dark, premium). Use one theme for the set so the cards read as a series.

Finish with `out/NOTES.md`: for every card, the source of the words (URL or file + line) or "sample — replace before posting".
