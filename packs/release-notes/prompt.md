Use the `shipcast:release-notes` skill.

{{#version}}- Version: {{version}}
{{/version}}{{#date}}- Release date: {{date}}
{{/date}}{{#changes}}- What changed (from the user — real): {{changes}}
{{/changes}}- The release: from the user's notes above, otherwise the source repo's CHANGELOG.md, release notes or tags when the source is a repo, otherwise the brief. Only changes that really shipped.
- {{features}} headline feature(s), each as a `whats-new` card at `linkedin-landscape` and `linkedin-image`, plus one `release-summary` card — all in `out/release/`, theme `{{theme}}` (`auto` = pick what fits the brand). Then `out/release-notes.md`.
- Every feature card shows a real screenshot of that feature from the brief's assets, cropped to it.
