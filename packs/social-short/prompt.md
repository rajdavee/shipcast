Use the `faceless-explainer` skill to make a vertical short-form video (Reels / YouTube Shorts / TikTok) about this product.

- 1080x1920, {{length}}. Hook style: `{{hookStyle}}` (pick from the brief's Hooks when `auto`). The first second must stop the scroll: big text + motion on frame 1, no logo intro.
- Fast rhythm: a new visual every 1.5–2.5s; real product UI crops from the brief's assets, zoomed and annotated.
- Word-by-word highlighted captions in the brand's display font, kept inside the safe zone (middle 1080x1420 — platform UI covers top and bottom).
- Voice: `{{voice}}` (`none` = music + on-screen text only).
- End on a loopable frame that cuts cleanly back to the hook.

BRIEF.md fields: `workflow: faceless-explainer`, `aspect: 1080x1920`, `length: {{length}}`, `language: en`, `voice: {{voice}}`, `destination: shorts`.

{{> hyperframes}}

Name the final file `out/short.mp4`; also write `out/caption.txt` (≤150 chars + 5 hashtags) and `out/captions.srt`.
