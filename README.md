<p align="center">
  <img src="docs/assets/banner.png" alt="Shipcast — Paste a link. Get a launch." width="900" />
</p>

<h1 align="center">Shipcast</h1>

<p align="center">
  <b>Paste a link. Get a launch.</b><br />
  A local-first studio that turns a website or a GitHub repo into a full campaign —<br />
  launch videos, motion graphics, reels, carousels, thumbnails and posts.
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#formats">Formats</a> ·
  <a href="docs/ARCHITECTURE.md">Architecture</a> ·
  <a href="docs/WRITING-PACKS.md">Write a format</a>
</p>

<p align="center">
  <a href="docs/assets/shipcast-explainer.mp4"><img src="docs/assets/videos.jpg" alt="Shipcast's own explainer and reel" width="900" /></a><br />
  <sub>▶ <a href="docs/assets/shipcast-explainer.mp4">Explainer (62 s)</a> · <a href="docs/assets/shipcast-reel.mp4">Reel (27 s)</a> — written, scored, voiced and quality-checked by Shipcast from this repo. Banner above too.</sub>
</p>

<p align="center"><img src="docs/assets/carousel.jpg" alt="An 8-slide LinkedIn carousel Shipcast made about itself" width="900" /></p>

---

You built something. Now it needs a launch video, a vertical cut for Shorts, a
LinkedIn carousel, a YouTube thumbnail, an X thread, a Product Hunt blurb…
Shipcast makes all of it from one URL, on your own machine.

- **No API keys, no accounts to create.** Shipcast drives the Claude Code CLI
  you're already signed into, on your own Claude plan. GitHub access goes
  through the `gh` CLI you're already signed into.
- **Research once, make everything.** One run studies your product and writes a
  brief and brand kit — real colors, fonts, logo, screenshots, proof points,
  hooks. Every deliverable builds from it, so the set looks like one campaign.
- **Free, local media stack.** Video renders in headless Chrome + FFmpeg,
  voiceover with Kokoro, captions with whisper.cpp. Nothing is uploaded.
- **Real UI, not stock filler.** Formats reuse your product's actual screens,
  components, copy and brand.
- **Revise like you'd brief a designer.** "Make the hook punchier, slow down
  scene 3" — Shipcast resumes the same session so nothing is lost.
- **Formats are folders.** Each deliverable type is a `pack.json` + `prompt.md`.
  Add one without touching code.

## Quick start

You need **Node 22.18+**, **FFmpeg**, and **Claude Code** signed in
(`claude auth login`). GitHub CLI is optional (private repos, PR videos).

```bash
git clone https://github.com/rajdavee/shipcast
cd shipcast
npm install
npm run build
npm start            # → http://localhost:4317
```

Then:

1. **Connections** — confirm Claude is connected (or click *Sign in with
   Claude*), optionally connect GitHub. The page also checks FFmpeg, Chrome,
   voice and captions.
2. **New campaign** — paste `yourproduct.com`, `owner/repo`, a folder path, or
   a paragraph describing the product.
3. Pick formats (or a bundle like *Launch kit*), tweak options, start.
4. Watch the run sheet: research first, then each deliverable, with a live feed
   of what Claude is doing. Play, preview, copy, download, or ask for changes.

`npm run doctor` checks your machine; `npm run status` shows the services.

**Better voiceover (optional):** on the Connections page, click **Set up** next
to *Kokoro TTS*. Shipcast installs the free Kokoro voice model into its own
Python environment under `~/.shipcast/voice` — nothing is added to your system
Python — and narrated formats use it automatically. Without it, videos fall
back to your OS voice.

<p align="center">
  <img src="docs/assets/studio-run.png" alt="Run sheet: research, then each deliverable, with the reel playing" width="440" />
  <img src="docs/assets/studio-editor.png" alt="Scene editor: change any field, preview frames, re-render without Claude" width="440" />
</p>

## Formats

**Studio formats** — Claude writes a spec, Shipcast's services render it,
quality gates measure it, and you can edit any slide or scene afterwards and
re-render without another Claude run.

| Format | What you get |
|---|---|
| **Reel / Short** | 9:16 master safe for Reels, Shorts and TikTok: 1-second hook, voiceover, word-timed captions (bold, pop, karaoke, boxed, clean, typewriter) |
| **Launch Film** | 20–40s film for YouTube, LinkedIn, X or your site: hook, the real product in motion, proof, CTA |
| **Feature Spotlight** | 8–15s silent motion graphic for the feed |
| **Explainer** | 45–75s narrated explainer — teach first, sell last |
| **Captions** | Upload a talking-head clip → word-timed captions (6 styles), hook title, mastered audio. No Claude turn, about a minute |
| **LinkedIn Carousel** | 6–10 slides in 4 themes × 9 layouts, upload-ready PDF, post caption |
| **Thumbnails & Cards** | 3 YouTube thumbnails for Test & Compare, OG / GitHub cards, X & LinkedIn images, stories, banners |
| **Launch Copy Kit** | LinkedIn posts, X thread, YouTube metadata, Product Hunt, Show HN, newsletter, ads |

**Freeform formats** — Claude builds directly with the open-source
[HyperFrames](https://github.com/heygen-com/hyperframes) and
[brag](https://github.com/latent-spaces/brag) skills, for ideas outside the
scene library: brag launch video, product promo, explainer, motion graphics,
Discovery Journey, changelog video from a pull request, talking-head captions.

Third-party skills are **not bundled**; Shipcast installs them from their own
repositories on first use, under their own licenses.

Every video gets an **original music bed** (6 moods, cuts snapped to its beat, whooshes on transitions), a **Kokoro voiceover** aligned word-by-word to the script, and a **director's review**: after the automated checks pass, Claude looks at the rendered frames once and fixes what a human editor would.

### What "quality" means here

Every video is checked before you see it ([research](docs/research/landscape-2026.md)):
platform canvas and codec, **-14 LUFS / -1 dBTP** loudness, no black or frozen
stretches, captions inside the platform safe zone at a readable pace, no text
overlapping or clipping, WCAG contrast, a real first frame for the feed
thumbnail. Stills are audited for overflow, safe margins and minimum type size.
Copy is checked against platform limits (LinkedIn's "see more" fold, X's 280,
YouTube's 60-character titles) and a list of AI clichés. Problems go back to
Claude with the fix hint; you see what passed.

## How it works

```
web ─► api :4317 ──► ~/.shipcast ◄── worker (Claude, your login)
                                        │ specs
            render :4320 · stills :4321 · media :4322 · qa :4323
```

Six small services, one shared data folder, no database. `shipcast start`
supervises them all; `docker compose up` puts each in its own container; any
service can move to another machine with `SHIPCAST_<NAME>_URL`. Details in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Usage limits

Each deliverable is one Claude Code session; steps run one at a time.
Copy and carousels are light. HyperFrames videos are heavier — they build frames
with helper agents. In **Settings** you can choose the model, turn helper agents
off, and cap minutes per deliverable.

## Safety

Claude runs with file and shell tools inside the campaign folder so it can
render. Website and repo content is treated as data, never instructions; the
api listens on `127.0.0.1` only and rejects cross-site requests; generated HTML
is served in a sandbox. Run Shipcast on a machine you're comfortable letting an
agent build files on. See [SECURITY.md](SECURITY.md).

## Development

```bash
npm run dev          # api + worker on :4317, Vite with hot reload on :5173
npm test             # engine + api tests (uses a fake claude CLI)
npm run typecheck
```

The backend is TypeScript run directly by Node (type stripping) — no build
step, no runtime dependencies.

## License

[MIT](LICENSE) © rajdavee
