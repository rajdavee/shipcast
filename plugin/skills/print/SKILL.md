---
name: print
description: Design print pieces — posters, flyers, roll-up banners, event and booth banners, table cards — as a Shipcast print spec (print.json) that the stills service renders into press-ready PDFs (3 mm bleed, crop marks) and high-resolution PNGs. Use when someone asks for a poster, flyer, roll-up, pull-up banner, trade-show or event signage, or anything to print.
---

# Print (print spec)

Print is read in passing, from a distance, in a few seconds. One message per
piece, huge type, a URL people can type. You write the words and pick sizes
and layouts; the stills service owns bleed, crop marks, scale and the PDF.

Read `./catalog.md` first: sizes, layouts and fields. Never invent a size or layout.

## Output

1. `out/print.json` — `{ "pieces": [ { name, size, theme, layout, fields } ] }`.
2. `out/NOTES.md` — where each piece will be used, the print-shop notes (paper, finish), and anything the user must confirm (date, venue, booth number).

## Rules

- Title ≤ 8 words (≤ 6 on a roll-up or banner). One `*accent*`.
- Roll-ups: logo high, message at eye level, ≤ 4 short points, URL low; never put key text in the bottom 30 cm (hidden by the stand and by people).
- Event pieces need real date, place and booth from the brief — if missing, leave the field out and list it in NOTES.md; never invent them.
- Real screenshots or photos from `assets/` only.
- Theme: `brand` for attention (posters, banners), `light` for information (flyers, table cards), `dark` for tech events and evening venues.
