---
name: profile-kit
description: Make a matching social profile kit as a Shipcast graphics spec (graphics.json) — LinkedIn personal banner 1584×396 and company cover 1128×191, X header 1500×500, YouTube channel art 2560×1440, Facebook cover 851×315, a circle-safe 400×400 avatar, an Open Graph image 1200×630 and a GitHub social preview 1280×640 — rendered by the Shipcast stills service and checked against each platform's safe area. Use when someone asks for banners, headers, cover images, channel art, a profile picture, an OG image or a GitHub social preview.
---

# Social profile kit (graphics spec)

People meet a brand on its profiles before its posts. The kit is one design
system — the same theme, motif, logo and words — fitted to eight surfaces that
each crop the image differently and lay a profile photo over a corner.

Read `./catalog.md` first (layouts, fields, presets). Never invent a layout or field.

## Output

1. `out/graphics.json` — exactly these eight items, all with the same `theme`:

```json
{
  "items": [
    { "type": "card", "layout": "profile-banner", "theme": "midnight", "preset": "linkedin-banner", "name": "profile/linkedin-banner.png", "fields": { "title": "Invoices that *chase themselves*", "sub": "Reminders, payment links and a ledger in one place.", "url": "acme.com", "motif": "grid" } },
    { "type": "card", "layout": "profile-banner", "theme": "midnight", "preset": "linkedin-company-banner", "name": "profile/linkedin-company-banner.png", "fields": { "…": "same fields" } },
    { "type": "card", "layout": "profile-banner", "theme": "midnight", "preset": "x-header", "name": "profile/x-header.png", "fields": { "…": "same fields, url = the X handle" } },
    { "type": "card", "layout": "profile-banner", "theme": "midnight", "preset": "youtube-banner", "name": "profile/youtube-banner.png", "fields": { "…": "same fields" } },
    { "type": "card", "layout": "profile-banner", "theme": "midnight", "preset": "facebook-cover", "name": "profile/facebook-cover.png", "fields": { "…": "same fields" } },
    { "type": "card", "layout": "profile-avatar", "theme": "midnight", "preset": "profile-avatar", "name": "profile/avatar.png", "fields": { "bg": "theme" } },
    { "type": "card", "layout": "profile-banner", "theme": "midnight", "preset": "og-card", "name": "profile/og-image.png", "fields": { "…": "same fields", "image": "assets/screens/home.png#crop=0.05,0.08,0.5,0.55" } },
    { "type": "card", "layout": "profile-banner", "theme": "midnight", "preset": "github-banner", "name": "profile/github-social-preview.png", "fields": { "…": "same fields, url = the repo" } }
  ]
}
```

Don't render anything yourself — the worker renders every size and sends back
anything outside a safe area, type shrunk below its floor, a missing surface, or
mixed themes/motifs.

## Safe areas (the audit enforces them)

| Surface | Canvas | Keep words and logo… |
|---|---|---|
| YouTube channel art | 2560×1440 | inside the **centre 1546×423** — the only part every device shows (TVs show the rest, phones don't). This is the strict one. |
| LinkedIn personal | 1584×396 | right of the profile photo (bottom-left ~470×246) and 48 px from the sides; phones trim the edges |
| LinkedIn company | 1128×191 | right of the page logo (bottom-left ~250×86), 16–32 px margins |
| X header | 1500×500 | 60 px from top and bottom (phones crop them), right of the photo (bottom-left ~400×180) |
| Facebook cover | 851×315 | the centre ~640 px — phones cut the sides |
| Avatar | 400×400 | **inside the inscribed circle** — every platform crops to a circle (some to a rounded square) |
| Open Graph | 1200×630 | 65 px top/bottom, 100 px sides |
| GitHub social preview | 1280×640 | 40 px border |

The `profile-banner` layout already places the block inside these areas; only
the background motif bleeds to the edges. A problem report almost always means
the copy is too long — shorten it rather than moving things.

## Words (budgets)

- **Headline ≤ 6 words** (≤ 48 characters), one `*accent*`: the promise, not the product category. The same headline on every banner.
- **Supporting line ≤ 12 words** — who it's for or the proof. Leave it out on the company cover if the headline says enough.
- **URL or handle**: the real one for that surface (domain on LinkedIn/Facebook/OG, @handle on X, repo path on GitHub, channel handle on YouTube).
- No hashtags, no taglines in quotes, no "Welcome to our page".

## Legibility

- Banners are seen scaled to the screen: the headline must stay ≥ ~3.4% of the visible strip's width and the supporting line ≥ ~1.7% (the template's floors) — copy that forces it smaller comes back to you.
- YouTube on a phone shows the 1546 px strip at ~390 px wide: a 6-word headline is the most it can carry.
- Avatar: the logo mark alone, no words (a 1–2 letter monogram only if there is no logo). It is seen at 32–40 px.
- Screenshots only on `og-card` and `github-banner`, cropped (`#crop=x,y,w,h`) to a part whose UI text is readable at ~2.2% of the canvas width; never a whole page shrunk down.

## Design system

- One `theme` and one `motif` (`grid`, `rings`, `dots`, `plain`) for all eight items; `bold` and `midnight` read best at small sizes, `swiss` for sober B2B.
- Use the brand's real logo from the brief; never a platform's logo, icon, verified badge or colours.

Finish with `out/NOTES.md`: where to upload each file (Settings path per platform), the alt text for the OG image, and anything you couldn't confirm (e.g. the X handle).
