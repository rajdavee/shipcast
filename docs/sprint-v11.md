# Sprint v11: real-product films, made by Shipcast directly

A client campaign was made almost entirely outside Shipcast with hand-written scripts. These were: a signed-in recorder, phone and desktop takes with tap logs, a scene-based film builder using the real footage, per-scene voice with pacing, phrase-led karaoke captions, sound synced to taps, a critique loop against the client's brief, and a manual import into the Library. Every one of those steps belongs in the product. This sprint moves them in, so the next campaign of that quality comes out of **Create** directly.

## What we learned (from the campaign's mistakes log)
1. **Understand the product before writing.** Visit every view and every control, at phone and desktop size. Use the product's own words.
2. **Real footage beats screenshots.** Record takes at normal speed; log every tap (time and position) so sound and callouts can sync to it.
3. **Signed-in products need a supported "record with my login" flow.** Don't hand-copy cookies.
4. **Motion with intention.** One persistent device rig (3D rise, sway, restrained zooms), a desktop window for operator screens, callouts at real tap moments, and transitions that carry the story (dive into the result).
5. **Voice pace and pronunciation.** Target about 155 wpm with breaths between sentences; brand names need a pronunciation map ("EdgeTrack" was heard as "Edge Trek").
6. **Captions follow phrases.** Highlight the spoken word, use safe zones per format and scene, and never cover fields or buttons.
7. **Durations are targets.** A "15 s" cut that comes out at 12.7 s is a bug the build should catch.
8. **Score every render against the client's brief** (blocking lines plus craft), fix the weakest point, re-render, and log it.
9. **Brand assets:** logo PNGs may carry opaque backgrounds, and a white screen backing can leak after a device leaves. Check for both.
10. **Work made elsewhere should be importable** into the Library.

## Milestones
| M | Scope |
|---|---|
| M1 | **Takes recorder** (`engine/takes.ts`): record scripted takes of any URL at phone (390×844 @3x) or desktop (1440×900 @2x) through the CDP screencast. Steps: goto, tap (role + name / text / CSS), select, type, scroll-to, wait, mark. The output is an MP4 plus JSON (marks, taps with normalized positions). A local fixture page tests it. |
| M2 | **Signed-in sessions** (`engine/capture-session.ts`): "Sign in to record" opens a **visible** Chrome window on a per-workspace private profile; the user signs in; takes reuse the profile headless (with a visible fallback when a bot check appears). Profiles live in the workspace's private folder and can be forgotten in one click. |
| M3 | **Product explorer** (`engine/explore.ts`): opens each view and presses every non-destructive control (anything named submit, confirm, delete, send, pay, save, publish, approve, decline or revoke is skipped). It records dialogs, toasts and headings into a product-understanding draft. Runs only when the user turns it on for a URL. |
| M4 | **Demo film** (`engine/demofilm.ts` + render kind `demoFilm`): the campaign builder generalized. Spec = scenes (hook, title, ui with take window, card, cta, bumper) plus brand fonts and colours. It renders a phone rig and a desktop window; callouts and tap ticks come from take logs; there is a dive transition and a karaoke-captioned, energy-arc score. 9:16 and 16:9 are composed separately, and durations are checked against targets. |
| M5 | **Voice and captions:** the media `voice` handler gains `pace` (target wpm → tempo) and sentence pauses, plus a `pronounce` map; `phraseCues` in align (phrase-led, balanced, never across a scene). |
| M6 | **Pack `real-product-film`:** explore → product doc → rubric from the brief → shot list → takes → film spec → render main + 30 s + 15 s + bumpers, both formats → critique loop, logged in `iteration-log.md`. Claude drives it through plugin scripts (`takes.mjs`, `film.mjs`). |
| M7 | **Import** (`POST /api/campaigns/import`, install owner only): bring a folder of finished work into the Library as a project. Doctor reports which voice engines actually work. |
| M8 | Tests, docs, CI green, push. |

## Rules
- Recording and exploring only touch what the user points at; destructive controls are never pressed; submissions happen only in an environment the user marks as a demo.
- Session profiles are private to the workspace, never logged, and can be deleted.
- Films use real recordings only; there are no imitation screens.
