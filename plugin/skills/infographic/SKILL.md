---
name: infographic
description: Write a save-worthy, animated framework infographic for LinkedIn/Instagram as a Shipcast spec (infographic.json) — journey tables, timelines, funnels or A-vs-B comparisons, dense with real platform logos, on one of five looks — plus the thought-leadership post text. Use for "infographic", "framework post", "buyer journey", "cheat sheet", "roadmap", "funnel", "comparison" or any educational LinkedIn visual.
---

# Animated framework infographic

The bar: a post people **save and re-share** because it explains their world
better than they could. Think of the best framework posts in your feed —
dense, specific, beautifully organised, and obviously made by someone who
knows the territory. The product appears only as the author's brand and as
the lens of the framework. Never an ad.

Read `./catalog.md` (layouts, looks, chips, limits) and the campaign brief.

## 1 · Find the idea (spend most of your effort here)

Research before writing. Use the brief, the product's site/README, and web
search if available. You are looking for a **framework the audience lives
through but has never seen drawn**: a journey, a sequence, a drop-off, or a
trade-off — in the product's space.

Good ideas are specific: "Where developers go before they adopt a tool",
"Where your GitHub stars leak", "How a meeting actually gets booked",
"Make vs use: launch content". Weak ideas are generic ("5 tips for growth").

Pick the layout from the *shape* of the idea:
- journey with several facets per step → `table` (4 columns is the classic)
- ordered plan, launch week, roadmap, story → `timeline`
- numbers that shrink stage by stage → `funnel` (use honest, sourced or clearly-illustrative numbers)
- two ways to do the same job → `compare`

Pick the look for the audience and brand: `board` (friendly, the default),
`paper` (premium, editorial, B2B), `sketch` (founders, whiteboard energy),
`glass` (dark, modern, dev/AI), `night` (dark board).

## 2 · Fill it like an expert

- **Density.** Every row/step carries real content. Tables: 4–7 chips per
  row; group related tools into one chip with stacked logos
  (`{"label":"AI assistants","icons":["ChatGPT","Claude","Gemini","Perplexity"]}`,
  `{"label":"Review sites","icons":["G2","Capterra","Trustpilot"]}`).
- **Places are real** — the ones this audience truly uses at that step,
  including AI assistants where people now ask first.
- **Thoughts are human**, first-person, ≤ 60 chars: “Has anyone actually used this?”
- **Actions are concrete**: "Read issues, scan closed PRs, look for teams like theirs", not "Research".
- **Title** promises the insight; one `*accent phrase*`. Kicker frames it ("The buyer journey · 8 stages").
- `badge: "Save this"`, `cursor`: the author's first name.
- **Footer**: author name + handle + brand. For the avatar, if `gh auth status`
  succeeds use `"avatar": "github:<login>"` (`gh api user --jq .login`);
  otherwise leave it out. The author option in the prompt wins over gh.

Respect every limit in the catalog; the renderer rejects overflow.

## 3 · Output

- `out/infographic.json` — the spec.
- `out/post.txt` — the LinkedIn text in the proven shape:
  - Line 1: a contrarian or surprising statement (≤ 120 chars).
  - A short walk through the framework, one line per step ("- ").
  - One or two lines of insight the picture can't say alone.
  - A closing line that connects to the product's job — no hard sell — and
    a question that invites comments.
  - ≤ 3 hashtags. No emoji walls, no "excited to share".
- `out/NOTES.md` — the angle in one line, and why this layout and look.
