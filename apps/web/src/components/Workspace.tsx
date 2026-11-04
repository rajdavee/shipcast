import { useState } from 'react';
import { auth } from '../api.ts';
import { initials, ROLE_LABEL } from '../auth-model.ts';
import { go, toast } from '../hooks.ts';
import { signOut, switchWorkspace, useAccess, useSession } from '../session.ts';
import { Nav } from './icons.tsx';
import { Dialog, PopMenu, type MenuItem } from './ui.tsx';

export const RoleChip = ({ role }: { role: keyof typeof ROLE_LABEL }) => <span className={`role-chip r-${role}`}>{ROLE_LABEL[role]}</span>;

/** The sidebar header: which workspace you're in and your role there; the menu switches, makes a team, or manages members. */
export function WorkspaceSwitcher() {
  const s = useSession();
  const a = useAccess();
  const [making, setMaking] = useState(false);
  const list = s.account?.workspaces ?? [];
  const w = a.workspace;
  if (!w) return null;
  const items: (MenuItem | 'sep')[] = [
    ...[...list].sort((x, y) => Number(y.personal) - Number(x.personal) || x.name.localeCompare(y.name)).map((x) => ({
      id: x.id,
      label: x.name,
      hint: <>{x.personal ? 'Personal' : `${x.members} member${x.members === 1 ? '' : 's'}`} · {ROLE_LABEL[x.role]}</>,
      icon: <span className="ws-avatar sm">{initials(x.name)}</span>,
      current: x.id === w.id,
      run: () => x.id !== w.id && switchWorkspace(x.id).catch((e) => toast((e as Error).message)),
    })),
    'sep',
    { id: 'new', label: 'New team workspace', icon: <Nav.plus />, run: () => setMaking(true) },
    { id: 'members', label: 'Manage members', icon: <Nav.users />, run: () => go('/settings/members') },
  ];
  return (
    <>
      <PopMenu
        label="Workspaces"
        items={items}
        trigger={({ open, toggle, ref }) => (
          <button ref={ref} className="ws-switch" aria-haspopup="menu" aria-expanded={open} onClick={toggle} title={`${w.name} · ${ROLE_LABEL[w.role]}`} aria-label={`Workspace: ${w.name}, ${ROLE_LABEL[w.role]}. Switch workspace`}>
            <span className="ws-avatar">{initials(w.name)}</span>
            <span className="ws-text side-label">
              <b>{w.name}</b>
              <RoleChip role={w.role} />
            </span>
            <span className="ws-chev side-label"><Nav.updown /></span>
          </button>
        )}
      />
      {making && <NewWorkspaceDialog onClose={() => setMaking(false)} />}
    </>
  );
}

export function NewWorkspaceDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const w = await auth.createWorkspace(name.trim());
      onClose();
      await switchWorkspace(w.id, true);
      go('/settings/members');
      toast(`${w.name} is ready — invite people`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="New team workspace"
      size="sm"
      busy={busy}
      onClose={onClose}
      foot={<><button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button><button className="btn primary" form="new-ws" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create workspace'}</button></>}
    >
      <form id="new-ws" className="dialog-form" onSubmit={(e) => (e.preventDefault(), name.trim() && create())}>
        <p className="dialog-lead">A shared place for a team: its own projects, calendar, brand voices and connections. You'll be its owner and can invite people next.</p>
        <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme marketing" maxLength={80} autoComplete="off" data-autofocus /></label>
        <div role="alert">{error && <p className="error-text">{error}</p>}</div>
      </form>
    </Dialog>
  );
}

/** The sidebar footer: who you are, your account and signing out. */
export function AccountMenu() {
  const s = useSession();
  const u = s.account?.user;
  if (!u) return null;
  return (
    <PopMenu
      label="Account"
      up
      head={<div className="menu-head"><b>{u.name}</b><span>{u.email}</span></div>}
      items={[
        { id: 'account', label: 'Account', icon: <Nav.user />, run: () => go('/account') },
        { id: 'claude', label: 'Claude connection', icon: <Nav.key />, run: () => go('/account/claude') },
        'sep',
        { id: 'out', label: 'Sign out', icon: <Nav.signout />, run: () => void signOut() },
      ]}
      trigger={({ open, toggle, ref }) => (
        <button ref={ref} className="side-link me-btn" aria-haspopup="menu" aria-expanded={open} onClick={toggle} title={u.email} aria-label={`Account: ${u.name}`}>
          <span className="me-avatar" aria-hidden="true">{initials(u.name)}</span>
          <span className="side-label me-name">{u.name}</span>
        </button>
      )}
    />
  );
}

/** Across the app when this person's runs have no Claude to use. */
export function ClaudeBanner() {
  const s = useSession();
  const a = useAccess();
  if (!s.claude || s.claude.connected || a.installOwner || !a.write) return null;
  return (
    <div className="app-banner" role="status">
      <Nav.key />
      <span><b>Connect your Claude account to make things.</b> Everything you make runs on your own Claude plan.</span>
      <a className="btn sm primary" href="#/account/claude">Connect</a>
    </div>
  );
}
