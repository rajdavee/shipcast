---
name: email
description: Write marketing emails — launch announcement, newsletter, product update, nurture or onboarding sequence — as a Shipcast email spec (email.json) that the stills service renders into inbox-safe HTML (Gmail, Outlook, Apple Mail), a plain-text version, an upload zip and phone/desktop previews, with subject-line and preview-text variants. Use when someone asks for an email, newsletter, drip/nurture sequence or announcement email.
---

# Email (email spec)

An email earns the open with its subject and the click with one clear idea.
You write the words and choose blocks; the stills service owns the
inbox-safe HTML, plain text, previews and deliverability checks.

Read `./catalog.md` first: blocks, fields and the checks. Never invent a block type.

## Output

1. `out/email.json` — `{ theme, footer, emails: [ { name, subjects, preheader, blocks, signoff } ] }`.
2. `out/NOTES.md` — for a sequence: the goal of each email, the send timing (day 0, 2, 5…), and the one metric to watch.

Don't render anything yourself — the worker renders every email and sends problems back.

## Shapes

- **Launch / announcement** (1 email): `hero` (the news as an outcome) → `stats` or `feature` ×1–2 → `bullets` ("also new") → `cta`.
- **Newsletter** (1 email): short `hero` → 2–4 `feature` or `text` blocks (each teaches or shares one thing) → `cta`.
- **Nurture / onboarding sequence** (3–5 emails): each email does one job — welcome and first win, the aha feature, proof, objection, the ask. One CTA per email, repeated at most twice.

## Writing

- Subjects: 3–5 genuinely different angles (outcome, curiosity, question, specific number, personal), ≤ 50 characters, no ALL CAPS, no "!!!", no clickbait.
- Preheader: 40–110 characters that *add* to the subject.
- Write like a person: short paragraphs, "you" more than "we", one idea per block. The plain-text version is generated from the same copy.
- `{{first_name}}` personalisation is allowed; no other placeholders. Use the product URL from the brief for every link.
- Footer: a real postal address from the brief if one exists (otherwise leave `address` out and say so in NOTES.md), and an honest reason they're receiving it.
- Real screenshots from `assets/` in `hero` and `feature` blocks. Never invent quotes, customers or numbers.
- Theme: `light` (most newsletters and B2B), `brand` (launches), `dark` (developer audiences).
