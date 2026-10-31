Use the `shipcast:feature-explainer` skill (it builds on `shipcast:storyboard` — read both, and `./catalog.md`).

- Feature: "{{feature}}" — if blank, pick the feature this product's users most need explained (the one with real rules, roles or money involved), and say why in NOTES.md.
- Length **{{length}}**, for **{{audience}}**. Preset `{{preset}}`. Voice `{{voice}}`, speed 1. Captions `{{captions}}`.
- Capture tool for anything missing: `node {{plugin}}/skills/app-capture/scripts/capture.mjs plan.json` (the running app is described in the app step's `out/app.json`, if there is one; otherwise work from the screenshots in the brief).
- Write `out/storyboard.json` with `chapters` and `"chapterCards": "part"`, plus `out/script.md`. Don't render it yourself.
