import { useEffect, useState } from 'react';
import { api, type LoginState, type Status } from '../api.ts';
import { toast, useLoad } from '../hooks.ts';
import { Icon } from '../components/icons.tsx';

export function Connect({ status, onChange }: { status: Status | null; onChange: () => void }) {
  const checks = useLoad(() => api.doctor());
  const [claudeLogin, setClaudeLogin] = useState<LoginState | null>(null);
  const [ghLogin, setGhLogin] = useState<LoginState | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);
  const [fixLog, setFixLog] = useState<string | null>(null);

  async function fix(id: string, label: string) {
    setFixing(id);
    setFixLog(null);
    try {
      const r = await api.setup(id);
      toast(r.ok ? `${label} is ready` : `${label} setup failed`);
      if (!r.ok) setFixLog(r.log);
      checks.reload();
    } catch (e) {
      toast(String((e as Error).message));
    } finally {
      setFixing(null);
    }
  }

  // While a login is in flight, poll status so the lamp flips the moment the browser step finishes.
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

  const c = status?.claude;
  const g = status?.github;

  return (
    <div style={{ maxWidth: 860 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">Connections</h1>
          <p className="lede">
            Shipcast never asks for an API key or a password. It uses the Claude Code and GitHub CLIs already on this machine, signed in with your own accounts.
          </p>
        </div>
      </div>

      <div className="patchbay">
        <div className="patch">
          <div className="patch-icon"><Icon.claude /></div>
          <div>
            <h3>
              <i className={`lamp ${c?.loggedIn ? 'on' : 'off'}`} /> Claude
            </h3>
            <p>
              {!c ? 'Checking…' : !c.installed ? 'Claude Code is not installed.' : c.loggedIn ? `Signed in${c.method === 'claude.ai' ? ' with your Claude subscription' : ''}${c.account ? ` as ${c.account}` : ''}. Runs use your plan's usage.` : 'Installed, but signed out.'}
            </p>
          </div>
          {c && !c.installed ? (
            <a className="btn" href="https://docs.claude.com/en/docs/claude-code/setup" target="_blank" rel="noreferrer">Install Claude Code</a>
          ) : c && !c.loggedIn ? (
            <button className="btn primary" disabled={claudeLogin?.running} onClick={async () => setClaudeLogin(await api.connectClaude())}>
              {claudeLogin?.running ? 'Waiting for browser…' : 'Sign in with Claude'}
            </button>
          ) : null}
          {claudeLogin?.running && claudeLogin.url && (
            <div className="device-code">
              <span>Your browser should open. If it didn't, <a href={claudeLogin.url} target="_blank" rel="noreferrer">open the sign-in page</a>.</span>
            </div>
          )}
        </div>

        <div className="patch">
          <div className="patch-icon"><Icon.github /></div>
          <div>
            <h3>
              <i className={`lamp ${g?.loggedIn ? 'on' : ''}`} /> GitHub <span className="hint">optional</span>
            </h3>
            <p>
              {!g ? 'Checking…' : !g.installed ? 'Install the GitHub CLI (gh) to use private repos and pull-request videos. Public repos work without it.' : g.loggedIn ? `Signed in as @${g.login}. Private repos and PR videos are available.` : 'Sign in to pick from your repos, use private ones, and make pull-request videos.'}
            </p>
          </div>
          {g && !g.installed ? (
            <a className="btn" href="https://cli.github.com" target="_blank" rel="noreferrer">Get the GitHub CLI</a>
          ) : g && !g.loggedIn ? (
            <button className="btn" disabled={ghLogin?.running} onClick={async () => setGhLogin(await api.connectGithub())}>
              {ghLogin?.running ? 'Waiting…' : 'Connect GitHub'}
            </button>
          ) : null}
          {ghLogin?.running && ghLogin.code && (
            <div className="device-code">
              <code>{ghLogin.code}</code>
              <span>
                Enter this code at <a href={ghLogin.url} target="_blank" rel="noreferrer">github.com/login/device</a>.
              </span>
              <button className="btn small" onClick={() => navigator.clipboard.writeText(ghLogin.code!)}>Copy code</button>
            </div>
          )}
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">This machine</h2>
          <button className="btn small" onClick={checks.reload}>Check again</button>
        </div>
        <p className="lede">Everything renders locally — voices with Kokoro, captions with whisper.cpp, video with headless Chrome and FFmpeg. Nothing is uploaded anywhere.</p>
        <div className="checks">
          {(checks.data ?? []).map((k) => (
            <div key={k.id} className="check">
              <div className="check-top">
                <i className={`lamp ${k.ok ? 'on' : k.required ? 'off' : ''}`} />
                {k.label}
                {!k.required && <span className="hint">optional</span>}
              </div>
              <div className="check-detail">{k.detail}</div>
              {!k.ok && k.fix ? (
                <>
                  <div className="check-hint">{k.hint}</div>
                  <button className="btn small" style={{ justifySelf: 'start', marginTop: 6 }} disabled={!!fixing} onClick={() => fix(k.fix!, k.label)}>
                    {fixing === k.fix ? 'Setting up — this can take a few minutes…' : 'Set up'}
                  </button>
                </>
              ) : (
                !k.ok && k.hint && <div className="check-hint"><code>{k.hint}</code></div>
              )}
            </div>
          ))}
          {!checks.data && <p className="hint">Checking tools…</p>}
        </div>
        {fixLog && (
          <div className="doc" style={{ marginTop: 12, maxWidth: 860 }}>
            <pre>{fixLog}</pre>
          </div>
        )}
      </section>
    </div>
  );
}
