import { useEffect, useState } from 'react';
import { api, type AgentsState, type LoginState, type Settings, type Status, type StockProvider } from '../api.ts';
import { toast, useLoad, type SettingsTab } from '../hooks.ts';
import { PageHeader } from '../components/ui.tsx';
import { Skills } from './Skills.tsx';

const NAMES: Record<string, string> = { render: 'Video renderer', stills: 'Image & PDF renderer', media: 'Voice, captions & music', qa: 'Quality checks' };

const TABS: [SettingsTab, string][] = [
  ['connections', 'Connections'],
  ['generation', 'Generation'],
  ['agents', 'Background agents'],
  ['skills', 'Skills'],
];

/** Everything that used to be Setup and Skills, one tab per concern; the tab lives in the hash (#/settings/agents). */
export function Settings({ tab, status, onChange }: { tab: SettingsTab; status: Status | null; onChange: () => void }) {
  return (
    <main className="page settings-page">
      <PageHeader title="Settings" description="Shipcast never asks for passwords. It uses the Claude Code and GitHub apps already signed in on this computer; optional keys stay here too." />
      <nav className="tabs" aria-label="Settings sections">
        {TABS.map(([id, label]) => (
          <a key={id} href={`#/settings/${id}`} aria-current={tab === id ? 'page' : undefined}>{label}</a>
        ))}
      </nav>
      <div className="tab-panel">
        {tab === 'generation' ? <Generation /> : tab === 'agents' ? <AgentsSection /> : tab === 'skills' ? <Skills /> : <Connections status={status} onChange={onChange} />}
      </div>
    </main>
  );
}

function Connections({ status, onChange }: { status: Status | null; onChange: () => void }) {
  const checks = useLoad(() => api.doctor());
  const services = useLoad(() => api.services(), [], 5000);
  const [claudeLogin, setClaudeLogin] = useState<LoginState | null>(null);
  const [ghLogin, setGhLogin] = useState<LoginState | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);
  const [fixLog, setFixLog] = useState<string | null>(null);

  useEffect(() => {
    if (!claudeLogin?.running && !ghLogin?.running) return;
    const t = setInterval(async () => {
      const s = await api.status();
      setClaudeLogin(s.logins.claude);
      setGhLogin(s.logins.github);
      onChange();
      if (!s.logins.claude?.running && !s.logins.github?.running) checks.reload();
    }, 2000);
    return () => clearInterval(t);
  }, [claudeLogin?.running, ghLogin?.running]);

  async function fix(id: string, label: string) {
    setFixing(id);
    setFixLog(null);
    try {
      const r = await api.setup(id);
      toast(r.ok ? `${label} is ready` : `${label} setup failed`);
      if (!r.ok) setFixLog(r.log);
      checks.reload();
      services.reload();
    } catch (e) {
      toast(String((e as Error).message));
    } finally {
      setFixing(null);
    }
  }

  const c = status?.claude;
  const g = status?.github;
  const tools = (checks.data ?? []).filter((k) => !['claude', 'gh', 'node'].includes(k.id));

  return (
    <>
      <section className="setup-section">
        <h2>Accounts</h2>
        <p>Claude does the thinking. GitHub is only needed for private repos and pull-request videos.</p>
        <div className="rows">
          <div className="srow">
            <i className={`dot ${c?.loggedIn ? 'ok' : 'bad'}`} />
            <div>
              <h3>Claude</h3>
              <p>{!c ? 'Checking…' : !c.installed ? 'Claude Code is not installed on this computer.' : c.loggedIn ? `Connected${c.account ? ` as ${c.account}` : ''}. Runs use your Claude plan.` : 'Installed, but not signed in.'}</p>
            </div>
            {c && !c.installed ? (
              <a className="btn" href="https://docs.claude.com/en/docs/claude-code/setup" target="_blank" rel="noreferrer">Install</a>
            ) : c && !c.loggedIn ? (
              <button className="btn primary" disabled={claudeLogin?.running} onClick={async () => setClaudeLogin(await api.connectClaude())}>{claudeLogin?.running ? 'Waiting for browser…' : 'Sign in'}</button>
            ) : (
              <span className="hint">Connected</span>
            )}
            {claudeLogin?.running && claudeLogin.url && (
              <div className="device-code">Your browser should open. If not, <a href={claudeLogin.url} target="_blank" rel="noreferrer">open the sign-in page</a>.</div>
            )}
          </div>
          <div className="srow">
            <i className={`dot ${g?.loggedIn ? 'ok' : ''}`} />
            <div>
              <h3>GitHub <span className="muted" style={{ fontWeight: 500 }}>· optional</span></h3>
              <p>{!g ? 'Checking…' : !g.installed ? 'Public repos work without it. Install the GitHub app for private repos.' : g.loggedIn ? `Connected as @${g.login}.` : 'Sign in to use private repos.'}</p>
            </div>
            {g && !g.installed ? (
              <a className="btn" href="https://cli.github.com" target="_blank" rel="noreferrer">Install</a>
            ) : g && !g.loggedIn ? (
              <button className="btn" disabled={ghLogin?.running} onClick={async () => setGhLogin(await api.connectGithub())}>{ghLogin?.running ? 'Waiting…' : 'Connect'}</button>
            ) : (
              <span className="hint">{g ? 'Connected' : ''}</span>
            )}
            {ghLogin?.running && ghLogin.code && (
              <div className="device-code">
                <code>{ghLogin.code}</code>
                <span>Enter this code at <a href={ghLogin.url} target="_blank" rel="noreferrer">github.com/login/device</a></span>
                <button className="btn sm" onClick={() => navigator.clipboard.writeText(ghLogin.code!)}>Copy</button>
              </div>
            )}
          </div>
        </div>
      </section>

      <VoiceSection />

      <BrollSection />
      <EnginesSection />

      <section className="setup-section">
        <h2>On this computer</h2>
        <p>Everything renders locally — nothing is uploaded anywhere.</p>
        <div className="rows">
          {(services.data ?? []).map((s) => (
            <div key={s.name} className="srow">
              <i className={`dot ${s.ok ? 'ok' : 'bad'}`} />
              <div>
                <h3>{NAMES[s.name] ?? s.name}</h3>
                <p>{s.ok ? (s.running ? 'Working right now' : 'Running') : 'Not running — start Shipcast with npm start'}{s.voice ? ` · voice: ${s.voice === 'kokoro' ? 'natural (Kokoro)' : 'system fallback'}` : ''}</p>
              </div>
              <span />
            </div>
          ))}
          {tools.map((k) => (
            <div key={k.id} className="srow">
              <i className={`dot ${k.ok ? 'ok' : k.required ? 'bad' : ''}`} />
              <div>
                <h3>{k.label.replace(' (voiceover)', '').replace(' (captions)', '')}{!k.required && <span className="muted" style={{ fontWeight: 500 }}> · optional</span>}</h3>
                <p>{k.ok ? k.detail : k.fix ? k.hint : <>Install with <code>{k.hint}</code></>}</p>
              </div>
              {!k.ok && k.fix ? (
                <button className="btn sm" disabled={!!fixing} onClick={() => fix(k.fix!, k.label)}>{fixing === k.fix ? 'Setting up…' : 'Set up'}</button>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
        {fixLog && <div className="doc" style={{ marginTop: 12 }}><pre>{fixLog}</pre></div>}
      </section>
    </>
  );
}

/** Model, reviews, time limits and spending caps: how each piece gets made. */
function Generation() {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => void api.settings().then(setSettings), []);
  const save = async (patch: Partial<Settings>) => {
    setSettings(await api.saveSettings(patch));
    toast('Saved');
  };
  return (
    <>
      {settings && (
        <section className="setup-section">
          <h2>Preferences</h2>
          <p>How Claude directs your content. Stored in ~/.shipcast/settings.json.</p>
          <div className="rows">
            <div className="srow">
              <span />
              <div>
                <h3>Quality vs. speed</h3>
                <p>Which Claude model directs your content.</p>
              </div>
              <select className="select" style={{ width: 230 }} value={settings.model} onChange={(e) => save({ model: e.target.value })}>
                <option value="">Your Claude Code default</option>
                <option value="opus">Best quality (Opus)</option>
                <option value="sonnet">Faster, lighter (Sonnet)</option>
              </select>
            </div>
            <div className="srow">
              <span />
              <div>
                <h3>Final review for videos</h3>
                <p>Claude watches the finished video once and fixes what an editor would. One short extra step.</p>
              </div>
              <div className="seg">
                <button aria-pressed={settings.directorReview} onClick={() => save({ directorReview: true })}>On</button>
                <button aria-pressed={!settings.directorReview} onClick={() => save({ directorReview: false })}>Off</button>
              </div>
            </div>
            <div className="srow">
              <span />
              <div>
                <h3>Final review for everything else</h3>
                <p>A critic scores each carousel, deck, document, ad, email and page at full size, and the weakest thing gets fixed before you see it.</p>
              </div>
              <div className="seg">
                <button aria-pressed={settings.criticReview !== false} onClick={() => save({ criticReview: true })}>On</button>
                <button aria-pressed={settings.criticReview === false} onClick={() => save({ criticReview: false })}>Off</button>
              </div>
            </div>
            <div className="srow">
              <span />
              <div>
                <h3>Helper agents for experimental formats</h3>
                <p>Some experimental formats build frames in parallel. Off saves usage.</p>
              </div>
              <div className="seg">
                <button aria-pressed={settings.subagents === 'pack'} onClick={() => save({ subagents: 'pack' })}>Allow</button>
                <button aria-pressed={settings.subagents === 'never'} onClick={() => save({ subagents: 'never' })}>Off</button>
              </div>
            </div>
            <div className="srow">
              <span />
              <div>
                <h3>Time limit per item</h3>
                <p>Anything taking longer is stopped.</p>
              </div>
              <select className="select" style={{ width: 160 }} value={settings.stepTimeoutMinutes} onChange={(e) => save({ stepTimeoutMinutes: Number(e.target.value) })}>
                {[15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} minutes</option>)}
              </select>
            </div>
          </div>
        </section>
      )}
      <section className="setup-section">
        <h2>Spending caps</h2>
        <p>Only used when a media engine is connected in Connections.</p>
        <GenBudget />
      </section>
    </>
  );
}

const MODELS: [string, string][] = [
  ['eleven_multilingual_v2', 'Multilingual v2 — best quality'],
  ['eleven_turbo_v2_5', 'Turbo v2.5 — faster, cheaper'],
  ['eleven_flash_v2_5', 'Flash v2.5 — fastest, cheapest'],
];

/** Voiceover engine: free local Kokoro, or the user's own ElevenLabs account. */
function VoiceSection() {
  const v = useLoad(() => api.voice());
  const [installing, setInstalling] = useState(false);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const d = v.data;
  const save = async (b: Parameters<typeof api.saveVoice>[0], msg: string) => {
    setBusy(true);
    try {
      await api.saveVoice(b);
      await v.reload();
      toast(msg);
      setKey('');
    } catch (e) {
      toast(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  const current = d?.voices?.find((x) => x.id === d.voice);
  return (
    <section className="setup-section">
      <h2>Voiceover</h2>
      <p>Kokoro runs on this computer for free. Connect your own ElevenLabs account for more natural voices — your key stays on this computer.</p>
      <div className="rows">
        <div className="srow">
          <i className={`dot ${d?.provider === 'kokoro' ? 'ok' : ''}`} />
          <div>
            <h3>Kokoro (free, local)</h3>
            <p>{d?.provider === 'kokoro' ? 'In use for every voiceover.' : 'Always available as the fallback.'}</p>
          </div>
          {d && d.provider !== 'kokoro' && <button className="btn" disabled={busy} onClick={() => save({ provider: 'kokoro' }, 'Using Kokoro')}>Use Kokoro</button>}
        </div>
        <div className="srow">
          <i className={`dot ${d?.provider === 'chatterbox' ? 'ok' : ''}`} />
          <div>
            <h3>Chatterbox (free, local, more natural)</h3>
            <p>{d?.chatterbox ? (d.provider === 'chatterbox' ? 'In use for every voiceover.' : 'Installed, not in use.') : 'Open-source (MIT) voice that runs on this computer. Installs PyTorch (~2 GB); the first voiceover also downloads the voice model (~1 GB).'}</p>
          </div>
          {d?.chatterbox ? (
            d.provider !== 'chatterbox' && <button className="btn primary" disabled={busy} onClick={() => save({ provider: 'chatterbox' }, 'Using Chatterbox')}>Use it</button>
          ) : (
            <button className="btn" disabled={installing} onClick={async () => { setInstalling(true); try { const r = await api.setup('chatterbox'); toast(r.ok ? 'Chatterbox installed' : 'Install failed — see the log in Activity'); if (r.ok) await save({ provider: 'chatterbox' }, 'Using Chatterbox'); } catch (e) { toast(String((e as Error).message)); } finally { setInstalling(false); } }}>{installing ? 'Installing…' : 'Install'}</button>
          )}
        </div>
        <div className="srow">
          <i className={`dot ${d?.connected && d.provider === 'elevenlabs' ? 'ok' : ''}`} />
          <div>
            <h3>ElevenLabs (your account)</h3>
            <p>{d?.connected ? (d.error ? d.error : d.provider === 'elevenlabs' ? `In use · ${current?.name ?? 'pick a voice'}` : 'Connected, not in use') : 'Paste an API key from elevenlabs.io → Profile → API keys.'}</p>
          </div>
          {d?.connected ? (
            <div className="row-actions">
              {d.provider !== 'elevenlabs' && <button className="btn primary" disabled={busy} onClick={() => save({ provider: 'elevenlabs' }, 'Using ElevenLabs')}>Use it</button>}
              <button className="btn ghost" disabled={busy} onClick={async () => { await api.disconnectVoice(); await v.reload(); toast('ElevenLabs disconnected'); }}>Disconnect</button>
            </div>
          ) : (
            <form className="row-actions" onSubmit={(e) => { e.preventDefault(); if (key.trim()) save({ apiKey: key.trim() }, 'ElevenLabs connected'); }}>
              <input className="input" type="password" autoComplete="off" placeholder="sk_…" value={key} onChange={(e) => setKey(e.target.value)} style={{ width: 220 }} aria-label="ElevenLabs API key" />
              <button className="btn primary" disabled={busy || !key.trim()}>{busy ? 'Checking…' : 'Connect'}</button>
            </form>
          )}
          {d?.connected && (d.voices?.length ?? 0) > 0 && (
            <div className="device-code" style={{ background: 'var(--surface-2)' }}>
              <label className="field" style={{ minWidth: 240 }}>
                <span>Voice</span>
                <select className="select" value={d.voice ?? ''} onChange={(e) => save({ voice: e.target.value }, 'Voice saved')}>
                  {d.voices!.map((x) => <option key={x.id} value={x.id}>{x.name}{x.labels?.accent ? ` · ${x.labels.accent}` : ''}{x.labels?.gender ? ` · ${x.labels.gender}` : ''}</option>)}
                </select>
              </label>
              <label className="field" style={{ minWidth: 240 }}>
                <span>Model</span>
                <select className="select" value={d.model ?? MODELS[0][0]} onChange={(e) => save({ model: e.target.value }, 'Model saved')}>
                  {MODELS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </label>
              {current?.preview && <audio controls src={current.preview} style={{ height: 36 }} />}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

const STOCK: { id: StockProvider; title: string; what: string; where: string }[] = [
  { id: 'pixabay', title: 'Pixabay — footage and photos', what: 'Recommended. Free for commercial use, no attribution needed. Used first for B-roll footage.', where: 'pixabay.com/api/docs (log in, the key is on that page)' },
  { id: 'unsplash', title: 'Unsplash — photos', what: 'High-end photography, used first for photos (Pixabay fills in when Unsplash hits its hourly limit). Credits are written next to each video.', where: 'unsplash.com/oauth/applications → Access Key' },
  { id: 'pexels', title: 'Pexels — footage and photos', what: 'Used when Pixabay has nothing for a shot.', where: 'pexels.com/api' },
];

/** Optional stock footage and photos for B-roll scenes, with the user's own free keys. */
function BrollSection() {
  const b = useLoad(() => api.broll());
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <section className="setup-section">
      <h2>Stock footage</h2>
      <p>Long videos and stories can use real B-roll and photos. Add a free key — clips download to this computer, and credits are written next to each video. Without one, B-roll scenes become cinematic shots instead.</p>
      <div className="rows">
        {STOCK.map((s) => {
          const on = !!b.data?.providers?.[s.id];
          const key = keys[s.id] ?? '';
          return (
            <div className="srow" key={s.id}>
              <i className={`dot ${on ? 'ok' : ''}`} />
              <div>
                <h3>{s.title}</h3>
                <p>{on ? `Connected — ${s.what}` : `${s.what} Key: ${s.where}`}</p>
              </div>
              {on ? (
                <button className="btn ghost" onClick={async () => { await api.disconnectBroll(s.id); await b.reload(); toast(`${s.title.split(' —')[0]} disconnected`); }}>Disconnect</button>
              ) : (
                <form className="row-actions" onSubmit={async (e) => { e.preventDefault(); if (!key.trim()) return; setBusy(s.id); try { await api.saveBroll(s.id, key.trim()); await b.reload(); setKeys((k) => ({ ...k, [s.id]: '' })); toast(`${s.title.split(' —')[0]} connected`); } catch (err) { toast(String((err as Error).message)); } finally { setBusy(null); } }}>
                  <input className="input" type="password" autoComplete="off" placeholder="API key" value={key} onChange={(e) => setKeys((k) => ({ ...k, [s.id]: e.target.value }))} style={{ width: 220 }} aria-label={`${s.title} API key`} />
                  <button className="btn primary" disabled={busy === s.id || !key.trim()}>{busy === s.id ? 'Checking…' : 'Connect'}</button>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const ENGINES: { id: string; title: string; what: string; where: string }[] = [
  { id: 'fal', title: 'fal.ai — generative video & images', what: 'Any shot no other engine can make: cinematic, painted or anime-style scenes (Wan, Kling, Veo, FLUX). You pay fal per clip.', where: 'fal.ai/dashboard/keys' },
  { id: 'replicate', title: 'Replicate — generative images (and video by model)', what: 'A second catalogue of open models, used when fal isn’t connected.', where: 'replicate.com/account/api-tokens' },
  { id: 'youtube', title: 'YouTube Data API — trend research', what: 'Lets the Trend brief see which recent videos in your niche get views (free, 10,000 units a day).', where: 'console.cloud.google.com → APIs → YouTube Data API v3 → Credentials' },
  { id: 'freesound', title: 'Freesound — sound effects (CC0 only)', what: 'Whooshes, footsteps, magic, crowds — only public-domain sounds are used.', where: 'freesound.org/apiv2/apply' },
];

/** Optional engines for "Anything": generative media and sound effects, with the user's own keys. */
function EnginesSection() {
  const p = useLoad(() => api.providers());
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <section className="setup-section">
      <h2>Media engines for “Anything”</h2>
      <p>Optional. With these, Shipcast can make any kind of video — real footage (stock above), generated shots and sound effects. Keys stay on this computer; nothing is generated without one.</p>
      <div className="rows">
        {ENGINES.map((e) => {
          const on = !!p.data?.[e.id]?.connected;
          return (
            <div className="srow" key={e.id}>
              <i className={`dot ${on ? 'ok' : ''}`} />
              <div>
                <h3>{e.title}</h3>
                <p>{on ? 'Connected.' : `${e.what} Key: ${e.where}`}</p>
              </div>
              {on ? (
                <button className="btn ghost" onClick={async () => { await api.removeProvider(e.id); await p.reload(); toast(`${e.title.split(' —')[0]} disconnected`); }}>Disconnect</button>
              ) : (
                <form className="row-actions" onSubmit={async (ev) => { ev.preventDefault(); const k = (keys[e.id] ?? '').trim(); if (!k) return; setBusy(e.id); try { await api.saveProvider(e.id, k); await p.reload(); setKeys({ ...keys, [e.id]: '' }); toast('Connected'); } catch (err) { toast(String((err as Error).message)); } finally { setBusy(null); } }}>
                  <input className="input" type="password" autoComplete="off" placeholder="API key" value={keys[e.id] ?? ''} onChange={(ev) => setKeys({ ...keys, [e.id]: ev.target.value })} style={{ width: 220 }} aria-label={`${e.title} key`} />
                  <button className="btn primary" disabled={busy === e.id || !(keys[e.id] ?? '').trim()}>{busy === e.id ? 'Checking…' : 'Connect'}</button>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Spending caps for generated images and video (the gen service refuses anything over them). */
function GenBudget() {
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => void api.settings().then(setS), []);
  if (!s) return null;
  const save = async (patch: Partial<Settings>) => {
    setS(await api.saveSettings(patch));
    toast('Saved');
  };
  return (
    <div className="rows">
      <div className="srow">
        <i className="dot ok" />
        <div>
          <h3>Generation budget</h3>
          <p>Generated images and video are paid per use on your own fal.ai or Replicate account. Shipcast plans the cost first and won't go over these caps.</p>
        </div>
        <div className="row-actions">
          <label className="field" style={{ width: 120 }}><span>Per project ($)</span><input className="input" type="number" min={0} step={1} defaultValue={s.genCapPerProject ?? 5} onBlur={(e) => save({ genCapPerProject: Number(e.target.value) })} /></label>
          <label className="field" style={{ width: 120 }}><span>Per month ($)</span><input className="input" type="number" min={0} step={5} defaultValue={s.genCapPerMonth ?? 25} onBlur={(e) => save({ genCapPerMonth: Number(e.target.value) })} /></label>
        </div>
      </div>
    </div>
  );
}

const when = (iso?: string) => {
  if (!iso) return 'never';
  const d = (Date.parse(iso) - Date.now()) / 60_000;
  const a = Math.abs(d);
  const t = a < 1 ? 'now' : a < 60 ? `${Math.round(a)} min` : a < 48 * 60 ? `${Math.round(a / 60)} h` : `${Math.round(a / 1440)} days`;
  return t === 'now' ? 'now' : d > 0 ? `in ${t}` : `${t} ago`;
};
const EVERY = [
  [360, 'every 6 hours'],
  [720, 'every 12 hours'],
  [1440, 'daily'],
  [10080, 'weekly'],
] as const;

function AgentsSection() {
  const [s, setS] = useState<AgentsState | null>(null);
  const load = () => api.agents().then(setS).catch(() => {});
  useEffect(() => {
    void load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);
  if (!s) return null;
  const save = async (patch: Partial<Settings>) => {
    await api.saveSettings(patch);
    await load();
    toast('Saved');
  };
  return (
    <section className="setup-section">
      <h2>Background agents</h2>
      <p>While you're not using Shipcast, these learn from past runs and watch what's working in marketing. They wait until your own campaigns finish, stay out of quiet hours and use at most {s.cap} Claude runs a day ({s.usedToday} used today).</p>
      <div className="rows">
        {s.jobs.map((j) => (
          <div className="srow" key={j.id}>
            <i className={`dot ${j.running ? 'live' : j.enabled ? (j.lastResult && !j.lastResult.ok ? 'bad' : 'ok') : ''}`} />
            <div>
              <h3>{j.title}</h3>
              <p>{j.about}</p>
              <p className="muted" style={{ fontSize: 13 }}>
                {j.running ? 'Running now…' : j.enabled ? `Next ${when(j.nextRun)}${j.waiting ? ` · ${j.waiting}` : ''}` : 'Off'}
                {j.lastRun ? ` · last ${when(j.lastRun)}: ${j.lastResult?.summary ?? ''}` : ''}
              </p>
            </div>
            <div className="row-actions">
              <select className="input" value={j.every} onChange={async (e) => { await api.setAgent(j.id, { every: Number(e.target.value) }); await load(); }} aria-label={`${j.title} schedule`}>
                {EVERY.map(([m, l]) => <option key={m} value={m}>{l}</option>)}
                {!EVERY.some(([m]) => m === j.every) && <option value={j.every}>every {j.every} min</option>}
              </select>
              <button className="btn ghost" disabled={j.running || j.runNow} onClick={async () => { await api.runAgent(j.id); await load(); toast('Queued — it starts when nothing else is running'); }}>{j.runNow ? 'Queued' : 'Run now'}</button>
              <label className="switch"><input type="checkbox" checked={j.enabled} onChange={async (e) => { await api.setAgent(j.id, { enabled: e.target.checked }); await load(); }} /> On</label>
            </div>
          </div>
        ))}
        <div className="srow">
          <i className={`dot ${s.paused ? 'bad' : 'ok'}`} />
          <div>
            <h3>{s.paused ? 'Paused' : 'Schedule'}</h3>
            <p>Quiet hours keep them off while you sleep or present. "Run now" ignores quiet hours.</p>
          </div>
          <div className="row-actions">
            <label className="field" style={{ width: 96 }}><span>Quiet from</span><input className="input" type="time" defaultValue={s.quiet.start} onBlur={(e) => save({ agentsQuietStart: e.target.value })} /></label>
            <label className="field" style={{ width: 96 }}><span>until</span><input className="input" type="time" defaultValue={s.quiet.end} onBlur={(e) => save({ agentsQuietEnd: e.target.value })} /></label>
            <label className="field" style={{ width: 96 }}><span>Runs / day</span><input className="input" type="number" min={0} max={50} defaultValue={s.cap} onBlur={(e) => save({ agentsMaxClaudeRunsPerDay: Number(e.target.value) })} /></label>
            <button className="btn ghost" onClick={() => save({ agentsPaused: !s.paused })}>{s.paused ? 'Resume' : 'Pause all'}</button>
          </div>
        </div>
      </div>
    </section>
  );
}
