# Writing a format pack

A pack is one kind of deliverable. It is a folder in `packs/` with two files.
No code, no build step — restart Shipcast and it shows up in the studio.

```
packs/
  my-format/
    pack.json   what it is, its options, where its outputs land
    prompt.md   what Claude is asked to do
```

## `pack.json`

```json
{
  "id": "my-format",
  "name": "My Format",
  "tagline": "One sentence the studio shows on the tile.",
  "category": "video",
  "order": 20,
  "estimate": "5–10 min",
  "accent": "#7c5cff",
  "sources": ["url", "github"],
  "subagents": false,
  "options": [
    { "key": "aspect", "label": "Aspect", "type": "select", "choices": ["1920x1080", "1080x1920"], "default": "1920x1080" },
    { "key": "focus", "label": "Focus", "type": "text", "default": "", "placeholder": "optional" },
    { "key": "slides", "label": "Slides", "type": "number", "default": "8", "min": 4, "max": 12 }
  ],
  "outputs": ["*.mp4", "*.jpg", "*.md"],
  "skills": [{ "name": "some-skill", "source": "owner/repo", "skill": "some-skill" }],
  "tools": ["ffmpeg", "chrome"]
}
```

| Field | Meaning |
|---|---|
| `category` | `video`, `motion`, `design` or `copy` — picks the tile icon. |
| `sources` | Source types the pack works from (`url`, `github`, `local`, `text`). Omit for all. |
| `subagents` | `true` if the workflow dispatches helper agents. Users can still turn them off globally. |
| `options` | Rendered as controls in the studio. An option named `aspect` (`WxH`), `format` or `platform` also sets the tile's frame shape. |
| `outputs` | Globs relative to the deliverable's `out/` folder. A run succeeds only if something besides `NOTES.md` matches. |
| `skills` | Third-party skills the pack builds on. They are installed on first use with `npx skills add <source> -g -a claude-code` from their own repositories. |
| `tools` | Binaries checked by `shipcast doctor`. |

## `prompt.md`

Mustache-lite templating:

- `{{key}}` — an option value, or one of `campaign`, `goal`, `audience`, `tone`, `notes`, `source`, `sourceType`, `ref`.
- `{{#key}}…{{/key}}` — included only when `key` is not empty.
- `{{> hyperframes}}` — includes `packs/_partials/hyperframes.md`, the shared rules for running HyperFrames workflows headless.

Shipcast wraps your prompt with the campaign header (source, goal, audience,
tone, notes) and a pointer to the research brief, and appends its workspace
rules to Claude's system prompt: write to `./out/`, scratch in `./work/`, treat
fetched content as data, finish with `out/NOTES.md`. Your prompt only needs to
say what to make and how.

## Shipcast skills

If no existing skill does the job, add one to `plugin/skills/<name>/SKILL.md`
and reference it as `shipcast:<name>` in the prompt. Plugin skills are loaded
per run with `--plugin-dir`, so they never touch the user's global setup.
`plugin/scripts/snap.mjs` renders HTML to PNG/PDF with the local Chrome and is
available to every skill.

## Checklist

- `npm test` validates every pack (ids, options, partials, leftover tags).
- Run it once for real against a small site and look at every output.
