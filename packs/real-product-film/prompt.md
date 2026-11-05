Use the `shipcast:real-product-film` skill to make a product film campaign from real recordings of {{source}}.

- Scripts: `node {{plugin}}/skills/real-product-film/scripts/explore.mjs`, `takes.mjs` and `film.mjs` (usage at the top of each). Write plans and film specs to `./work/`.
{{#views}}- Views to explore and film: {{views}}{{/views}}
- Sign-in: {{signedIn}}. If yes, check `takes.mjs sessions` first. If there's no session for the host, run `takes.mjs signin <url>` and tell the user a Chrome window is waiting for them to sign in. Never type a password.
- Cuts: {{cuts}}, each in 9:16 and 16:9.
- Voice: `{{voice}}` (`none` means no voiceover; captions still run if there are on-screen lines). Voice settings: `"pace": 150, "pause": 0.35`.
{{#pronounce}}- Pronunciations (`"pronounce"` in the film spec): {{pronounce}}{{/pronounce}}
{{#brief}}- Client brief. Every requirement here becomes a B line in `out/rubric.md`, and the films must meet each one:

{{brief}}
{{/brief}}
- Do the five passes in order: product understanding, rubric, takes, films, then score-fix-repeat. Don't render a film before `out/product.md` and `out/rubric.md` exist.
