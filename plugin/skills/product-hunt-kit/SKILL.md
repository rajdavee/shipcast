---
name: product-hunt-kit
description: Make a Product Hunt launch kit — 4–6 gallery images at 1270×760 and a 240×240 thumbnail as a Shipcast graphics spec (graphics.json) rendered by the Shipcast stills service, plus out/launch-copy.md with the name, a ≤ 60-character tagline, a ≤ 260-character description, the maker's first comment and 3 topics. Use when someone is launching on Product Hunt or asks for a launch gallery, tagline or maker comment.
---

# Product Hunt launch kit (graphics spec + listing copy)

People decide in the feed from the thumbnail and the tagline, then on the page
from the first gallery image and the maker's comment. Make those four things
excellent; everything else supports them.

Read `./catalog.md` first (layouts, fields, presets). Never invent a layout or field.

## Output

1. `out/graphics.json`:

```json
{
  "items": [
    { "type": "card", "layout": "launch-thumb", "theme": "editorial", "preset": "producthunt-thumb", "name": "thumbnail.png", "fields": { "bg": "light" } },
    { "type": "card", "layout": "gallery-shot", "theme": "midnight", "preset": "producthunt-gallery", "name": "gallery/01-hero.png", "fields": { "kicker": "Open source", "title": "Invoices that *chase themselves*", "sub": "Reminders, payment links and a ledger in one place.", "image": "assets/screens/dashboard.png#crop=0.05,0.1,0.7,0.55" } },
    { "type": "card", "layout": "gallery-points", "theme": "midnight", "preset": "producthunt-gallery", "name": "gallery/03-why.png", "fields": { "title": "Why it's *different*", "items": ["No setup — import from your bank", "…", "…"] } }
  ]
}
```

2. `out/launch-copy.md` — exactly these sections (they are parsed and checked):

```markdown
## Name
Acme
## Tagline
Invoices that chase themselves
## Description
(≤ 260 characters: what it is, who it's for, the one thing it does better.)
## Maker's first comment
(100–300 words, first person.)
## Topics
- Fintech
- Productivity
- SaaS
```

Don't render anything yourself — the worker renders the images, checks overflow, safe margins, shrunk headlines, unreadable screenshots and the copy limits, and sends problems back.

## Images

- **Thumbnail** (`launch-thumb`): the logo mark alone, no words — it shows at 80 px and smaller. `bg: "light"` unless the mark is light, then `dark`; `brand` only when the mark contrasts with the brand colour.
- **Gallery, 4–6 images, 1270×760**, in order: (1) the promise + the hero screen (`gallery-shot`) — this is the image people share; (2–4) one feature each, a real screen cropped to the part that proves it with `#crop=x,y,w,h`; one `gallery-points` for "why it's different"; last = how to start (pricing/free tier/open source — only if true).
- Headlines ≤ 8 words, one `*accent*`; they must sit on 2 lines at ≥ 44 px or they come back to you.
- One theme for the whole gallery.
- **Do not use Product Hunt's logo, cat mascot, kitty, upvote arrow, badges or brand colours as decoration**, and don't write "Product of the Day" or rankings you haven't won. Your own brand only.

## Copy

- **Name**: the product name as it is used on the site.
- **Tagline ≤ 60 characters**: what it does in plain words, no product name, no emoji, no "AI-powered" unless that is the point. Specific beats clever ("Invoices that chase themselves").
- **Description ≤ 260 characters**: who it's for, the problem, the one thing it does better, and the proof (open source, a real number).
- **Maker's first comment, 100–300 words, first person**: who you are, why you built it (the moment), what it does today (3 short bullets), what's next, a launch-day offer only if real, and one specific question you want feedback on. No "excited to announce", no hype words.
- **Topics**: exactly 3 existing Product Hunt topics, most specific first (e.g. "Developer Tools", "Open Source", "Marketing").
- Real claims only: no invented users, ratings, testimonials or numbers.

Finish with `out/NOTES.md`: alt text for each gallery image, which image is first and why, and a launch-day checklist (post at 12:01 a.m. Pacific, reply to every comment, share the page link — not a request for upvotes).
