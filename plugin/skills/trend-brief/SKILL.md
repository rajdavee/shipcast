---
name: trend-brief
description: Research what is trending for a product's audience this week — topics, formats, hooks and conversations on Hacker News, YouTube and the open web — and turn it into a trend brief with ready-to-make content briefs mapped to Shipcast formats. Use when someone asks what's trending, what to post this week, content ideas, or a trend report.
---

# Trend brief

Marketers don't need a list of trends; they need to know which ones their
audience cares about and what to make about them this week.

## Research (15–25 minutes of looking, not more)

1. Read the campaign brief: product, audience, category, competitors.
2. Write 4–6 search angles: the category, the audience's job, the main pain, competitor names, the platform where the audience lives.
3. Run `node <skill dir>/scripts/trends.mjs status`, then:
   - `trends.mjs hn "<angle>" --days 30` for developer, startup and tech audiences;
   - `trends.mjs youtube "<angle>" --days 30` if a key is connected (what formats get views);
   - your WebSearch tool for: "<category> trends <month year>", "<audience> LinkedIn posts this week", news in the category, new regulations or launches, and what competitors shipped.
4. Keep only signals with evidence (a link, a number, a date). Skip anything older than the window unless it's a lasting shift.

## Output

1. `out/trend-brief.md`:
   - **This week in one paragraph** — the 2–3 things that matter for this audience.
   - **Signals** — 5–10 rows: what's happening · evidence (link, points/views, date) · why this audience cares · how strong (rising / steady / fading).
   - **Formats that are working** — what posts/videos in this niche get traction right now (length, hook style, format), with examples.
   - **Hooks to borrow** — 8–12 hook lines adapted to the product (pattern, not copy).
   - **Don't touch** — trends that look tempting but are off-brand, risky or already saturated.
2. `out/briefs.json` — 5–8 ready-to-make ideas: `[{ "title", "pack": "<Shipcast format id: carousel | photo-carousel | social-post | quote-cards | reel | infographic | document | presentation | ad-set | email | landing | launch-film | youtube-video | copy-kit>", "angle", "hook", "why_now", "evidence": ["url"] }]`.
3. `out/NOTES.md` — sources checked and what you couldn't verify.

Every claim cites a source. Never invent numbers, quotes or "trends". Follow the brand voice section of the prompt for the hooks.
