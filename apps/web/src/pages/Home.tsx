import { useEffect, useMemo, useRef, useState } from 'react';
import { api, detectSource, type Campaign, type Pack, type SourceType, type Status } from '../api.ts';
import { go, useLoad } from '../hooks.ts';
import { GOALS, isStudio, PLAIN } from '../formats.ts';
import { OptionInput } from '../components/OptionInput.tsx';
import { CampaignCover } from '../components/CampaignCover.tsx';

const KIND: Record<SourceType, string> = { url: 'Website', github: 'GitHub repo', local: 'Folder on this computer', text: 'Description' };

const Check = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);
const Chevron = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M9 6l6 6-6 6" /></svg>
);

export function Home({ status, services, campaigns }: { status: Status | null; services: { name: string; ok: boolean }[] | null; campaigns: Campaign[] | null }) {
  const packs = useLoad(() => api.packs());
  const [text, setText] = useState('');
  const [goal, setGoal] = useState<string>('launch');
  const [custom, setCustom] = useState(false);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [opts, setOpts] = useState<Record<string, Record<string, string>>>({});
  const [openOpts, setOpenOpts] = useState<string | null>(null);
  const [showExp, setShowExp] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);

  const source = detectSource(text);
  const all = packs.data ?? [];
  const byId = useMemo(() => new Map(all.map((p) => [p.id, p])), [all]);
  const goalPacks = GOALS.find((g) => g.id === goal)?.packs ?? [];
  const selected = (picked ?? [...goalPacks]).filter((id) => byId.has(id));
  const usable = (p: Pack) => !source || !p.sources.length || p.sources.includes(source.type);
  const runnable = selected.filter((id) => usable(byId.get(id)!));
  const claudeReady = !!status?.claude.loggedIn;
  const servicesDown = services?.filter((s) => !s.ok).map((s) => s.name) ?? [];

  // Grow the composer with its content.
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const toggle = (id: string) => setPicked((cur) => {
    const base = cur ?? [...goalPacks];
    return base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
  });

  async function make() {
    if (!source || !runnable.length) return;
    setBusy(true);
    setError(null);
    try {
      const c = await api.createCampaign({ source, notes, deliverables: runnable.map((id) => ({ pack: id, options: opts[id] ?? {} })) });
      go(`/c/${c.id}`);
    } catch (e) {
      setError(String((e as Error).message));
      setBusy(false);
    }
  }

  const groups = [
    { label: 'Video', items: all.filter((p) => isStudio(p) && (p.category === 'video' || p.category === 'motion')) },
    { label: 'Design', items: all.filter((p) => isStudio(p) && p.category === 'design') },
    { label: 'Writing', items: all.filter((p) => p.category === 'copy') },
  ].filter((g) => g.items.length);
  const experimental = all.filter((p) => !isStudio(p) && p.category !== 'copy');

  return (
    <main className="page">
      <section className="hero">
        <h1>What are you launching?</h1>
        <p>Paste a website or a GitHub repo. Shipcast studies it, then makes your videos, carousels, thumbnails and posts — on your computer.</p>
      </section>

      {status && !claudeReady ? (
        <div className="banner" style={{ maxWidth: 820, margin: '0 auto 14px' }}>
          Connect your Claude account to start — it's the only account Shipcast needs. <a href="#/setup">Open setup</a>
        </div>
      ) : servicesDown.length ? (
        <div className="banner" style={{ maxWidth: 820, margin: '0 auto 14px' }}>
          Shipcast's renderers aren't running ({servicesDown.join(', ')}). Start them with <code>npm start</code>.
        </div>
      ) : null}

      <div className="composer">
        <div className="composer-row">
          <textarea
            ref={ta}
            rows={1}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (source && claudeReady) make();
              }
            }}
            placeholder="yourproduct.com, owner/repo, or describe what you built…"
            aria-label="What are you launching?"
          />
          <button className="btn primary lg" disabled={!source || !runnable.length || busy || !claudeReady} onClick={make}>
            {busy ? 'Starting…' : 'Make it'}
          </button>
        </div>
        <div className="composer-meta">
          <span className="kind">{source ? <>Detected: <b>{KIND[source.type]}</b></> : text.trim() ? 'Keep typing — a link, a repo, or a few sentences' : 'Press Enter to start'}</span>
          <span className="kind">{runnable.length} {runnable.length === 1 ? 'thing' : 'things'} to make · about {Math.max(6, runnable.length * 3)} min</span>
        </div>
      </div>

      {!text && (
        <div className="examples">
          <button onClick={() => setText('https://bun.sh')}>Try a website</button>
          <button onClick={() => setText('rajdavee/shipcast')}>Try a GitHub repo</button>
          <button onClick={() => setText('A habit tracker for remote teams that turns daily standups into 30-second voice notes, transcribed and summarised for everyone.')}>Try a description</button>
        </div>
      )}

      <div className="goals" role="radiogroup" aria-label="What should we make?">
        {GOALS.map((g) => (
          <button
            key={g.id}
            className="goal"
            role="radio"
            aria-checked={goal === g.id && !picked}
            aria-pressed={goal === g.id && !picked}
            onClick={() => {
              setGoal(g.id);
              setPicked(null);
            }}
          >
            <span className="check"><Check /></span>
            <span className="shapes" aria-hidden="true">
              {g.shapes.map(([w, h], i) => <i key={i} style={{ width: w, height: h }} />)}
            </span>
            <h3>{g.title}</h3>
            <p>{g.blurb}</p>
          </button>
        ))}
      </div>

      <div className="customize">
        <button className="disclosure" aria-expanded={custom} onClick={() => setCustom(!custom)}>
          <Chevron /> {picked ? `Custom selection · ${runnable.length}` : 'Customize what we make'}
        </button>
        {custom && (
          <div className="format-groups">
            {groups.map((g) => (
              <div key={g.label}>
                <p className="group-label">{g.label}</p>
                <div className="format-list">
                  {g.items.map((p) => {
                    const on = selected.includes(p.id);
                    const ok = usable(p);
                    return (
                      <div key={p.id}>
                        <button className="fmt" aria-pressed={on} disabled={!ok} style={{ width: '100%', opacity: ok ? 1 : 0.45 }} onClick={() => toggle(p.id)}>
                          <span className="box"><Check /></span>
                          <span>
                            <b>{p.name.replace(/ · (freeform|brag)$/, '')}</b>
                            <small>{ok ? (PLAIN[p.id] ?? p.tagline) : 'Needs a GitHub repo'}</small>
                          </span>
                        </button>
                        {on && p.options.length > 0 && (
                          <>
                            <button className="disclosure" style={{ fontSize: 12.5, padding: '6px 2px' }} aria-expanded={openOpts === p.id} onClick={() => setOpenOpts(openOpts === p.id ? null : p.id)}>
                              <Chevron /> Options
                            </button>
                            {openOpts === p.id && (
                              <div className="fmt-opts">
                                {p.options.map((o) => (
                                  <OptionInput key={o.key} field={o} value={opts[p.id]?.[o.key] ?? o.default} onChange={(v) => setOpts((x) => ({ ...x, [p.id]: { ...x[p.id], [o.key]: v } }))} />
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {experimental.length > 0 && (
              <div>
                <button className="disclosure" style={{ fontSize: 13 }} aria-expanded={showExp} onClick={() => setShowExp(!showExp)}>
                  <Chevron /> Experimental formats ({experimental.length}) — Claude builds these freely; slower and less predictable
                </button>
                {showExp && (
                  <div className="format-list" style={{ marginTop: 8 }}>
                    {experimental.map((p) => {
                      const on = selected.includes(p.id);
                      const ok = usable(p);
                      return (
                        <button key={p.id} className="fmt" aria-pressed={on} disabled={!ok} style={{ opacity: ok ? 1 : 0.45 }} onClick={() => toggle(p.id)}>
                          <span className="box"><Check /></span>
                          <span>
                            <b>{p.name.replace(' · freeform', '').replace(' · brag', '')} <span className="muted" style={{ fontWeight: 500 }}>· experimental</span></b>
                            <small>{ok ? p.tagline : 'Needs a GitHub repo'}</small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <label className="field">
              <span>Anything Claude should know?</span>
              <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Who it's for, what to highlight, what to avoid. E.g. “Aimed at CTOs. Show the new dashboard. Don't mention pricing.”" />
            </label>
          </div>
        )}
      </div>

      {error && <p className="error-text" style={{ textAlign: 'center', marginTop: 16 }}>{error}</p>}

      {campaigns && campaigns.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Recent</h2>
            <a className="btn ghost sm" href="#/library">See all</a>
          </div>
          <div className="covers">
            {campaigns.slice(0, 4).map((c) => <CampaignCover key={c.id} campaign={c} />)}
          </div>
        </section>
      )}
    </main>
  );
}
