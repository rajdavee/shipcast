import { useEffect, useRef, useState, type RefObject } from 'react';
import { auth } from '../api.ts';
import { credentialKind, deviceLabel, initials, passwordHints } from '../auth-model.ts';
import { toast } from '../hooks.ts';
import { refreshAccount, refreshClaude, signOut, useSession } from '../session.ts';
import { Dialog, PageHeader } from '../components/ui.tsx';
import { RoleChip } from '../components/Workspace.tsx';
import { Nav } from '../components/icons.tsx';
import { PasswordField } from './Auth.tsx';

const ago = (iso: string) => {
  const m = (Date.now() - Date.parse(iso)) / 60_000;
  return m < 2 ? 'just now' : m < 60 ? `${Math.round(m)} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

/** #/account: who you are, your password and devices, and the Claude account your runs use. */
export function Account({ sub }: { sub?: string }) {
  const s = useSession();
  const claudeRef = useRef<HTMLElement>(null);
  useEffect(() => {
    void refreshAccount();
    if (sub === 'claude') claudeRef.current?.scrollIntoView({ block: 'start' });
  }, [sub]);
  const a = s.account;
  if (!a) return null;
  const u = a.user;
  return (
    <main className="page settings-page account-page">
      <PageHeader title="Account" description="Your sign-in, your devices and the Claude account your runs use. Only you see this page." />
      <section className="setup-section" aria-labelledby="me-h">
        <h2 id="me-h" className="sr-only">You</h2>
        <div className="me-card">
          <span className="me-avatar lg" aria-hidden="true">{initials(u.name)}</span>
          <div>
            <b>{u.name}</b>
            <span>{u.email}</span>
            <small>{u.installOwner ? 'Set up this Shipcast · ' : ''}Member since {new Date(u.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</small>
          </div>
          <button className="btn" onClick={() => void signOut()}><Nav.signout />Sign out</button>
        </div>
        <ul className="ws-chips" aria-label="Your workspaces">
          {a.workspaces.map((w) => <li key={w.id}>{w.name} <RoleChip role={w.role} /></li>)}
        </ul>
      </section>

      <ClaudeSection innerRef={claudeRef} />
      <PasswordSection email={u.email} />
      <SessionsSection />
    </main>
  );
}

function ClaudeSection({ innerRef }: { innerRef: RefObject<HTMLElement | null> }) {
  const s = useSession();
  const c = s.claude;
  const owner = !!s.account?.user.installOwner;
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kind = credentialKind(value);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await auth.saveClaude(value.trim());
      setValue('');
      await refreshClaude();
      toast('Claude connected');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const forget = async () => {
    try {
      await auth.forgetClaude();
      await refreshClaude();
      toast(owner ? "Forgotten — runs use this machine's Claude sign-in again" : 'Forgotten — connect again to make things');
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const method = !c ? 'Checking…' : c.method === 'token' ? 'Your Claude account (token)' : c.method === 'apiKey' ? 'Your Anthropic API key' : c.method === 'machine' ? "This computer's Claude sign-in" : 'Not connected';
  return (
    <section className="setup-section" aria-labelledby="claude-h" ref={innerRef} id="claude">
      <h2 id="claude-h">Claude connection</h2>
      <p>Everything you make runs on your own Claude plan — never on anyone else's.{owner ? " As the person who set up this Shipcast you can also use this computer's Claude sign-in." : ''}</p>
      <div className="rows">
        <div className="srow">
          <i className={`dot ${c?.connected ? 'ok' : c ? 'bad' : ''}`} />
          <div>
            <h3>{method}</h3>
            <p>{!c ? '' : c.method === 'token' || c.method === 'apiKey' ? `Saved ${c.savedAt ? new Date(c.savedAt).toLocaleDateString() : ''}. It's stored for you only and never shown again.` : c.method === 'machine' ? 'Used until you paste a token of your own.' : 'Paste a token below to start making things.'}</p>
          </div>
          {(c?.method === 'token' || c?.method === 'apiKey') ? <button className="btn ghost danger" onClick={forget}>Forget</button> : null}
        </div>
        <form className="claude-form" onSubmit={(e) => (e.preventDefault(), kind && save())}>
          <label className="field">
            <span>{c?.method === 'token' || c?.method === 'apiKey' ? 'Replace with a new token or key' : c?.method === 'machine' ? 'Or use your own token or API key' : 'Token or API key'}</span>
            <div className="copy-row">
              <input className="input mono" type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-oat01-…" value={value} onChange={(e) => setValue(e.target.value)} aria-describedby="claude-how claude-err" aria-invalid={(!!value.trim() && !kind) || undefined} />
              <button className="btn primary" disabled={busy || !kind}>{busy ? 'Saving…' : 'Connect'}</button>
            </div>
          </label>
          <p className="hint" id="claude-how">Run <code>claude setup-token</code> in a terminal, sign in, and paste the token it prints. An Anthropic API key (<code>sk-ant-api…</code>) works too, billed to that key.</p>
          <div id="claude-err" role="alert">
            {value.trim() && !kind ? <p className="field-error">That doesn't look like a token (sk-ant-oat…) or an API key (sk-ant-api…).</p> : error ? <p className="field-error">{error}</p> : null}
          </div>
        </form>
      </div>
    </section>
  );
}

function PasswordSection({ email }: { email: string }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const problem = passwordHints(next, email).problem;
  return (
    <section className="setup-section" aria-labelledby="pw-h">
      <h2 id="pw-h">Password</h2>
      <p>Changing it signs you out on every other device. This one stays signed in.</p>
      <form className="card pw-form" onSubmit={async (e) => {
        e.preventDefault();
        setTried(true);
        if (problem || !current) return;
        setBusy(true);
        setError(null);
        try {
          await auth.changePassword(current, next);
          setCurrent('');
          setNext('');
          setTried(false);
          await refreshAccount();
          toast('Password changed — other devices are signed out');
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}>
        {/* Lets password managers file the change under the right account. */}
        <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />
        <PasswordField label="Current password" name="current-password" value={current} onChange={setCurrent} autoComplete="current-password" error={tried && !current ? 'Enter your current password.' : null} />
        <PasswordField label="New password" name="new-password" value={next} onChange={setNext} fresh email={email} autoComplete="new-password" error={tried ? problem : null} />
        <div role="alert">{error && <p className="banner auth-error">{error}</p>}</div>
        <div><button className="btn primary" disabled={busy}>{busy ? 'Changing…' : 'Change password'}</button></div>
      </form>
    </section>
  );
}

function SessionsSection() {
  const s = useSession();
  const [confirm, setConfirm] = useState(false);
  const list = [...(s.account?.sessions ?? [])].sort((a, b) => Number(b.current) - Number(a.current) || Date.parse(b.lastSeen) - Date.parse(a.lastSeen));
  return (
    <section className="setup-section" aria-labelledby="sessions-h">
      <h2 id="sessions-h">Where you're signed in</h2>
      <p>Each browser that signed in to your account. Sessions last 30 days from last use.</p>
      <ul className="rows" aria-label="Signed-in devices">
        {list.map((x) => (
          <li key={x.id} className="srow">
            <i className={`dot ${x.current ? 'ok' : ''}`} />
            <div>
              <h3>{deviceLabel(x.agent)}{x.current && <span className="tag this-device">This device</span>}</h3>
              <p>Signed in {ago(x.createdAt)} · last active {ago(x.lastSeen)}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="section-actions">
        <button className="btn" onClick={() => void signOut()}>Sign out on this device</button>
        {list.length > 1 && <button className="btn danger" onClick={() => setConfirm(true)}>Sign out everywhere…</button>}
      </div>
      {confirm && (
        <Dialog title="Sign out everywhere?" size="sm" onClose={() => setConfirm(false)} foot={<><button className="btn ghost" onClick={() => setConfirm(false)} data-autofocus>Cancel</button><button className="btn primary danger-fill" onClick={() => void signOut(true)}>Sign out everywhere</button></>}>
          <p className="dialog-lead">Every device signed in to your account is signed out — <b>including this one</b>, so you'll sign in again here. Use it if a device is lost or you signed in somewhere you shouldn't have stayed.</p>
          <p className="hint">To sign out only the other devices, change your password instead.</p>
        </Dialog>
      )}
    </section>
  );
}
