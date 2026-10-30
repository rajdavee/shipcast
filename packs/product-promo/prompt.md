Use the `product-launch-video` skill to make a promo video for this product.

BRIEF.md fields: `workflow: product-launch-video`, `aspect: {{aspect}}`, `length: {{length}}`, `language: en`, `voice: {{voice}}` (voiceover: {{voiceover}}), `message:` the brief's one-liner{{#angle}}, `angle: {{angle}}`{{/angle}}{{#goal}}, purpose: {{goal}}{{/goal}}.

Shape: a hook in the first 2 seconds, the real "aha" flow from the brief (entry → key action → result) shown with the product's own UI, 1–2 proof points, then the CTA from brand.json. If voiceover is on, keep the script tight (≈2.4 words/sec) and export captions as `out/captions.srt`.

{{> hyperframes}}

Name the final file `out/promo.mp4`.
