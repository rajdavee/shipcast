import { useEffect, useRef, useState } from 'react';
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
  const [noteOpen, setNoteOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [shortLen, setShortLen] = useState<'15s' | '30s' | '60s'>('30s');
  const [longLen, setLongLen] = useState<'3 min' | '5 min' | '8 min' | '10 min'>('5 min');
  const [busy, setBusy] = useState(false);
  const [brainOn, setBrainOn] = useState(() => readBool(BRAIN_KEY, true));
  const [brain, setBrain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const packs = useLoad(() => api.packs());

  const source = detectSource(text);
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
      const c = await api.createCampaign({ source, notes: finalNotes, deliverables: chosen.map((id) => ({ pack: id, options: optionsFor(id) })) });
      go(`/c/${c.id}`);
    } catch (e) {
      setError(String((e as Error).message));
      setBusy(false);
      setBrain(false);
    }
  }

  function make() {
    if (!canGo || !source) return;
    if (brainOn) setBrain(true);
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

      <label className="brain-toggle">
        <input type="checkbox" checked={brainOn} onChange={(e) => { setBrainOn(e.target.checked); try { localStorage.setItem(BRAIN_KEY, e.target.checked ? '1' : '0'); } catch {} }} />
        Brainstorm with me first — a few quick questions and three directions to pick from
      </label>

      {brain && source && <Brainstorm source={source} formats={chosen} notes={notes} onDone={create} onCancel={() => setBrain(false)} />}

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
          <button className="linkish" onClick={() => setNoteOpen(!noteOpen)} aria-expanded={noteOpen}>
            {noteOpen ? 'Hide note' : notes ? 'Edit your note' : 'Add a note for Claude'}
          </button>
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
                  {f.img ? <img src={f.img} alt="" style={{ aspectRatio: String(f.ratio) }} loading="lazy" /> : <PostMock />}
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
