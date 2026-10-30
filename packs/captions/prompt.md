Use the `embedded-captions` skill to caption the user's uploaded video `{{video}}` (in the campaign's uploads folder; if blank, use the newest video file there).

- Look: `{{look}}` — clean = simple lower captions; bold-pop = word-by-word highlight in the brand accent; cinematic = elegant serif, generous spacing; behind-subject = captions embedded behind the speaker.
- Transcribe locally (whisper). Fix product names to match brand.json spelling.
- Never edit the footage itself.

{{> hyperframes}}

Name the final file `out/captioned.mp4` and also write `out/captions.srt`.
