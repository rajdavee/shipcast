Use the `shipcast:case-study` skill.

{{#customer}}- Customer: {{customer}}
{{/customer}}{{#story}}- The customer's story from the user (real — use these facts, numbers and quote word for word): {{story}}
{{/story}}- Write `out/document.json` (2–4 pages; paper `{{size}}`, `auto` = letter for a US audience, otherwise a4; theme `{{theme}}`) and `out/graphics.json` with the two `case-card` images in `out/cards/`.
- Only a real customer story from the brief or the user. If there is none, build the template version the skill describes: `"sample": true`, sample cards, and NOTES.md listing what's needed.
