---
name: social-copy
description: Write a launch copy kit from a campaign brief — LinkedIn posts, an X thread, YouTube title/description/chapters/tags, Instagram and TikTok captions, a Product Hunt listing, a Hacker News "Show HN", a newsletter blurb and short ad variations. Use when someone asks for social posts, captions, launch copy, a thread, or YouTube metadata for a product.
---

# Launch copy kit

Write like a sharp founder who respects the reader's time, not like a
marketing department. Every line must be specific to this product: its real
features, its real numbers, its users' real words.

## Banned

"Excited to announce/share", "game-changer", "revolutionize", "unlock",
"supercharge", "seamless", "streamline your workflow", "in today's fast-paced
world", "leverage", "elevate", "🚀 at the start of every line", more than 2
emoji per post, hashtags mid-sentence, fake urgency, invented stats or quotes.

## What to write

Pick channels from the prompt (`channels`, default all). Write
`out/copy.md` with one H2 per channel, and also `out/copy.json`
(`{ "<channel>": [ { "label": "...", "text": "..." } ] }`) so the studio can
show copy buttons.

| Channel | Deliverable |
|---|---|
| `linkedin` | 3 posts in different styles: story (personal build moment), insight (a contrarian lesson + product as proof), launch (crisp what/why/who). 120–220 words, line breaks every 1–2 sentences, hook in the first 2 lines (≤ 210 chars so it shows before "…see more"), 3 hashtags at the end. |
| `x` | One 5–8 post thread (each ≤ 270 chars; post 1 stands alone; last post has the link) + 3 standalone posts. |
| `youtube` | 5 title options (≤ 60 chars, curiosity + specificity), description (first 150 chars are the hook + link), chapter list if a video script is available, 15 tags. |
| `instagram` | Caption (hook, 3 lines value, CTA) + 20 hashtags in a separate block. |
| `tiktok` | 3 on-screen hook lines + caption ≤ 150 chars. |
| `producthunt` | Name, tagline (≤ 60 chars), description (≤ 260 chars), maker's first comment. |
| `hackernews` | "Show HN: …" title (plain, no hype) + first comment explaining what it is, how it works, what's next. |
| `newsletter` | Subject line × 3, preview text, 120-word blurb. |
| `ads` | 5 headline/primary-text pairs for paid social, each a different angle. |

Use `brand.json.voice` and the brief's Hooks section. Keep the product name
and URL exactly as in `brand.json`. If a channel needs a fact you don't have
(price, launch date), write `[ADD: price]` instead of inventing it.

Finish with `out/NOTES.md`: which post you'd publish first and why.
