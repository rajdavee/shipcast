---
name: infographic
description: Write a save-worthy, animated framework infographic for LinkedIn/Instagram as a Shipcast spec (infographic.json) — a multi-stage table (stages, what people think, where they go with real platform logos, what they do) on a dotted board with a looping highlight — plus the thought-leadership post text that goes with it. Use for "infographic", "framework post", "buyer journey", "cheat sheet", or any educational LinkedIn visual.
---

# Animated framework infographic

This is **authority content, not an ad.** People save it because it explains
their world better than they could. The product appears only as the author
and brand in the footer, and as the natural lens of the framework.

Read `./catalog.md` (column kinds, sizes, known logos) and the campaign brief.

## Output 1 — `out/infographic.json`

```json
{
  "kicker": "The buyer journey · 8 stages",
  "title": "Where buyers go *before they buy*",
  "badge": "Save this",
  "cursor": "Anil",
  "theme": "board",
  "size": "1080x1350",
  "columns": [
    { "label": "Buyer stage", "kind": "stage" },
    { "label": "What they think", "kind": "note", "tone": "yellow" },
    { "label": "Where they go", "kind": "chips" },
    { "label": "What they do", "kind": "note", "tone": "green" }
  ],
  "rows": [
    ["Problem awareness", "“I have a problem. Is there a better way?”", ["Google", "YouTube", "LinkedIn", "X", "Reddit"], "Search for solutions, watch explainers, find experts"]
  ],
  "footer": { "name": "Anil Salvi", "handle": "brandrobin.ai", "brand": "BrandRobin" }
}
```

## What makes it worth saving

1. **A real framework, end to end.** 6–8 rows that cover a whole journey or process in order (awareness → advocacy, idea → launch, signup → power user). Each row is distinct; no filler rows.
2. **The title is the promise.** "Where X go before they Y", "The N stages of …", "What … actually looks like". *Highlight* the twist with stars.
3. **Thoughts sound human.** Notes in the "think" column are first-person quotes, ≤ 60 characters: “Which one is best for me?”
4. **Places are concrete.** 2–6 real platforms per row, the ones this audience actually uses at that stage (developers: GitHub, Hacker News, Stack Overflow; marketers: LinkedIn, G2, YouTube; consumers: TikTok, Instagram, Reddit, Amazon). Mix in AI assistants (ChatGPT, Perplexity, Claude, Gemini) where people genuinely use them now.
5. **Actions are specific.** "Compare pricing, pros and cons", not "Research".
6. **Tie it to the product subtly**: the framework should make the reader realise the problem this product solves (e.g. a brand-monitoring tool → "you might not know they're talking about you"). Never pitch inside the table.

Keep every note under the limits in the catalog (the renderer rejects longer text).

## Output 2 — `out/post.txt`

The LinkedIn text, in the proven shape:

- Line 1: a contrarian or surprising statement (≤ 120 chars), e.g. "People do not just visit your website and buy anymore."
- A short list (one "- " line per stage) that walks the journey in plain words.
- One or two lines of insight ("And you might not even know they were looking at your brand.").
- A closing line that connects to the product's job, without a hard sell.
- 3 hashtags max. No emoji walls, no "excited to share".

Finish with `out/NOTES.md`: the angle in one line.
