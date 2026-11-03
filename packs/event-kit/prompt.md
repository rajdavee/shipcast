Use the `shipcast:event-kit` skill.

- Kind: {{kind}}.{{#title}} Title: {{title}}.{{/title}}
{{#when}}- When: {{when}} — copy it into event.json and from there, character for character, into every piece.
{{/when}}{{#speakers}}- Speakers (real, from the user): {{speakers}}
{{/speakers}}{{#url}}- Registration link: {{url}}
{{/url}}- Write `out/event.json` first (the single source of truth), then `out/landing.json`, `out/slides.json`, `out/graphics.json` (three promo posts in `out/promo/`) and `out/email.json` (invite, reminder, replay). They are rendered and cross-checked together.
- No invented speakers, attendee numbers, logos or testimonials.
