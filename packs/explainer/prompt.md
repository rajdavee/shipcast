Use the `faceless-explainer` skill to make an explainer video.

Topic: "{{topic}}" — if blank, explain the problem this product solves and the insight behind its approach (from the brief's "The problem" and "What's different"), landing on the product as the natural answer in the last 20%. Teach first, sell last.

BRIEF.md fields: `workflow: faceless-explainer`, `aspect: {{aspect}}`, `length: {{length}}`, `language: en`, `voice: {{voice}}`, `angle: concept`.

Use the brand's colors and fonts. Prefer diagrams, counters and real UI crops over generic shapes. Burn in readable captions and also export `out/captions.srt`.

{{> hyperframes}}

Name the final file `out/explainer.mp4`.
