Use the `shipcast:product-tour` skill (it builds on `shipcast:storyboard` — read both, and `./catalog.md`).

- Length about **{{length}}**. Preset `{{preset}}`. Voice `{{voice}}` (`none` → `"voice": null`, captions `none`).
{{#angle}}- Angle: {{angle}}{{/angle}}
- Real screens and recordings are in the brief's `assets/app/` when the app was captured; for a missing moment you can capture it with `node {{plugin}}/skills/app-capture/scripts/capture.mjs plan.json` against the running app (see the app step's `out/app.json`).
