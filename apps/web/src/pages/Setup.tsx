import { useEffect, useState } from 'react';
import { api, type LoginState, type Settings, type Status } from '../api.ts';
import { toast, useLoad } from '../hooks.ts';

const NAMES: Record<string, string> = { render: 'Video renderer', stills: 'Image & PDF renderer', media: 'Voice, captions & music', qa: 'Quality checks' };

export function Setup({ status, onChange }: { status: Status | null; onChange: () => void }) {
  const checks = useLoad(() => api.doctor());
  const services = useLoad(() => api.services(), [], 5000);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [claudeLogin, setClaudeLogin] = useState<LoginState | null>(null);
  const [ghLogin, setGhLogin] = useState<LoginState | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);
  const [fixLog, setFixLog] = useState<string | null>(null);

  useEffect(() => void api.settings().then(setSettings), []);
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

  const save = async (patch: Partial<Settings>) => {
    setSettings(await api.saveSettings(patch));
    toast('Saved');
  };
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
    <main className="page narrow">
      <div className="camp-head">
        <div>
          <h1>Setup</h1>
          <p>Shipcast never asks for API keys or passwords. It uses the Claude Code and GitHub apps already signed in on this computer.</p>
        </div>
      </div>

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

      {settings && (
        <section className="setup-section">
          <h2>Preferences</h2>
          <p>Stored in ~/.shipcast/settings.json.</p>
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
    </main>
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
          <i className={`dot ${d && (!d.connected || d.provider === 'kokoro') ? 'ok' : ''}`} />
          <div>
            <h3>Kokoro (free, local)</h3>
            <p>{d?.provider === 'kokoro' || !d?.connected ? 'In use for every voiceover.' : 'Available as the fallback if ElevenLabs fails.'}</p>
          </div>
          {d?.connected && d.provider !== 'kokoro' && <button className="btn" disabled={busy} onClick={() => save({ provider: 'kokoro' }, 'Using Kokoro')}>Use Kokoro</button>}
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
            <div className="device-code" style={{ background: 'var(--bg-2)' }}>
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

/** Optional stock footage for B-roll scenes, with the user's own free Pexels key. */
function BrollSection() {
  const b = useLoad(() => api.broll());
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <section className="setup-section">
      <h2>Stock footage</h2>
      <p>Long videos and stories can use real B-roll. Add a free Pexels API key (pexels.com/api) — clips download to this computer, and credits are written next to each video.</p>
      <div className="rows">
        <div className="srow">
          <i className={`dot ${b.data?.connected ? 'ok' : ''}`} />
          <div>
            <h3>Pexels</h3>
            <p>{b.data?.connected ? 'Connected — B-roll scenes use real footage.' : 'Not connected — B-roll scenes become cinematic shots instead.'}</p>
          </div>
          {b.data?.connected ? (
            <button className="btn ghost" onClick={async () => { await api.disconnectBroll(); await b.reload(); toast('Pexels disconnected'); }}>Disconnect</button>
          ) : (
            <form className="row-actions" onSubmit={async (e) => { e.preventDefault(); if (!key.trim()) return; setBusy(true); try { await api.saveBroll(key.trim()); await b.reload(); setKey(''); toast('Pexels connected'); } catch (err) { toast(String((err as Error).message)); } finally { setBusy(false); } }}>
              <input className="input" type="password" autoComplete="off" placeholder="Pexels API key" value={key} onChange={(e) => setKey(e.target.value)} style={{ width: 220 }} aria-label="Pexels API key" />
              <button className="btn primary" disabled={busy || !key.trim()}>{busy ? 'Checking…' : 'Connect'}</button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
