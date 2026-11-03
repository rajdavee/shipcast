Use the `shipcast:press-kit` skill.

{{#news}}- The news: {{news}}
{{/news}}{{#spokesperson}}- Who can be quoted (real and approved — use these words and this name only): {{spokesperson}}
{{/spokesperson}}{{#contact}}- Media contact: {{contact}}
{{/contact}}{{#city}}- Dateline city: {{city}}
{{/city}}- Write `out/document.json` (the release: press-release pages; paper `{{size}}`, `auto` = letter for a US audience, otherwise a4; theme `{{theme}}`), `out/fact-sheet.json` (one fact-sheet page) and `out/press-kit.json` (the screenshots and logo files to bundle). The fact sheet, the zip and its README are made for you.
- Every fact, number and name comes from the brief or the source. Quotes only from people the brief or the user names; otherwise a labelled placeholder. No superlative without a source in the same sentence.
