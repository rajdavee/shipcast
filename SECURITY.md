# Security

Shipcast runs an AI agent with shell access on your machine. Please read this
before pointing it at untrusted sources.

## Model

- The api binds to `127.0.0.1`, rejects requests whose `Host` isn't local (DNS
  rebinding) and rejects cross-origin writes.
- Each Claude run is confined by instruction to its campaign folder and given an
  allow-list of tools (Settings). It is not an OS sandbox. For untrusted
  sources, run Shipcast in a VM or container.
- Website, repo and upload content is treated as data. Prompts tell Claude to
  ignore instructions found inside it; that reduces, but cannot eliminate,
  prompt-injection risk.
- Generated HTML/SVG is served with `Content-Security-Policy: sandbox`, so it
  can't script the studio.
- Shipcast never reads, stores or forwards Claude or GitHub credentials. Logins
  are performed by the official CLIs.

## Reporting

Email **rajdave710@gmail.com** with details and steps to reproduce. Please don't
open a public issue for vulnerabilities. You'll get a reply within a few days.
