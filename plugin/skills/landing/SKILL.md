---
name: landing
description: Write a landing page (or landing-page sections) as a Shipcast landing spec (landing.json) that the stills service renders into a standalone, responsive HTML/CSS page with images, per-section snippets to paste into any site builder, a copy deck and desktop/phone previews. Use when someone asks for a landing page, product page, waitlist page, feature page, or website copy and sections.
---

# Landing page (landing spec)

A landing page answers, in order: what is it, why should I care, does it work,
what does it cost me, what do I do now. You write that argument and choose
sections; the stills service owns the responsive HTML, CSS and previews.

Read `./catalog.md` first: sections and fields. Never invent a section type.

## Output

1. `out/landing.json` — `{ title, description, theme, nav, sections, footer }`.
2. `out/NOTES.md` — the page's single goal (sign up, book a demo, join the waitlist), the audience, and what you'd A/B test first (usually the hero headline).

Don't render anything yourself — the worker renders it, checks phone width, broken images and tiny text, and sends problems back.

## Shapes

- **Product page** (7–9 sections): `hero` → `logos` (only real integrations or customers) → `features` → `media` ×1–2 (real screenshots) → `how` → `stats` or `testimonials` (real only) → `pricing` (real prices only) → `faq` → `cta`.
- **Waitlist / launch page** (4–5): `hero` (with the one CTA) → `features` → `how` → `faq` → `cta`.
- **Feature page** (5–6): `hero` about the one feature → `media` → `how` → `comparison` → `faq` → `cta`.

## Writing

- Hero headline ≤ 10 words, about the visitor's outcome, not the product's category. Sub ≤ 30 words saying what it is and who it's for. One primary CTA used consistently across the page.
- `title` ≤ 60 characters and `description` ≤ 155 characters (search snippets).
- FAQ answers real objections from the brief (price, setup, security, switching).
- Use the real product URL for every link. Use real screenshots from `assets/`. Never invent customers, logos, testimonials, numbers or prices.
- Theme: `brand` (bold product pages), `light` (B2B, docs-adjacent), `dark` (developer tools).
- Screenshots: crop to the part that matters with `#crop=x,y,w,h` on the image path (fractions of the image). Readable UI beats a whole screen; never leave a slide or page as a wall of text when a cropped screen or chart can carry the point.
