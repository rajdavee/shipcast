import { useState } from 'react';
import { auth, type MemberView, type PendingInvite } from '../api.ts';
import { initials, inviteRoles, removal, ROLE_ABOUT, ROLE_LABEL, roleChoices, type Role } from '../auth-model.ts';
import { go, toast, useLoad } from '../hooks.ts';
import { refreshAccount, sessionState, switchWorkspace, useAccess, useSession } from '../session.ts';
import { AskAdmin, Dialog, Loading } from '../components/ui.tsx';
import { NewWorkspaceDialog, RoleChip } from '../components/Workspace.tsx';
import { Cal, Nav } from '../components/icons.tsx';

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Settings → Members: who is in this workspace and what they may do, invites, and the workspace itself. */
export function Members() {
  const a = useAccess();
  const s = useSession();
  const w = a.workspace;
  const data = useLoad(() => (w ? auth.members(w.id) : Promise.resolve(null)), [w?.id]);
  const [inviting, setInviting] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: 'remove' | 'leave'; m: MemberView } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [making, setMaking] = useState(false);
  if (!w) return <Loading />;
  const me = s.account!.user.id;
  const members = data.data?.members ?? [];
  const owners = members.filter((m) => m.role === 'owner').length;
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast(done);
      data.reload();
      await refreshAccount();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <>
      <section className="setup-section">
        <h2>{w.personal ? 'Your personal workspace' : w.name}</h2>
        <p>{w.personal ? 'Only you can see what is in here. To work with other people, make a team workspace and invite them.' : 'Everyone here shares the projects, calendar, brand voices and connections of this workspace. Their own Claude account does the making.'}</p>
        {w.personal && <button className="btn primary" onClick={() => setMaking(true)}><Nav.plus />New team workspace</button>}
      </section>

      <section className="setup-section" aria-labelledby="members-h">
        <div className="section-row">
          <h2 id="members-h">Members</h2>
          {!w.personal && (a.manage ? <button className="btn primary" onClick={() => setInviting(true)}><Nav.plus />Invite people</button> : <AskAdmin>Ask a workspace admin to invite people</AskAdmin>)}
        </div>
        {data.error && <p className="banner" role="alert">{data.error}</p>}
        {!data.data && !data.error ? <Loading /> : (
          <ul className="rows member-list" aria-label={`Members of ${w.name}`}>
            {members.map((m) => {
              const self = m.id === me;
              const choices = roleChoices(a.role, m.role, { self, personal: w.personal, owners });
              const rm = removal(a.role, m.role, { self, personal: w.personal, owners });
              return (
                <li key={m.id} className="srow member">
                  <span className="me-avatar" aria-hidden="true">{initials(m.name || m.email)}</span>
                  <div className="member-who">
                    <h3>{m.name || m.email}{self && <span className="muted"> · you</span>}</h3>
                    <p>{m.email} · joined {day(m.addedAt)}</p>
                  </div>
                  <div className="row-actions">
                    {choices.length > 1 ? (
                      <select className="select role-select" value={m.role} aria-label={`Role for ${m.name || m.email}`} onChange={(e) => act(() => auth.setRole(w.id, m.id, e.target.value as Role), `${m.name || m.email} is now ${ROLE_LABEL[e.target.value as Role].toLowerCase()}`)}>
                        {choices.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    ) : <RoleChip role={m.role} />}
                    {rm && <button className="btn ghost sm danger" onClick={() => setConfirm({ kind: rm, m })}>{rm === 'leave' ? 'Leave' : 'Remove'}</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <details className="roles-help">
          <summary>What each role can do</summary>
          <dl>{(['owner', 'admin', 'editor', 'viewer'] as Role[]).map((r) => <div key={r}><dt><RoleChip role={r} /></dt><dd>{ROLE_ABOUT[r]}</dd></div>)}</dl>
        </details>
      </section>

      {a.manage && !w.personal && (
        <section className="setup-section" aria-labelledby="invites-h">
          <h2 id="invites-h">Pending invites</h2>
          <p>Links that haven't been used yet. Each works once and expires after 7 days.</p>
          {(data.data?.invites.length ?? 0) === 0 ? <p className="hint">No pending invites.</p> : (
            <ul className="rows" aria-label="Pending invites">
              {data.data!.invites.map((i: PendingInvite) => (
                <li key={i.id} className="srow">
                  <span className="invite-ico" aria-hidden="true"><Cal.link /></span>
                  <div>
                    <h3>{i.email ?? 'Anyone with the link'} <RoleChip role={i.role} /></h3>
                    <p>Made {day(i.createdAt)} · expires {day(i.expiresAt)}</p>
                  </div>
                  <button className="btn ghost sm danger" onClick={() => act(() => auth.revokeInvite(w.id, i.id), 'Invite revoked — the link no longer works')}>Revoke</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!w.personal && <WorkspaceAdmin onDelete={() => setDeleting(true)} />}
      {a.install && <SignupSwitch />}

      {inviting && <InviteDialog onClose={() => { setInviting(false); data.reload(); }} />}
      {making && <NewWorkspaceDialog onClose={() => setMaking(false)} />}
      {confirm && (
        <ConfirmDialog
          title={confirm.kind === 'leave' ? `Leave ${w.name}?` : `Remove ${confirm.m.name || confirm.m.email}?`}
          body={confirm.kind === 'leave' ? "You'll lose access to its projects and calendar at once. Someone will need to invite you again to come back." : 'They lose access to this workspace at once. What they made stays here.'}
          action={confirm.kind === 'leave' ? 'Leave workspace' : 'Remove'}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await auth.removeMember(w.id, confirm.m.id);
            setConfirm(null);
            if (confirm.kind === 'leave') {
              const home = sessionState().account?.workspaces.find((x) => x.personal);
              if (home) await switchWorkspace(home.id, true);
              toast(`You left ${w.name}`);
              go('/new');
            } else {
              toast(`${confirm.m.name || confirm.m.email} removed`);
              data.reload();
              await refreshAccount();
            }
          }}
        />
      )}
      {deleting && <DeleteDialog name={w.name} id={w.id} onClose={() => setDeleting(false)} />}
    </>
  );
}

/** Rename (admins) and delete (owners) a team workspace. */
function WorkspaceAdmin({ onDelete }: { onDelete: () => void }) {
  const a = useAccess();
  const w = a.workspace!;
  const [name, setName] = useState(w.name);
  const [busy, setBusy] = useState(false);
  return (
    <section className="setup-section" aria-labelledby="ws-h">
      <h2 id="ws-h">Workspace</h2>
      <div className="rows">
        <div className="srow">
          <span />
          <div><h3>Name</h3><p>Shown in everyone's workspace menu.</p></div>
          {a.manage ? (
            <form className="row-actions" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { await auth.rename(w.id, name.trim()); await refreshAccount(); toast('Renamed'); } catch (err) { toast((err as Error).message); } finally { setBusy(false); } }}>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Workspace name" style={{ width: 220 }} />
              <button className="btn" disabled={busy || !name.trim() || name.trim() === w.name}>Rename</button>
            </form>
          ) : <AskAdmin />}
        </div>
        <div className="srow">
          <span />
          <div><h3>Delete workspace</h3><p>Removes it for every member. Its files are set aside on this computer, not destroyed.</p></div>
          {a.own ? <button className="btn danger" onClick={onDelete}>Delete…</button> : <AskAdmin>Only an owner can delete it</AskAdmin>}
        </div>
      </div>
    </section>
  );
}

/** Install owner only: whether people can make accounts without an invite. */
function SignupSwitch() {
  const st = useLoad(() => auth.status());
  const open = !!st.data?.openSignup;
  return (
    <section className="setup-section" aria-labelledby="signup-h">
      <h2 id="signup-h">Sign-up on this Shipcast</h2>
      <p>You set this Shipcast up, so this one is yours. It applies to the whole install, not just this workspace.</p>
      <div className="rows">
        <div className="srow">
          <i className={`dot ${open ? 'warn' : 'ok'}`} />
          <div>
            <h3>Allow anyone to sign up</h3>
            <p>{open ? 'Anyone who can reach this server can make an account (they get a private workspace, nothing of yours).' : 'Off — new people need an invite link.'}</p>
          </div>
          <label className="switch"><input type="checkbox" checked={open} disabled={!st.data} onChange={async (e) => { try { await auth.setOpenSignup(e.target.checked); st.reload(); toast(e.target.checked ? 'Open sign-up is on' : 'Sign-up is by invite only'); } catch (err) { toast((err as Error).message); } }} /> Allow</label>
        </div>
      </div>
    </section>
  );
}

function InviteDialog({ onClose }: { onClose: () => void }) {
  const a = useAccess();
  const w = a.workspace!;
  const roles = inviteRoles(a.role);
  const [role, setRole] = useState<Role>(roles.includes('editor') ? 'editor' : roles[0]);
  const [email, setEmail] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await auth.invite(w.id, role, email.trim() || undefined);
      setLink(new URL(r.link, location.origin).href);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link!);
      setCopied(true);
    } catch {
      document.querySelector<HTMLInputElement>('#invite-link')?.select();
    }
  };
  return (
    <Dialog
      title={link ? 'Send this link' : `Invite people to ${w.name}`}
      size="sm"
      busy={busy}
      onClose={onClose}
      foot={link ? <button className="btn primary" onClick={onClose}>Done</button> : <><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" form="invite-form" disabled={busy}>{busy ? 'Making link…' : 'Make invite link'}</button></>}
    >
      {link ? (
        <div className="invite-done">
          <p className="dialog-lead">Send it to {email.trim() || 'the person'} however you like. They'll join as <b>{ROLE_LABEL[role].toLowerCase()}</b>.</p>
          <div className="copy-row">
            <input id="invite-link" className="input mono" readOnly value={link} aria-label="Invite link" onFocus={(e) => e.target.select()} data-autofocus />
            <button className="btn" onClick={copy}>{copied ? <><Nav.check />Copied</> : 'Copy'}</button>
          </div>
          <p className="hint" role="status">{copied ? 'Copied to the clipboard. ' : ''}This is the only time the link is shown. It works once and expires in 7 days — revoke it from Pending invites if it goes to the wrong place.</p>
        </div>
      ) : (
        <form id="invite-form" className="dialog-form" onSubmit={(e) => (e.preventDefault(), create())}>
          <fieldset className="role-pick-set">
            <legend>Role</legend>
            {roles.map((r) => (
              <label key={r} className={`role-option${role === r ? ' on' : ''}`}>
                <input type="radio" name="invite-role" value={r} checked={role === r} onChange={() => setRole(r)} />
                <span><b>{ROLE_LABEL[r]}</b><small>{ROLE_ABOUT[r]}</small></span>
              </label>
            ))}
          </fieldset>
          <label className="field">
            <span>Email <small className="muted">· optional</small></span>
            <input className="input" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" aria-describedby="invite-email-hint" />
            <small className="hint" id="invite-email-hint">With an email, only that person can use the link.</small>
          </label>
          <div role="alert">{error && <p className="error-text">{error}</p>}</div>
        </form>
      )}
    </Dialog>
  );
}

function ConfirmDialog({ title, body, action, onClose, onConfirm }: { title: string; body: string; action: string; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title={title} size="sm" busy={busy} onClose={onClose} foot={<><button className="btn ghost" onClick={onClose} disabled={busy} data-autofocus>Cancel</button><button className="btn primary danger-fill" disabled={busy} onClick={async () => { setBusy(true); setError(null); try { await onConfirm(); } catch (e) { setError((e as Error).message); setBusy(false); } }}>{busy ? 'Working…' : action}</button></>}>
      <p className="dialog-lead">{body}</p>
      <div role="alert">{error && <p className="error-text">{error}</p>}</div>
    </Dialog>
  );
}

function DeleteDialog({ name, id, onClose }: { name: string; id: string; onClose: () => void }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = typed.trim() === name.trim();
  const del = async () => {
    setBusy(true);
    setError(null);
    try {
      await auth.deleteWorkspace(id);
      const home = sessionState().account?.workspaces.find((x) => x.personal);
      onClose();
      if (home) await switchWorkspace(home.id, true);
      go('/new');
      toast(`${name} deleted`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Dialog title={`Delete ${name}?`} size="sm" busy={busy} onClose={onClose} foot={<><button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button><button className="btn primary danger-fill" form="del-ws" disabled={busy || !ok}>{busy ? 'Deleting…' : 'Delete workspace'}</button></>}>
      <form id="del-ws" className="dialog-form" onSubmit={(e) => (e.preventDefault(), ok && del())}>
        <p className="dialog-lead">Every member loses access at once, and its projects, calendar and connections disappear from Shipcast. The files are moved aside on this computer, not destroyed.</p>
        <label className="field"><span>Type <b>{name}</b> to confirm</span><input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} data-autofocus /></label>
        <div role="alert">{error && <p className="error-text">{error}</p>}</div>
      </form>
    </Dialog>
  );
}
