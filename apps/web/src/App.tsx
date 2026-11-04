import { useEffect, useMemo, useState } from 'react';
import { api, useWorkspaceId } from './api.ts';
import { go, resolveRoute, toast, useLoad, useRoute, useTheme, useToast, type SettingsTab } from './hooks.ts';
import { Nav } from './components/icons.tsx';
import { Shell } from './components/Shell.tsx';
import { Palette, commands } from './components/Palette.tsx';
import { Home } from './pages/Home.tsx';
import { Campaign } from './pages/Campaign.tsx';
import { Library } from './pages/Library.tsx';
import { Settings } from './pages/Settings.tsx';
import { Voice } from './pages/Voice.tsx';
import { Insights } from './pages/Insights.tsx';
import { Trending } from './pages/Trending.tsx';
import { Calendar } from './pages/Calendar.tsx';
import { Account } from './pages/Account.tsx';
import { FirstRun, Join, Offline, SignIn, SignUp } from './pages/Auth.tsx';
import { ClaudeBanner } from './components/Workspace.tsx';
import { Loading } from './components/ui.tsx';
import { boot, signOut, switchWorkspace, useAccess, useSession } from './session.ts';
import { ROLE_LABEL } from './auth-model.ts';

/** Signed out: the auth screens. Signed in: the studio, remounted per workspace so every page and the palette load that workspace's data afresh. */
export function App() {
  const s = useSession();
  const raw = useRoute();
  const ws = useWorkspaceId();
  useEffect(() => void boot(), []);
  if (raw[0] === 'join' && raw[1]) return <Join token={raw[1]} />;
  if (s.phase === 'loading') return <div className="auth-page"><main className="auth-main"><Loading label="Opening Shipcast…" /></main></div>;
  if (s.phase === 'offline') return <Offline message={s.notice} />;
  if (s.phase === 'setup') return <FirstRun />;
  if (s.phase === 'signed-out') return raw[0] === 'signup' && s.status?.openSignup ? <SignUp /> : <SignIn />;
  return <Studio key={ws ?? 'none'} />;
}

function Studio() {
  const raw = useRoute();
  const access = useAccess();
  const session = useSession();
  const route = resolveRoute(raw);
  const status = useLoad(() => api.status(), [], 10000);
  const services = useLoad(() => api.services(), [], 10000);
  const campaigns = useLoad(() => api.campaigns(), [route.join('/')], 6000);
  const toastMsg = useToast();
  const [palette, setPalette] = useState(false);
  const [theme, setTheme] = useTheme();
  const live = !!campaigns.data?.some((c) => c.steps.some((s) => s.status === 'running' || s.status === 'queued'));
  const ready = !!status.data?.claude.loggedIn && !!services.data?.every((s) => s.ok);
  const place = route[0] === 'c' ? 'library' : route[0];

  // Old links (#/setup, #/trending…) land on the canonical address so the sidebar and back button agree.
  useEffect(() => {
    if (raw.join('/') !== route.join('/')) location.replace(`#/${route.join('/')}`);
  }, [raw.join('/')]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey) && !e.altKey) {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    document.title = route[0] === 'c' ? 'Shipcast' : `${{ new: 'Create', account: 'Account', calendar: 'Calendar', library: 'Library', ideas: 'Ideas', brand: 'Brand', insights: 'Insights', settings: 'Settings' }[place] ?? 'Shipcast'} · Shipcast`;
  }, [place]);

  const items = useMemo(() => commands(campaigns.data, [
    { id: 'a-theme', group: 'Actions', label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', keywords: 'theme appearance mode', icon: theme === 'dark' ? <Nav.sun /> : <Nav.moon />, run: () => setTheme(theme === 'dark' ? 'light' : 'dark') },
    ...(session.account?.workspaces ?? []).filter((w) => w.id !== access.workspace?.id).map((w) => ({ id: `w-${w.id}`, group: 'Actions' as const, label: `Switch to ${w.name}`, hint: ROLE_LABEL[w.role], keywords: 'workspace team switch', icon: <Nav.users />, run: () => void switchWorkspace(w.id).catch((e) => toast((e as Error).message)) })),
    { id: 'a-members', group: 'Actions', label: 'Manage members', hint: access.workspace?.name, keywords: 'workspace team invite people roles', icon: <Nav.users />, run: () => go('/settings/members') },
    { id: 'a-account', group: 'Actions', label: 'Account', hint: 'Password, sessions, Claude connection', keywords: 'profile password sessions claude token', icon: <Nav.user />, run: () => go('/account') },
    { id: 'a-signout', group: 'Actions', label: 'Sign out', keywords: 'log out logout', icon: <Nav.signout />, run: () => void signOut() },
  ], access), [campaigns.data, theme, session.account, access.workspace?.id, access.write]);

  return (
    <Shell place={place} status={{ checked: !!status.data && !!services.data, ready, working: live }} onSearch={() => setPalette(true)}>
      <ClaudeBanner />
      {route[0] === 'account' ? (
        <Account sub={route[1]} />
      ) : route[0] === 'c' && route[1] ? (
        <Campaign id={route[1]} />
      ) : route[0] === 'library' ? (
        <Library campaigns={campaigns.data} />
      ) : route[0] === 'calendar' ? (
        <Calendar sub={route[1]} arg={route[2]} />
      ) : route[0] === 'brand' ? (
        <Voice />
      ) : route[0] === 'ideas' ? (
        <Trending />
      ) : route[0] === 'insights' ? (
        <Insights tab={route[1]} />
      ) : route[0] === 'settings' ? (
        <Settings tab={route[1] as SettingsTab} status={status.data} onChange={status.reload} />
      ) : (
        <Home status={status.data} services={services.data} campaigns={campaigns.data} />
      )}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
      {palette && <Palette items={items} onClose={() => setPalette(false)} />}
    </Shell>
  );
}
