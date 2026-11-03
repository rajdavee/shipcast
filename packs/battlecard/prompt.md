Use the `shipcast:battlecard` skill.

- Competitor: {{competitor}} (blank = the one the brief's research says buyers compare us with most).
{{#research}}- What the user knows about them (treat as leads to check, not facts): {{research}}
{{/research}}- Write `out/document.json` (one `battlecard` page; paper `{{size}}`, `auto` = letter for a US audience, otherwise a4; theme `{{theme}}`) and `out/landing.json` (the public comparison page).
- Every claim about the competitor comes from the brief's research or a page you fetched, with a numbered source. Anything you can't source goes in NOTES.md under "To verify" and stays off the public page.
