import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { auth, setCurrentWorkspace, type InviteInfo } from '../api.ts';
import { emailProblem, passwordHints, ROLE_ABOUT, ROLE_LABEL } from '../auth-model.ts';
import { go, toast } from '../hooks.ts';
import { boot, signOut, useSession } from '../session.ts';
import { Mark, Nav } from '../components/icons.tsx';
import { ThemeSwitch } from '../components/Shell.tsx';
import { Loading } from '../components/ui.tsx';

/** Full-page frame for signing in and up: the mark, one card, nothing else to get lost in. */
function AuthFrame({ title, lead, children, foot }: { title: ReactNode; lead?: ReactNode; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="auth-page">
      <header className="auth-top">
        <span className="logo"><Mark className="" /><span>Shipcast</span></span>
        <ThemeSwitch />
      </header>
      <main className="auth-main">
        <section className="auth-card" aria-labelledby="auth-title">
          <h1 id="auth-title">{title}</h1>
          {lead && <div className="auth-lead">{lead}</div>}
          {children}
        </section>
        {foot && <div className="auth-foot">{foot}</div>}
      </main>
    </div>
  );
}

function Field({ label, error, hint, children, id }: { label: string; error?: string | null; hint?: ReactNode; children: (a: { id: string; describedBy?: string; invalid: boolean }) => ReactNode; id?: string }) {
  const auto = useId();
  const fid = id ?? auto;
  const describedBy = [error ? `${fid}-err` : '', hint ? `${fid}-hint` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={fid}>{label}</label>
      {children({ id: fid, describedBy, invalid: !!error })}
      {hint && <div className="field-hint" id={`${fid}-hint`}>{hint}</div>}
      {error && <p className="field-error" id={`${fid}-err`}>{error}</p>}
    </div>
  );
}

/** A password box with show/hide; `fresh` turns on the live rule checklist for new passwords. */
export function PasswordField({ label = 'Password', value, onChange, fresh, email = '', error, autoComplete, name = 'password' }: { label?: string; value: string; onChange: (v: string) => void; fresh?: boolean; email?: string; error?: string | null; autoComplete: 'current-password' | 'new-password'; name?: string }) {
  const [show, setShow] = useState(false);
  const { hints } = passwordHints(value, email);
  return (
    <Field
      label={label}
      error={error}
      hint={fresh ? (
        <ul className="pw-rules" aria-label="Password rules">
          {hints.map((h) => <li key={h.id} className={h.ok ? 'ok' : ''}><span aria-hidden="true">{h.ok ? <Nav.check /> : <i />}</span>{h.text}<span className="sr-only">{h.ok ? ' — done' : ' — not yet'}</span></li>)}
        </ul>
      ) : undefined}
    >
      {({ id, describedBy, invalid }) => (
        <div className="pw-box">
          <input id={id} name={name} className="input" type={show ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid || undefined} required minLength={fresh ? 10 : undefined} maxLength={200} spellCheck={false} autoCapitalize="off" />
          <button type="button" className="pw-toggle" aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show} onClick={() => setShow(!show)}>{show ? <Nav.eyeOff /> : <Nav.eye />}</button>
        </div>
      )}
    </Field>
  );
}

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

/** The form-level error, announced when it appears. */
const FormError = ({ error }: { error: string | null }) => <div role="alert" aria-live="assertive">{error && <p className="banner auth-error">{error}</p>}</div>;

/** Create an account: the install's first (the owner), an open sign-up, or with an invite. */
function SignUpForm({ invite, lockedEmail, submitLabel, onDone }: { invite?: string; lockedEmail?: string; submitLabel: string; onDone: (r: { migrated?: string[] }) => Promise<void> | void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState(lockedEmail ?? '');
  const [password, setPassword] = useState('');
  const [tried, setTried] = useState(false);
  const { busy, error, run } = useSubmit();
  const emailErr = tried ? emailProblem(email) : null;
  const pwErr = tried ? passwordHints(password, email).problem : null;
  const form = useRef<HTMLFormElement>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (emailProblem(email) || passwordHints(password, email).problem) {
      // Focus the first field that needs fixing so a screen reader hears its error.
      setTimeout(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    run(async () => {
      const r = await auth.signUp({ name: name.trim(), email: email.trim(), password, ...(invite ? { invite } : {}) });
      await onDone(r);
    });
  };
  return (
    <form className="auth-form" onSubmit={submit} noValidate ref={form}>
      <Field label="Your name">{({ id }) => <input id={id} name="name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />}</Field>
      <Field label="Email" error={emailErr}>
        {({ id, describedBy, invalid }) => <input id={id} name="email" className="input" type="email" autoComplete="username" inputMode="email" autoCapitalize="off" spellCheck={false} value={email} readOnly={!!lockedEmail} onChange={(e) => setEmail(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid || undefined} required />}
      </Field>
      <PasswordField value={password} onChange={setPassword} fresh email={email} error={pwErr} autoComplete="new-password" />
      <FormError error={error} />
      <button className="btn primary lg auth-submit" disabled={busy}>{busy ? 'Creating your account…' : submitLabel}</button>
    </form>
  );
}

function SignInForm({ submitLabel = 'Sign in', onDone }: { submitLabel?: string; onDone: () => Promise<void> | void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useSubmit();
  return (
    <form className="auth-form" onSubmit={(e) => { e.preventDefault(); run(async () => { await auth.signIn(email.trim(), password); setPassword(''); await onDone(); }); }}>
      <Field label="Email">{({ id }) => <input id={id} name="email" className="input" type="email" autoComplete="username" inputMode="email" autoCapitalize="off" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />}</Field>
      <PasswordField value={password} onChange={setPassword} autoComplete="current-password" />
      <FormError error={error} />
      <button className="btn primary lg auth-submit" disabled={busy || !email.trim() || !password}>{busy ? 'Signing in…' : submitLabel}</button>
    </form>
  );
}

export function FirstRun() {
  return (
    <AuthFrame
      title="Set up Shipcast"
      lead={<>
        <p>Create the first account. It becomes the <b>owner</b> of this Shipcast — you can invite people and choose what they may do.</p>
        <p>Anything already made here (projects, calendar, brand voices, connections) moves into your workspace.</p>
      </>}
    >
      <SignUpForm submitLabel="Create account" onDone={async (r) => {
        await boot();
        go('/new');
        if (r.migrated?.length) toast('Your existing projects are in your workspace');
      }} />
    </AuthFrame>
  );
}

export function SignIn() {
  const s = useSession();
  return (
    <AuthFrame
      title="Sign in"
      lead={s.notice ? <p role="status">{s.notice}</p> : <p>Welcome back.</p>}
      foot={<p>{s.status?.openSignup ? <>New here? <a href="#/signup">Create an account</a>. </> : <>New here? Ask someone in your team for an invite link.</>}</p>}
    >
      <SignInForm onDone={boot} />
    </AuthFrame>
  );
}

export function SignUp() {
  return (
    <AuthFrame title="Create your account" lead={<p>You get a private workspace of your own. Join a team later with an invite link.</p>} foot={<p>Have an account? <a href="#/">Sign in</a>.</p>}>
      <SignUpForm submitLabel="Create account" onDone={async () => { await boot(); go('/new'); }} />
    </AuthFrame>
  );
}

/** #/join/<token>: what the invite is for, then sign up, sign in, or (already signed in) just join. */
export function Join({ token }: { token: string }) {
  const s = useSession();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const { busy, error, run } = useSubmit();
  useEffect(() => {
    auth.inviteInfo(token).then(setInfo).catch((e) => setInfo({ valid: false, problem: (e as Error).message }));
  }, [token]);
  const signedIn = s.phase === 'ready' && s.account;
  const finish = async (workspace?: string) => {
    if (workspace) setCurrentWorkspace(workspace);
    await boot();
    go('/new');
    toast(`Welcome to ${info?.workspace ?? 'the workspace'}`);
  };
  const joinAs = () => run(async () => {
    const r = await auth.join(token);
    await finish(r.workspace);
  });

  if (!info || s.phase === 'loading') return <AuthFrame title="Join a workspace"><Loading label="Checking the invite…" /></AuthFrame>;
  if (!info.valid) {
    return (
      <AuthFrame title="This invite can't be used" lead={<p role="alert">{info.problem ?? 'That invite link is not valid.'}</p>} foot={<p>Ask the person who invited you for a new link.</p>}>
        <a className="btn lg auth-submit" href="#/">{signedIn ? 'Go to Shipcast' : 'Sign in'}</a>
      </AuthFrame>
    );
  }
  const role = info.role ?? 'viewer';
  const lead = (
    <div className="invite-card">
      <span className="invite-mark" aria-hidden="true"><Nav.users /></span>
      <div>
        <b>{info.workspace}</b>
        <span>You're invited as <span className="role-chip">{ROLE_LABEL[role]}</span> — {ROLE_ABOUT[role].toLowerCase()}.</span>
        <small>{info.email ? `For ${info.email}. ` : ''}The link works once and expires 7 days after it was made.</small>
      </div>
    </div>
  );
  if (signedIn) {
    const wrongEmail = !!info.email && info.email !== s.account!.user.email;
    return (
      <AuthFrame title="You're invited" lead={lead} foot={<p>Signed in as {s.account!.user.email}. Not you? <button className="linkish" onClick={() => signOut()}>Sign out</button></p>}>
        {wrongEmail && <p className="banner">This invite was sent to {info.email}. Sign out and sign in as that person to use it.</p>}
        <FormError error={error} />
        <button className="btn primary lg auth-submit" disabled={busy || wrongEmail} onClick={joinAs}>{busy ? 'Joining…' : `Join ${info.workspace}`}</button>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame title="You're invited" lead={lead}>
      <div className="seg auth-mode" role="group" aria-label="Do you have an account?">
        <button type="button" aria-pressed={mode === 'new'} onClick={() => setMode('new')}>I'm new here</button>
        <button type="button" aria-pressed={mode === 'existing'} onClick={() => setMode('existing')}>I have an account</button>
      </div>
      {mode === 'new' ? (
        <SignUpForm key="new" invite={token} lockedEmail={info.email} submitLabel="Create account and join" onDone={async () => finish()} />
      ) : (
        <SignInForm key="existing" submitLabel="Sign in and join" onDone={async () => finish((await auth.join(token)).workspace)} />
      )}
    </AuthFrame>
  );
}

export function Offline({ message }: { message?: string }) {
  return (
    <AuthFrame title="Can't reach Shipcast" lead={<p role="alert">{message ?? 'The server did not answer.'} Make sure Shipcast is running, then try again.</p>}>
      <button className="btn primary lg auth-submit" onClick={() => void boot()}>Try again</button>
    </AuthFrame>
  );
}
