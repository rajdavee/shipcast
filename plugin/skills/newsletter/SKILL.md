---
name: newsletter
description: Write one issue of a recurring newsletter — inbox-safe HTML as a Shipcast email spec (email.json, rendered by the stills service with masthead, lead story, 2–4 short items, one product/CTA block, a forward-to-a-friend line and a compliant footer) plus the LinkedIn newsletter version (out/linkedin-article.md) with a 1920×1080 cover from a graphics spec. Use when someone asks for a newsletter issue, a weekly/monthly update or a LinkedIn newsletter.
---

# Newsletter issue (email spec + LinkedIn article)

A newsletter is a promise kept on schedule: one idea worth the reader's two
minutes, every issue. People open it for the name in the From line and the
subject; they stay subscribed because it is useful and never tricks them.

Read `./catalog.md` first (email blocks, fields, checks). Never invent a block type.

## Output

1. `out/email.json` — exactly **one** email, blocks in this order:

```json
{
  "theme": "light",
  "footer": { "address": "postal address from the brief", "reason": "You subscribed to Shipcast Notes at shipcast.dev." },
  "emails": [{
    "name": "Shipcast Notes 12",
    "subjects": ["Captions that keep up with you", "What changed in captions", "Issue 12: captions"],
    "preheader": "Word-timed captions, safer crops and one new format to try this week.",
    "blocks": [
      { "type": "masthead", "title": "Shipcast Notes", "issue": "Issue 12", "date": "3 Nov 2026", "tagline": "What we shipped, every other Tuesday" },
      { "type": "hero", "kicker": "Lead story", "headline": "Captions that *keep up*", "body": "…", "image": "assets/screens/captions.png#crop=0.1,0.2,0.5,0.4" },
      { "type": "items", "heading": "Also this issue", "items": ["Safer crops | One or two lines. | https://…", "…"] },
      { "type": "cta", "headline": "Try the new captions", "body": "…", "cta": "Open Shipcast", "url": "https://…" },
      { "type": "forward", "url": "https://…/newsletter" }
    ],
    "signoff": "— Maya, founder"
  }]
}
```

2. `out/graphics.json` — the LinkedIn cover, one item:
   `{ "items": [{ "type": "card", "layout": "article-cover", "theme": "midnight", "preset": "article-cover", "name": "linkedin-cover.png", "fields": { "kicker": "Shipcast Notes · Issue 12", "title": "Captions that *keep up* with you", "sub": "optional line", "image": "optional real screenshot with #crop" } }] }`.
   Fields: `kicker` ≤ 40, `title` ≤ 80 (≤ 12 words, one `*accent*`), `sub` ≤ 100, `image` optional. A screenshot on the cover must be a tight crop (about 250 px of real UI) or it comes back as unreadable — leave it out rather than shrink a whole screen.

3. `out/linkedin-article.md` — the same issue as a LinkedIn newsletter article:
   - First line `# Headline` — ≤ 100 characters, plain and specific (it is the article title).
   - The lead story in full, then `## ` subheads for the items and the ask (at least 2 subheads), 300–900 words.
   - Write for the feed reader who never got the email: no "in this email", no "click the button below". Links as plain markdown links.
   - Last line: where to subscribe to the email version, if the brief has the link.
   - Cover: `linkedin-cover.png` (uploaded as the article's cover image).

Don't render anything yourself — the worker renders the email and the cover and checks both files; problems come back to you.

## Rules (checked)

- **One idea per issue.** The lead story carries it; the 2–4 items are short (title + one or two lines + optional link) and support or round it out. No second lead.
- **Subjects ≤ 50 characters**, 3 genuinely different angles, no clickbait ("you won't believe", "shocking", "??", "!!", fake "Re:"/"Fwd:", ALL-CAPS words). Say what the issue is about.
- **Preview text** (`preheader`) 40–110 characters that adds to the subject.
- **Exactly one `cta` block** — the product ask. Item links are fine; a second button is not.
- **`forward` block** before the sign-off; give it the subscribe URL when the brief has one.
- **Footer**: the postal address from the brief and an honest reason; the unsubscribe link is added for you as `{{unsubscribe_url}}` (emails.md says how to swap it for your platform's tag). If the brief has no address, leave `address` out and say so in NOTES.md.
- **Scannable**: short paragraphs (≤ 3 sentences), `**bold**` for the one line a skimmer must see, no walls of text.
- **Every factual claim from the brief or source.** No invented numbers, customers, quotes, dates or "X teams use". If you're not sure, leave it out.
- Plain words: none of "excited to announce", "game-changer", "unlock", "seamless", "leverage", "elevate".
- Screenshots: real ones from `assets/`, cropped with `#crop=x,y,w,h` to the part the story is about.

Finish with `out/NOTES.md`: the one idea in one sentence, which subject to send first and why, the source for every number or claim used, and posting steps for LinkedIn (create the newsletter article, upload linkedin-cover.png, paste the markdown).
