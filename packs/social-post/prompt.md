Use the `shipcast:thumbnails` skill for the art direction and the `shipcast:social-copy` skill's voice rules for the words.

Make **{{posts}} social posts**{{#topic}} about: {{topic}}{{/topic}}. Theme: `{{theme}}` (auto = what suits the brand).

Each post is one idea, told in one picture. For every post write these items into `out/graphics.json` (same idea, recomposed for each canvas — not just resized):

- `post-N-feed.png` — preset `instagram-post` (1080×1080), Instagram / Facebook / LinkedIn feed
- `post-N-portrait.png` — preset `linkedin-image` (1080×1350)
- `post-N-wide.png` — preset `x-image` (1600×900), X and link shares
- `post-N-story.png` — preset `story-image` (1080×1920), Stories; keep words out of the top 270 px and bottom 380 px

Mix layouts across posts (a big real number, a real product screen, a before/after) so the set doesn't look templated. Use real product UI from the brief's assets when there is any.

Then write the words:

- `out/captions.md` — one H2 per post, then H3s **LinkedIn** (120–200 words, hook in the first 2 lines, 3 hashtags at the end), **Instagram** (hook line, 3–6 short lines, 5–10 hashtags in a final block), **X** (≤ 270 chars), **Facebook** (2–4 sentences, conversational), **Alt text** (what the image shows, ≤ 200 chars).
- `out/captions.json` — `{ "posts": [ { "id": "post-1", "title": "…", "images": ["post-1-feed.png", …], "linkedin": "…", "instagram": "…", "x": "…", "facebook": "…", "alt": "…" } ] }`

Real claims only. No invented customers, quotes, ratings or numbers.
