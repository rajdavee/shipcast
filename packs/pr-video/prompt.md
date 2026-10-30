Use the `pr-to-video` skill to turn a pull request of `{{source}}` into a short video.

- PR: {{#pr}}#{{pr}}{{/pr}} (if blank, use the most recently merged PR with a user-visible change: `gh pr list -R {{source}} --state merged --limit 10`).
- Aspect: {{aspect}}. Audience: {{audience}} — for `users`, lead with what they can now do and show it; for `developers`, show the key code change and why it matters.
- Use the campaign brand kit for colors, fonts and logo.

{{> hyperframes}}

Name the final file `out/changelog.mp4` and write a matching release post to `out/post.txt`.
