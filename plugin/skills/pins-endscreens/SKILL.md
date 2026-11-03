---
name: pins-endscreens
description: Make Pinterest standard pins (1000×1500, 3–5, a bold title overlay readable at grid size, the brand mark, no link text on the image) and a YouTube end-screen background (1920×1080, words and logo kept out of the zones where the two video elements and the subscribe button go) as one Shipcast graphics spec, plus pins.md with titles, descriptions and alt text. Use when someone asks for Pinterest pins, pin graphics, a YouTube end screen, end card or outro background.
---

# Pinterest pins and a YouTube end screen (graphics spec)

Both are long-tail discovery: pins are found by search for months, and the
end screen turns one view into the next. Both are seen small or covered, so
the rules are about what survives that.

Read `./catalog.md` first (layouts `pin` and `end-screen`, presets
`pinterest-pin` and `youtube-endscreen`). Never invent a layout or field.

## Pins — `pinterest-pin` 1000×1500, layout `pin`, 3–5 of them

- One searchable idea per pin, phrased the way people search ("Launch checklist for a solo founder", "Turn one link into 10 posts"). Title ≤ 8 words; optional `sub` ≤ 12 words; optional `kicker` ("Guide", "Checklist", "Template").
- **Readable at 236 px wide** (how the grid shows it): the title stays ≥ 64 px on the canvas — a longer title shrinks, goes under that floor and comes back to you. Prefer 4–6 words.
- **No link text on the image** — no URL, domain or "link in bio". The pin itself carries the link (put it in pins.md).
- The brand mark is placed for you; never a Pinterest logo, a save button or any platform mark.
- `image` (optional) is a real screenshot from the brief's assets cropped to one readable detail (`#crop=x,y,w,h`), or a real product photo. No stock people, no generated faces.
- Vary the angle across pins (how-to, checklist, before/after, a single feature), same theme on all.

## End screen — `youtube-endscreen` 1920×1080, layout `end-screen`, exactly one

- YouTube places two video elements (stacked on the right) and a round subscribe button (left of them) over the last 5–20 seconds. Those zones must stay empty: the layout keeps everything in the left column, and the audit flags any word or logo that reaches into them.
- `title` ≤ 7 words ("Watch *these* next"), optional `kicker` ("Thanks for watching") and `sub` ≤ 80 characters. No arrows, fake buttons, "subscribe" graphics or platform logos — the real elements are added in YouTube Studio.
- A copy with the zones outlined (`endscreen/end-screen.guides.png`) is made for you as a preview; upload `end-screen.png`. Never set `guides` yourself.

## Output

1. `out/graphics.json`:

```json
{ "items": [
  { "type": "card", "layout": "pin", "theme": "bold", "preset": "pinterest-pin", "name": "pins/01-launch-checklist.png", "fields": { "kicker": "Checklist", "title": "Your launch week in *one link*", "sub": "Videos, carousels and posts from a single URL.", "image": "assets/screens/home.png#crop=0.05,0.1,0.32,0.4" } },
  { "type": "card", "layout": "end-screen", "theme": "bold", "preset": "youtube-endscreen", "name": "endscreen/end-screen.png", "fields": { "kicker": "Thanks for watching", "title": "Watch *these* next" } }
] }
```

2. `out/pins.md` — per pin: title (≤ 100 characters), description (≤ 500 characters, natural search words, no hashtag pile-up), destination link, alt text. Then the end screen: which two videos to place and the subscribe element, and that the end screen must run ≥ 5 s.
3. `out/NOTES.md` — the angle of each pin and anything to confirm.

Don't render anything yourself — the worker renders every item, checks safe
areas, the zones, type size and link text, and sends problems back.

Real claims and real screenshots only; plain words.
