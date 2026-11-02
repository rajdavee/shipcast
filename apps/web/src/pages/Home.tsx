import { useEffect, useRef, useState } from 'react';
import { looksLikeContent } from '../content.ts';
import { api, detectSource, type Campaign, type SourceType, type Status } from '../api.ts';
import { go, useLoad } from '../hooks.ts';
import { DEFAULT_FORMATS, FORMATS } from '../formats.ts';
import { CampaignCover } from '../components/CampaignCover.tsx';
import { Brainstorm } from '../components/Brainstorm.tsx';

const KIND: Record<SourceType, string> = { url: 'Website', github: 'GitHub repo', local: 'Folder on this computer', text: 'Description' };
const PICK_KEY = 'shipcast.formats';
const BRAIN_KEY = 'shipcast.brainstorm';
const readBool = (k: string, d: boolean) => {
  try {
    const v = localStorage.getItem(k);
    return v === null ? d : v === '1';
  } catch {
    return d;
  }
};

function loadPicks(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(PICK_KEY) ?? 'null');
    if (Array.isArray(v) && v.length) return v.filter((id) => FORMATS.some((f) => f.id === id));
  } catch {}
  return DEFAULT_FORMATS;
}

function savePicks(ids: string[]) {
  try {
    localStorage.setItem(PICK_KEY, JSON.stringify(ids));
  } catch {}
}

/** A miniature post for the text-only format, so every tile shows a real artefact. */
/** Heuristic: does a written brief describe a video/content to make rather than a product to market? */
const AnythingMock = () => (
  <div className="anything-mock" aria-hidden="true">
    <i className="orb" />
    <span>“A lone hero, a glowing aura, one final strike…”</span>
  </div>
);

const PostMock = () => (
  <div className="post-mock" aria-hidden="true">
    <div className="pm-head"><i /><span><b /><small /></span></div>
    <p>Most launches die quietly. Not because the product is weak —</p>
    <p>because nobody can tell what it does in five seconds.</p>
    <p className="pm-dim">Here's the checklist we use now ↓</p>
  </div>
);

export function Home({ status, services, campaigns }: { status: Status | null; services: { name: string; ok: boolean }[] | null; campaigns: Campaign[] | null }) {
  const [text, setText] = useState('');
  const [picks, setPicks] = useState<string[]>(loadPicks);
  const tones = useLoad(() => api.tones());
  const [toneId, setToneId] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [shortLen, setShortLen] = useState<'15s' | '30s' | '60s'>('30s');
  const [longLen, setLongLen] = useState<'3 min' | '5 min' | '8 min' | '10 min'>('5 min');
  const [busy, setBusy] = useState(false);
  const [brainOn, setBrainOn] = useState(() => readBool(BRAIN_KEY, true));
  const [brain, setBrain] = useState(false);
  const [full, setFull] = useState(false);
  const [envText, setEnvText] = useState('');
  const [size, setSize] = useState<'focused' | 'standard' | 'big'>('standard');
  const [login, setLogin] = useState({ email: '', password: '', url: '' });
  const [error, setError] = useState<string | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const packs = useLoad(() => api.packs());

  const source = detectSource(text);
  // A written brief for a video to make (a story, a trailer, a music video…) rather than a product.
  const contentMode = source?.type === 'text' && looksLikeContent(text);
  const [contentDismissed, setContentDismissed] = useState(false);
  const [beforeContent, setBeforeContent] = useState<string[] | null>(null);
  useEffect(() => {
    if (contentMode && !contentDismissed && !beforeContent) {
      setBeforeContent(picks);
      setPicks(['custom-video']);
    }
    if (!contentMode && beforeContent) {
      setPicks(beforeContent);
      setBeforeContent(null);
      setContentDismissed(false);
    }
  }, [contentMode]);
  const available = new Set((packs.data ?? []).map((p) => p.id));
  const formats = FORMATS.filter((f) => !packs.data || available.has(f.id));
  const chosen = picks.filter((id) => formats.some((f) => f.id === id));
  const claudeReady = status ? status.claude.loggedIn : true;
  const servicesDown = services?.filter((s) => !s.ok).map((s) => s.name) ?? [];
  const canGo = !!source && chosen.length > 0 && !busy && claudeReady && !brain;

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  const toggle = (id: string) => {
    const next = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id];
    setPicks(next);
    savePicks(next);
  };

  const SHORT = ['reel', 'launch-film'];
  const hasShort = chosen.some((id) => SHORT.includes(id));
  const hasLong = chosen.includes('youtube-video');
  const optionsFor = (id: string): Record<string, string> => (SHORT.includes(id) ? { length: shortLen } : id === 'youtube-video' ? { length: longLen } : {});

  async function create(finalNotes: string) {
    if (!source) return;
    setBusy(true);
    setError(null);
    try {
      const c = await api.createCampaign({ source, notes: finalNotes, toneId: toneId || undefined, deliverables: chosen.map((id) => ({ pack: id, options: optionsFor(id) })) });
      go(`/c/${c.id}`);
    } catch (e) {
      setError(String((e as Error).message));
      setBusy(false);
      setBrain(false);
    }
  }

  async function makeFull() {
    if (!source || (source.type !== 'local' && source.type !== 'github')) return;
    // Long background run: ask once so we can say when it needs them or is ready.
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
    setBusy(true);
    setError(null);
    try {
      const c = await api.createCampaign({
        source,
        notes,
        toneId: toneId || undefined,
        name: undefined,
        env: envText,
        login: login.email || login.password || login.url ? login : undefined,
        deliverables: [{ pack: 'app-run' }, { pack: 'app-capture' }, { pack: 'campaign-plan', options: { size } }],
      });
      go(`/c/${c.id}`);
    } catch (e) {
      setError(String((e as Error).message));
      setBusy(false);
    }
  }

  function make() {
    if (!canGo || !source) return;
    if (brainOn && !(contentMode && beforeContent)) setBrain(true);
    else create(notes);
  }


  const minutes = Math.max(5, chosen.length * 3) + (hasLong ? Number(longLen.split(' ')[0]) * 3 : 0);

  return (
    <main className="page home">
      <section className="hero">
        <h1>Paste a link. Get the launch content.</h1>
        <p>Shipcast studies your product, then designs the posts, videos and carousels — on your own computer, with your Claude account.</p>
      </section>

      {status && !claudeReady ? (
        <div className="banner center">Connect your Claude account to start — it's the only account Shipcast needs. <a href="#/setup">Connect Claude</a></div>
      ) : servicesDown.length ? (
        <div className="banner center">The renderers aren't running ({servicesDown.join(', ')}). Start them with <code>npm start</code>.</div>
      ) : null}

      <div className="composer">
        <textarea
          ref={ta}
          rows={1}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              make();
            }
          }}
          placeholder="yourproduct.com, owner/repo, or a few sentences about what you built"
          aria-label="Your product: a link, a GitHub repo or a description"
        />
        <button className="btn primary lg" disabled={!canGo} onClick={make}>
          {busy ? 'Starting…' : 'Make it'}
        </button>
        <div className="composer-meta">
          <span>{source ? <>Reading a <b>{KIND[source.type].toLowerCase()}</b></> : text.trim() ? 'Keep typing — a link, a repo, or a few sentences' : 'Enter to start'}</span>
          <span className="tnum">{chosen.length ? `${chosen.length} ${chosen.length === 1 ? 'piece' : 'pieces'} · about ${minutes} min` : 'Pick at least one format'}</span>
        </div>
      </div>

      <button className="full-toggle" aria-expanded={full} onClick={() => setFull(!full)}>
        <b>Full campaign from your app</b>
        <span>Connect a repo or folder — Shipcast runs it locally, captures real screens and makes films, carousels, posts and a posting calendar. Runs in the background (2–4 h); we'll notify you.</span>
      </button>
      {full && (
        <section className="full-panel">
          {!source || (source.type !== 'local' && source.type !== 'github') ? (
            <p className="muted">Type a GitHub repo (owner/repo) or a folder path (/Users/…/my-app) in the box above.</p>
          ) : (
            <>
              <label className="field">
                <span>Environment variables <small className="muted">· KEY=value per line, stays on this computer, never shown again</small></span>
                <textarea className="textarea mono" rows={5} value={envText} onChange={(e) => setEnvText(e.target.value)} placeholder={'DATABASE_URL=postgres://…\nSTRIPE_SECRET_KEY=sk_test_…\n# leave out what you don\u2019t have — Shipcast asks if it really needs it'} />
              </label>
              <div className="full-login">
                <label className="field"><span>Test login email <small className="muted">(optional)</small></span><input className="input" value={login.email} onChange={(e) => setLogin({ ...login, email: e.target.value })} placeholder="demo@yourapp.com" /></label>
                <label className="field"><span>Password</span><input className="input" type="password" autoComplete="off" value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} /></label>
                <label className="field"><span>Already running at <small className="muted">(optional)</small></span><input className="input" value={login.url} onChange={(e) => setLogin({ ...login, url: e.target.value })} placeholder="http://localhost:3000" /></label>
              </div>
              <div className="seg-row" role="radiogroup" aria-label="Campaign size">
                <span>Size</span>
                {([['focused', '≈6 assets · 1–2 h'], ['standard', '≈10 assets · 2–3 h'], ['big', '≈16 assets · 3–4 h']] as const).map(([k, hint]) => (
                  <button key={k} type="button" role="radio" aria-checked={size === k} className="chip-opt" aria-pressed={size === k} onClick={() => setSize(k)}>
                    {k[0].toUpperCase() + k.slice(1)} <small className="muted">{hint}</small>
                  </button>
                ))}
              </div>
              <p className="hint">Your repo is copied first — the original folder is never changed — and checked for known malicious code before anything runs. Installs and dev servers run on this computer, so only use projects you trust. Nothing is published or uploaded; if something can't be fixed locally (a missing key, a login), Shipcast pauses and asks you here.</p>
              <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                <button className="btn primary lg" disabled={busy || !claudeReady} onClick={makeFull}>{busy ? 'Starting…' : 'Start the full campaign'}</button>
              </div>
            </>
          )}
        </section>
      )}

      {contentMode && beforeContent && (
        <div className="content-note">
          <b>This reads like a video to make, not a product.</b> Shipcast will treat it as a creative brief and make it with <b>Anything</b> — the director picks the engines (characters, motion, footage, generated shots) for each beat.
          <button className="linkish" onClick={() => { setPicks(beforeContent); setBeforeContent(null); setContentDismissed(true); }}>Treat it as a product instead</button>
        </div>
      )}

      {!(contentMode && beforeContent) && <label className="brain-toggle">
        <input type="checkbox" checked={brainOn} onChange={(e) => { setBrainOn(e.target.checked); try { localStorage.setItem(BRAIN_KEY, e.target.checked ? '1' : '0'); } catch {} }} />
        Brainstorm with me first — a few quick questions and three directions to pick from
      </label>}

      {brain && source && <Brainstorm source={source} formats={chosen} notes={notes} length={hasLong ? longLen : hasShort ? shortLen : undefined} onDone={create} onCancel={() => setBrain(false)} onFormats={(ids) => { setPicks(ids); savePicks(ids); }} />}

      {!text && (
        <div className="examples">
          <span>Try</span>
          <button onClick={() => setText('https://bun.sh')}>bun.sh</button>
          <button onClick={() => setText('rajdavee/shipcast')}>rajdavee/shipcast</button>
          <button onClick={() => setText('A habit tracker for remote teams that turns daily standups into 30-second voice notes, summarised for everyone.')}>a description</button>
        </div>
      )}

      <section className="pick" aria-labelledby="pick-h">
        <div className="pick-head">
          <h2 id="pick-h">What should we make?</h2>
          <span className="pick-tools">
          {(tones.data?.length ?? 0) > 1 && (
            <label className="voice-pick">
              <span className="muted">Voice</span>
              <select className="select" value={toneId} onChange={(e) => setToneId(e.target.value)} aria-label="Brand voice">
                <option value="">Learn it from the product</option>
                {tones.data!.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
          )}
          <button className="linkish" onClick={() => setNoteOpen(!noteOpen)} aria-expanded={noteOpen}>
            {noteOpen ? 'Hide note' : notes ? 'Edit your note' : 'Add a note for Claude'}
          </button>
          </span>
        </div>
        {noteOpen && (
          <textarea className="textarea note-box" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Who it's for, what to highlight, what to avoid. E.g. “For CTOs. Show the new dashboard. Don't mention pricing.”" />
        )}
        {(hasShort || hasLong) && (
          <div className="lengths">
            {hasShort && (
              <div className="len-row">
                <span>Short video length</span>
                <div className="seg" role="group" aria-label="Short video length">
                  {(['15s', '30s', '60s'] as const).map((l) => <button key={l} aria-pressed={shortLen === l} onClick={() => setShortLen(l)}>{l.replace('s', ' s')}</button>)}
                </div>
              </div>
            )}
            {hasLong && (
              <div className="len-row">
                <span>YouTube video length</span>
                <div className="seg" role="group" aria-label="YouTube video length">
                  {(['3 min', '5 min', '8 min', '10 min'] as const).map((l) => <button key={l} aria-pressed={longLen === l} onClick={() => setLongLen(l)}>{l}</button>)}
                </div>
              </div>
            )}
          </div>
        )}
        <div className="tiles" role="group" aria-label="Formats">
          {formats.map((f) => {
            const on = chosen.includes(f.id);
            return (
              <button key={f.id} className="tile" aria-pressed={on} onClick={() => toggle(f.id)}>
                <span className="tape" aria-hidden="true" />
                <span className="tile-art">
                  {f.id === 'custom-video' ? <AnythingMock /> : f.img ? <img src={f.img} alt="" style={{ aspectRatio: String(f.ratio) }} loading="lazy" /> : <PostMock />}
                </span>
                <span className="tile-text">
                  <b>{f.title}</b>
                  <small>{f.line}</small>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {error && <p className="error-text center">{error}</p>}

      {campaigns && campaigns.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Your projects</h2>
            <a className="linkish" href="#/library">See all</a>
          </div>
          <div className="covers">
            {campaigns.slice(0, 4).map((c) => <CampaignCover key={c.id} campaign={c} />)}
          </div>
        </section>
      )}
    </main>
  );
}
