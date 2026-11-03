---
name: blog-article
description: Write a blog / SEO article — 1,200–2,000 words in out/article.md with search front matter (title ≤ 60, meta description ≤ 155, slug, primary and secondary keywords, FAQ), a 1200×630 hero and in-article figures cut from real product screenshots (a Shipcast graphics spec), rendered as a readable web page with desktop and phone previews and checked for on-page SEO. Use when someone asks for a blog post, SEO article, guide, how-to or comparison post.
---

# Blog / SEO article (article.md + graphics spec)

Write for the person who typed the search, then make it easy for search
engines and AI answers to see that you answered it. A page that answers the
query in its first paragraph, shows real proof and cites its sources wins
both; a page stuffed with keywords wins neither.

Read `./catalog.md` first for the graphics layouts and presets.

## Output

1. `out/article.md`:

```markdown
---
title: Launch video maker: from a link to a 30-second film
description: How to turn a product page into a 30-second launch video in minutes — what to show, what to say and how to check it before you post.
slug: launch-video-maker
keyword: launch video maker
keywords: [product launch video, launch video template, saas promo video]
hero: hero.png
date: 2026-11-03
author: Name from the brief
faq:
  - "How long should a launch video be? | 20–45 seconds for social; the first 3 seconds carry the hook."
  - "Do I need footage? | No — real screenshots and captions are enough for most products."
  - "Question three? | A real answer."
---

# How to make a launch video with a launch video maker

The first paragraph answers the search in 2–3 sentences…

## What a launch video maker should do
…
![The editor with the hook scene selected](figures/01-editor.png)
…
```

2. `out/graphics.json` — the hero and the figures:

```json
{ "items": [
  { "type": "card", "layout": "article-cover", "theme": "editorial", "preset": "og-card", "name": "hero.png", "fields": { "kicker": "Guide", "title": "From a link to a *30-second* launch film" } },
  { "type": "card", "layout": "article-figure", "theme": "editorial", "preset": "article-figure", "name": "figures/01-editor.png", "fields": { "image": "assets/screens/editor.png#crop=0.05,0.1,0.45,0.5" } }
] }
```

Don't render anything yourself — the worker renders the images and the page (article/index.html, article-desktop.png, article-mobile.png), runs the checks and sends problems back.

## Structure and SEO (checked)

- **Front matter**: `title` ≤ 60 characters with the primary keyword; `description` 70–155 characters that says what the reader gets; `slug` lowercase-words-with-hyphens; `keyword` (one primary); `keywords` 3–6 secondary, real variants people search; `faq` ≥ 3 real questions as `"Question? | Answer"`.
- **One H1** (`# `) — the article's headline, containing the keyword. Then `## ` sections (≥ 3), `### ` inside them. Never skip a level (no H2 → H4).
- **The primary keyword** in the title, the H1, the first 100 words and at least one H2 — said naturally. Keyword stuffing (> 2.5% of words) comes back to you.
- **1,200–2,000 words** in the body.
- **Answer the query in the first paragraph.** Then go deeper: steps, examples, trade-offs.
- **Cite sources with links**: every number, benchmark or claim about the world links to where it comes from (`[text](https://…)`). Product claims come from the brief.
- **No fabricated stats, quotes, customers or test results.** If the brief has no number, write without one.
- Plain words — none of "seamless", "unlock", "leverage", "game-changer", "in today's fast-paced", "delve".

## Writing

- People first: write the article you'd want to find. Short paragraphs, concrete examples, the reader's words not the company's.
- Lists and tables where they help someone compare or follow steps; a `> ` callout for the one thing not to miss.
- Mention the product where it genuinely solves the problem — once in context, once at the end with a link. A how-to must work even for someone who never buys.
- Comparisons: be fair; name a competitor's strength. Only claims you can source.

## Images

- **Hero** (`article-cover` at `og-card`, `hero.png`): the article's promise in ≤ 12 words, one `*accent*`; it is also the link preview. A screenshot on it must be a tight crop.
- **Figures** (`article-figure` at `article-figure`, `figures/NN-<slug>.png`): one per point that needs proof, cut from real screenshots with `#crop=x,y,w,h` to the part the paragraph talks about (about 300–600 px of the real screen's width — a whole screen comes back as unreadable). Optional `label` chip ≤ 40 characters; the caption belongs in the article: `![What the figure shows, as a sentence](figures/01-editor.png)` — the alt text is shown as the caption.

Finish with `out/NOTES.md`: why this keyword (who searches it), the sources used, suggested internal links, and the publish checklist (canonical URL, hero as the OG image, FAQ schema is in article/index.html).
