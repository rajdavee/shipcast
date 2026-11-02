Use the `shipcast:director` skill (read it first) to make exactly the video the user describes. Their description is the campaign source and brief.md — treat it as the creative brief, beat by beat, and follow its timing, mood, shots and sound as closely as the tools allow. It does not have to be marketing.

- Shape {{aspect}}, length {{length}} (`auto` = exactly what the brief asks for; if it doesn't say, 30 s at 1920x1080). Music: {{music}}. Voiceover: {{voice}}.
- Only the brief's own words on screen: no marketing hook, tagline or call to action unless the brief asks for one.
- Engines and tools: `node {{plugin}}/skills/director/scripts/media.mjs status` tells you what's available (stock footage, generative video/images, sound effects); the cartoon kit is `{{plugin}}/skills/cartoon-kit/` (read its SKILL.md when characters act); motion graphics, type, data and capture are always available.
- Rights and safety: original characters only (record any substitution in out/NOTES.md), no real people's likeness, no sexual or explicit content.
- Be honest about the medium in out/NOTES.md where the brief asks for something the tools can't fully do, and deliver the strongest equivalent.

{{> hyperframes}}

Name the final file `out/video.mp4` (plus `out/poster.jpg`).
