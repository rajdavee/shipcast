## How to run the HyperFrames workflow here

This is an **autonomous Shipcast run** — the user said "just build it, stop asking" and pre-approved the final render.

- Skip skill freshness/update commands; the installed skills are current.
- Create the HyperFrames project under `./work/videos/<project>/`. Write its `BRIEF.md` yourself right after `init`, with `flow: automation`, `storyboard: no`, and the fields below. That brief is confirmed — ask nothing.
- Sign-in: run `npx hyperframes auth status` once. Signed out is fine: continue with local engines (Kokoro voice, local or synthesized music, whisper captions). If a capability has no local provider, drop it gracefully and say so in out/NOTES.md rather than stopping.
- Approval gates: autonomous mode. For the final "render now, or what changes?" gate, the answer is **render now** — once lint/check and proof snapshots pass, render.
- Reuse the campaign brief's `assets/` (logo, screenshots) and `brand.json` (colors, fonts) as the design system instead of re-capturing from scratch; capture the site only for what's missing.
- When done, copy the final render(s) to `./out/` with clear names, plus the contact sheet (`out/contact-sheet.jpg`) and a poster frame (`out/poster.jpg`).
