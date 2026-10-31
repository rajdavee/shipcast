import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { api, detectSource, type Pack, type SourceType, type Status } from '../api.ts';
import { go, toast, useLoad } from '../hooks.ts';
import { PackFrame } from '../components/PackFrame.tsx';
import { OptionInput } from '../components/OptionInput.tsx';
import { Icon } from '../components/icons.tsx';

const KIND_LABEL: Record<SourceType, string> = {
  url: 'Website',
  github: 'GitHub repo',
  local: 'Local folder',
  text: 'Written brief',
};

const BUNDLES: { name: string; packs: string[] }[] = [
  { name: 'Launch kit', packs: ['launch-film', 'reel', 'carousel', 'thumbnails', 'copy-kit'] },
  { name: 'Social week', packs: ['reel', 'feature-spotlight', 'carousel', 'copy-kit'] },
  { name: 'Video only', packs: ['launch-film', 'reel', 'explainer-video'] },
];

export function NewCampaign({ status }: { status: Status | null }) {
  const packs = useLoad(() => api.packs());
  const services = useLoad(() => api.services(), [], 10000);
  const [input, setInput] = useState('');
  const [selected, setSelected] = useState<string[]>(['reel', 'carousel', 'thumbnails', 'copy-kit']);
  const [options, setOptions] = useState<Record<string, Record<string, string>>>({});
  const [details, setDetails] = useState({ name: '', goal: '', audience: '', tone: '', notes: '' });
  const [repos, setRepos] = useState<{ nameWithOwner: string; isPrivate: boolean }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);

  const source = detectSource(input);
  const [pulls, setPulls] = useState<{ repo: string; items: { value: string; label: string }[] } | null>(null);
  const repo = source?.type === 'github' ? source.value.replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '').replace(/\.git$|\/$/g, '') : null;
  const wantsPr = selected.includes('pr-video');
  // Suggest recent pull requests for the PR video format (needs the GitHub CLI).
  useEffect(() => {
    if (!repo || !wantsPr || !status?.github.loggedIn || pulls?.repo === repo) return;
    const t = setTimeout(() => {
      api
        .pulls(repo)
        .then((ps) => setPulls({ repo, items: ps.map((p) => ({ value: String(p.number), label: `#${p.number} ${p.title} (${p.state.toLowerCase()})` })) }))
        .catch(() => setPulls({ repo, items: [] }));
    }, 400);
    return () => clearTimeout(t);
  }, [repo, wantsPr, status?.github.loggedIn]);
  const all = packs.data ?? [];
  const byId = useMemo(() => new Map(all.map((p) => [p.id, p])), [all]);
  const chosen = selected.map((id) => byId.get(id)).filter((p): p is Pack => !!p);
  const usable = (p: Pack) => !source || p.sources.length === 0 || p.sources.includes(source.type);

  const toggle = (p: Pack) => {
    if (!usable(p)) return;
    setSelected((s) => (s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id]));
  };
  const setOpt = (pack: string, key: string, value: string) => setOptions((o) => ({ ...o, [pack]: { ...o[pack], [key]: value } }));

  async function loadRepos() {
    try {
      setRepos(await api.repos());
    } catch (e) {
      setError(String((e as Error).message));
    }
  }

  async function install(p: Pack) {
    setInstalling(p.id);
    try {
      const r = await api.installPack(p.id);
      const failed = r.results.filter((x) => !x.ok);
      toast(failed.length ? `Couldn't install ${failed.map((f) => f.skill).join(', ')}` : `${p.name} is ready`);
      packs.reload();
    } catch (e) {
      toast(String((e as Error).message));
    } finally {
      setInstalling(null);
    }
  }

  async function start() {
    if (!source) return;
    setBusy(true);
    setError(null);
    try {
      const c = await api.createCampaign({
        ...details,
        source,
        deliverables: chosen.filter(usable).map((p) => ({ pack: p.id, options: options[p.id] ?? {} })),
      });
      go(`/c/${c.id}`);
    } catch (e) {
      setError(String((e as Error).message));
      setBusy(false);
    }
  }

  const missingSkills = chosen.some((p) => p.skills.some((s) => !s.installed));
  const claudeReady = status?.claude.loggedIn;
  const runnable = chosen.filter(usable);

  return (
    <div className="slate">
      <h1 className="slate-title">Paste a link. Get a launch.</h1>
      <p className="slate-sub">
        Shipcast reads your site or repo once, then makes the videos, motion graphics, carousels, thumbnails and posts — on your machine, with your own Claude login.
      </p>

      <Setup status={status} services={services.data} />

      <label className="source-bar">
        <input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="yourproduct.com, owner/repo, or a folder path"
          aria-label="What should we promote?"
          onKeyDown={(e) => e.key === 'Enter' && source && runnable.length && claudeReady && start()}
        />
        <span className="source-kind">{source ? <b>{KIND_LABEL[source.type]}</b> : input.trim() ? 'Keep typing…' : ''}</span>
      </label>
      <div className="source-help">
        <span>Try</span>
        <button onClick={() => setInput('https://latent-spaces.github.io/brag/')}>a website</button>
        <button onClick={() => setInput('rajdavee/shipcast')}>a GitHub repo</button>
        <button onClick={() => setInput('A habit tracker for remote teams that turns daily standups into a 30-second voice note, transcribed and summarised for everyone.')}>a written brief</button>
        {status?.github.loggedIn && !repos && <button onClick={loadRepos}>pick from your GitHub</button>}
      </div>
      {repos && (
        <div className="field" style={{ marginTop: 14, maxWidth: 520 }}>
          <span>Your repositories</span>
          <select className="select" value="" onChange={(e) => e.target.value && setInput(e.target.value)}>
            <option value="">Choose a repository…</option>
            {repos.map((r) => (
              <option key={r.nameWithOwner} value={r.nameWithOwner}>
                {r.nameWithOwner}
                {r.isPrivate ? ' (private)' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      <section className="section" aria-labelledby="formats">
        <div className="section-head">
          <h2 className="section-title" id="formats">What should we make?</h2>
          <div className="bundle-row">
            {BUNDLES.map((b) => (
              <button key={b.name} className="btn small" onClick={() => setSelected(b.packs.filter((id) => byId.has(id)))}>
                {b.name}
              </button>
            ))}
            <button className="btn small ghost" onClick={() => setSelected([])}>
              Clear
            </button>
          </div>
        </div>
        {packs.error && <p className="error-text">{packs.error}</p>}
        {[
          { label: 'Studio · rendered, quality-checked, editable', test: (p: Pack) => !!p.spec || !!p.pipeline },
          { label: 'Copy', test: (p: Pack) => !p.spec && !p.pipeline && p.category === 'copy' },
          { label: 'Freeform · made directly by Claude with HyperFrames or brag — for custom ideas', test: (p: Pack) => !p.spec && !p.pipeline && p.category !== 'copy' },
        ].map((group) => {
          const items = all.filter(group.test);
          if (!items.length) return null;
          return (
            <div key={group.label}>
              <p className="section-label">{group.label}</p>
              <div className="reel">
                {items.map((p) => {
                  const on = selected.includes(p.id);
                  const ok = usable(p);
                  return (
                    <button
                      key={p.id}
                      className="tile"
                      aria-pressed={on}
                      aria-disabled={!ok}
                      title={ok ? p.tagline : `Needs a ${p.sources.map((s) => KIND_LABEL[s]).join(' or ')} source`}
                      onClick={() => toggle(p)}
                    >
                      <PackFrame pack={p} options={options[p.id]} />
                      <span className="tile-check">
                        <Icon.check />
                      </span>
                      <span className="tile-name">{p.name.replace(/ · (freeform|brag)$/, '')}</span>
                      <span className="tile-line">{p.tagline}</span>
                      <span className="tile-meta">
                        <span className="tnum">{p.estimate}</span>
                        {p.pipeline ? <span className="chip-mini">No Claude turn</span> : p.spec ? <span className="chip-mini">Editable</span> : p.skills.some((s) => !s.installed) ? <span>needs install</span> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {chosen.length > 0 && (
          <div className="inspector">
            {chosen.map((p) => (
              <div key={p.id} className="inspect-card" style={{ '--accent': p.accent } as CSSProperties}>
                <div className="inspect-head">
                  <i className="swatch" />
                  <h3>{p.name}</h3>
                </div>
                {p.options.length > 0 && (
                  <div className="opts">
                    {p.options.map((o) => (
                      <OptionInput
                        key={o.key}
                        field={o}
                        value={options[p.id]?.[o.key] ?? o.default}
                        onChange={(v) => setOpt(p.id, o.key, v)}
                        suggestions={o.key === 'pr' && pulls?.repo === repo ? pulls.items : undefined}
                      />
                    ))}
                  </div>
                )}
                {p.skills.some((s) => !s.installed) && (
                  <div className="missing">
                    Uses the {p.skills.map((s) => s.name).join(', ')} skill from {p.skills[0].source}. It installs automatically when this runs, or now:
                    <button className="btn small" disabled={installing === p.id} onClick={() => install(p)}>
                      {installing === p.id ? 'Installing…' : 'Install skill'}
                    </button>
                  </div>
                )}
                {!usable(p) && <div className="missing">Works from a GitHub repo — this one will be skipped.</div>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="details">
        <div className="section-head">
          <h2 className="section-title" id="details">Point it in a direction</h2>
          <span className="hint">All optional — the brief fills the gaps.</span>
        </div>
        <div className="details-grid">
          <label className="field">
            <span>Campaign name</span>
            <input className="input" value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} placeholder="v2 launch" />
          </label>
          <label className="field">
            <span>Goal</span>
            <input className="input" value={details.goal} onChange={(e) => setDetails({ ...details, goal: e.target.value })} placeholder="Launch day, new feature, hiring, fundraising…" />
          </label>
          <label className="field">
            <span>Audience</span>
            <input className="input" value={details.audience} onChange={(e) => setDetails({ ...details, audience: e.target.value })} placeholder="Indie hackers, CFOs at 50-person startups…" />
          </label>
          <label className="field">
            <span>Tone</span>
            <input className="input" value={details.tone} onChange={(e) => setDetails({ ...details, tone: e.target.value })} placeholder="Confident and dry, like a Stripe changelog" />
          </label>
        </div>
        <label className="field" style={{ marginTop: 14 }}>
          <span>Anything else Claude should know</span>
          <textarea className="textarea" value={details.notes} onChange={(e) => setDetails({ ...details, notes: e.target.value })} placeholder="Feature the new dashboard. Don't mention pricing. Our handle is @acme." />
        </label>
      </section>

      {error && <p className="error-text" style={{ marginTop: 16 }}>{error}</p>}

      <div className="launch-bar">
        <span className="launch-summary">
          {source ? <b>{KIND_LABEL[source.type]}</b> : 'Add a source'} ·{' '}
          {runnable.length ? `${runnable.length} deliverable${runnable.length > 1 ? 's' : ''}` : 'pick at least one format'}
          {missingSkills ? ' · installs missing skills first' : ''}
        </span>
        <button className="btn primary" disabled={!source || !runnable.length || busy || !claudeReady} onClick={start}>
          {busy ? 'Starting…' : 'Start campaign'}
        </button>
      </div>
    </div>
  );
}

function Setup({ status, services }: { status: Status | null; services: { name: string; ok: boolean; voice?: string }[] | null }) {
  if (!status || !services) return null;
  const down = services.filter((s) => !s.ok).map((s) => s.name);
  const voice = services.find((s) => s.name === 'media')?.voice;
  const items = [
    { ok: status.claude.loggedIn, label: 'Connect Claude Code', detail: 'the only account Shipcast needs', href: '#/connect' },
    { ok: down.length === 0, label: 'Start the render services', detail: down.length ? `${down.join(', ')} not running — run \`npm start\`` : '', href: '#/connect' },
    { ok: voice === 'kokoro', label: 'Install the natural voice (optional)', detail: 'one click, ~20 seconds, stays on this machine', href: '#/connect' },
  ];
  if (items.every((i) => i.ok)) return null;
  return (
    <div className="inspect-card" style={{ marginBottom: 22 }}>
      <h3 style={{ fontSize: 16 }}>Finish setting up</h3>
      <div style={{ display: 'grid', gap: 8 }}>
        {items.map((i) => (
          <a key={i.label} href={i.href} className="signal" style={{ fontSize: 14 }}>
            <i className={`lamp ${i.ok ? 'on' : 'off'}`} />
            <span>
              <b>{i.label}</b>
              {!i.ok && i.detail ? <span className="hint"> — {i.detail}</span> : null}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
