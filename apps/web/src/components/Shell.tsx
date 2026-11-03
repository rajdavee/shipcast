import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useFocusTrap, useStoredFlag, useTheme, type ThemePref } from '../hooks.ts';
import { Mark, Nav } from './icons.tsx';

export const PLACES = [
  { id: 'new', label: 'Create', icon: Nav.create, about: 'Make posts, videos and carousels', keywords: 'new home make' },
  { id: 'calendar', label: 'Calendar', icon: Nav.calendar, about: 'Plan what goes out when', keywords: 'schedule plan' },
  { id: 'library', label: 'Library', icon: Nav.library, about: 'Everything you have made', keywords: 'projects campaigns' },
  { id: 'ideas', label: 'Ideas', icon: Nav.ideas, about: "What's working in marketing now", keywords: 'trending trends' },
  { id: 'brand', label: 'Brand', icon: Nav.brand, about: 'How your brand sounds', keywords: 'voice tone' },
  { id: 'insights', label: 'Insights', icon: Nav.insights, about: 'How posts did, what works for you and why', keywords: 'performance playbook numbers learning quality lessons' },
] as const;

const THEMES: { id: ThemePref; label: string; icon: () => ReactNode }[] = [
  { id: 'system', label: 'System', icon: Nav.system },
  { id: 'light', label: 'Light', icon: Nav.sun },
  { id: 'dark', label: 'Dark', icon: Nav.moon },
];

export interface ShellStatus { checked: boolean; ready: boolean; working: boolean }

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl';

function StatusPills({ status }: { status: ShellStatus }) {
  return (
    <div className="side-status">
      {status.working && (
        <a className="pill-status" href="#/library" title="Something is being made">
          <i className="dot live" />
          <span className="lbl">Working</span>
        </a>
      )}
      <a className="pill-status" href="#/settings/connections" title={status.ready ? 'Everything is connected' : 'Finish setup'}>
        <i className={`dot ${status.checked ? (status.ready ? 'ok' : 'bad') : ''}`} />
        <span className="lbl">{!status.checked ? 'Checking…' : status.ready ? 'Connected' : 'Finish setup'}</span>
      </a>
    </div>
  );
}

function ThemeSwitch() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="theme-switch" role="radiogroup" aria-label="Theme">
      {THEMES.map((t) => (
        <button key={t.id} role="radio" aria-checked={theme === t.id} title={`${t.label} theme`} aria-label={`${t.label} theme`} onClick={() => setTheme(t.id)}>
          <t.icon />
        </button>
      ))}
    </div>
  );
}

/** Left sidebar on wide screens (collapsible to icons), a drawer behind a top bar on phones. */
export function Shell({ place, status, onSearch, children }: { place: string; status: ShellStatus; onSearch: () => void; children: ReactNode }) {
  const [collapsed, setCollapsed] = useStoredFlag('shipcast.sidebar.collapsed', false);
  const [drawer, setDrawer] = useState(false);
  const side = useRef<HTMLElement>(null);
  useFocusTrap(side, drawer);
  useEffect(() => setDrawer(false), [place]);
  useEffect(() => {
    if (!drawer) return;
    (side.current?.querySelector<HTMLElement>('.side-link[aria-current="page"]') ?? side.current?.querySelector<HTMLElement>('.side-link'))?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false);
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [drawer]);

  const link = (id: string, label: string, Icon: () => ReactNode) => (
    <a key={id} href={`#/${id}`} className="side-link" aria-current={place === id ? 'page' : undefined} title={collapsed ? label : undefined} onClick={() => setDrawer(false)}>
      <Icon />
      <span className="side-label">{label}</span>
    </a>
  );

  return (
    <div className={`shell${collapsed ? ' collapsed' : ''}${drawer ? ' drawer-open' : ''}`}>
      <header className="mobile-bar">
        <button className="btn ghost icon-btn" aria-label="Open navigation" aria-expanded={drawer} onClick={() => setDrawer(true)}><Nav.menu /></button>
        <a className="logo" href="#/new" aria-label="Shipcast home"><Mark className="" /><span>Shipcast</span></a>
        <div className="mobile-bar-end">
          <StatusPills status={status} />
          <button className="btn ghost icon-btn" aria-label="Search" onClick={onSearch}><Nav.search /></button>
        </div>
      </header>
      {drawer && <div className="scrim drawer-scrim" onClick={() => setDrawer(false)} />}
      <aside className="side" ref={side} aria-label="Sidebar">
        <div className="side-top">
          <a className="logo" href="#/new" aria-label="Shipcast home">
            <Mark className="" />
            <span className="side-label">Shipcast</span>
          </a>
          <button className="btn ghost icon-btn side-collapse" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            <Nav.panel />
          </button>
          <button className="btn ghost icon-btn side-close" onClick={() => setDrawer(false)} aria-label="Close navigation"><Nav.close /></button>
        </div>
        <button className="side-search" onClick={onSearch} title={`Search (${MOD}K)`}>
          <Nav.search />
          <span className="side-label">Search</span>
          <kbd className="side-label">{MOD} K</kbd>
        </button>
        <nav className="side-nav" aria-label="Main">
          {PLACES.map((p) => link(p.id, p.label, p.icon))}
        </nav>
        <div className="side-foot">
          <StatusPills status={status} />
          <ThemeSwitch />
          {link('settings', 'Settings', Nav.settings)}
        </div>
      </aside>
      <div className="main">{children}</div>
    </div>
  );
}
