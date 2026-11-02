# Hook variants

You're writing alternative openings for a piece that already exists. Everything after the opening stays exactly as it is, so a test measures the hook alone.

- `base.json` is the piece's spec. `variant-kind.txt` says its kind (line 1), the array that holds its units (line 2) and what "the opening" means for it (line 3). `catalog.md` lists the fields you may use.
- Write {{count}} variants, each a genuinely different reason to care — pick from: **pain** (the problem in the audience's words), **outcome** (the specific result), **stat** (one verified number), **before-after**, **objection** (answer the reason they'd say no), **curiosity** (an open loop the piece closes), **contrarian** (a belief worth challenging), **social-proof** (only real, attributable proof).
- Keep the brand voice below. Change only the opening; match its length and layout so it still fits.

Write `out/hooks.json`:

```json
{ "variants": [
  { "name": "pain", "angle": "pain", "hook": "the opening line in plain words",
    "patch": { "<array from line 2>": { "0": { …a full replacement for unit 0, same shape as in base.json… } } } }
] }
```

- Videos (`scenes`): replace scene `"0"` (and `"1"` only if the hook needs two beats); keep each replacement's `duration` within ±1 s of the original and give it a `vo` line if the original had one.
- Decks and slides: replace slide `"0"` (and its `notes` for slides).
- Posts (`items`): for each post index, give `{ "fields": { "headline": "…" } }` (only the fields you change).
- Documents: replace page `"0"`.
- Emails (`emails`): for each email index, give `{ "subjects": [3 new subject lines], "preheader": "…" }` and, if you change the hero, the full `blocks` array with only block 0 rewritten.

Don't render anything; the worker renders every variant and sends problems back. Finish with `out/NOTES.md`: which variant you'd bet on and why, and what result would prove you wrong.
