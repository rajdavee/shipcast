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
