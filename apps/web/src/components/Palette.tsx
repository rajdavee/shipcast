import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Campaign } from '../api.ts';
import { go, useFocusTrap } from '../hooks.ts';
import { fuzzy } from '../match.ts';
import { Nav } from './icons.tsx';
import { PLACES } from './Shell.tsx';

export interface Command { id: string; group: 'Actions' | 'Places' | 'Projects'; label: string; hint?: string; keywords?: string; icon: ReactNode; run: () => void }

export function commands(campaigns: Campaign[] | null, extra: Command[] = [], can: { write: boolean; install: boolean } = { write: true, install: true }): Command[] {
  // Viewers can't make or schedule anything, so those actions aren't offered.
  const making: Command[] = !can.write ? [] : [
    { id: 'a-new', group: 'Actions', label: 'New piece', hint: 'Create', keywords: 'make launch post video carousel', icon: <Nav.create />, run: () => go('/new') },
    { id: 'a-plan', group: 'Actions', label: 'Plan my month', hint: 'Calendar', keywords: 'schedule calendar posts', icon: <Nav.calendar />, run: () => go('/calendar/plan') },
    { id: 'a-idea', group: 'Actions', label: 'Add idea', hint: 'Calendar backlog', keywords: 'trend backlog note', icon: <Nav.ideas />, run: () => go('/calendar/idea') },
    { id: 'a-post', group: 'Actions', label: 'New post', hint: 'Calendar', keywords: 'schedule linkedin instagram', icon: <Nav.calendar />, run: () => go('/calendar/new') },
  ];
  const actions: Command[] = [
    ...making,
    { id: 'a-settings', group: 'Actions', label: 'Open settings', hint: 'Settings', keywords: 'setup preferences keys', icon: <Nav.settings />, run: () => go('/settings') },
    ...extra,
  ];
  const places: Command[] = [
    ...PLACES.map((p) => ({ id: `p-${p.id}`, group: 'Places' as const, label: p.label, hint: p.about, keywords: p.keywords, icon: <p.icon />, run: () => go(`/${p.id}`) })),
    { id: 'p-settings', group: 'Places', label: 'Settings', hint: 'Connections, generation, agents, members', icon: <Nav.settings />, run: () => go('/settings') },
    { id: 'p-agents', group: 'Places', label: 'Settings · Background agents', keywords: 'schedule quiet hours', icon: <Nav.settings />, run: () => go('/settings/agents') },
    { id: 'p-members', group: 'Places', label: 'Settings · Members', keywords: 'team invite roles people workspace', icon: <Nav.settings />, run: () => go('/settings/members') },
    ...(can.install ? [{ id: 'p-skills', group: 'Places' as const, label: 'Settings · Skills', keywords: 'skill hub install', icon: <Nav.settings />, run: () => go('/settings/skills') }] : []),
    { id: 'p-gen', group: 'Places', label: 'Settings · Generation', keywords: 'model timeout review budget', icon: <Nav.settings />, run: () => go('/settings/generation') },
  ];
  const projects: Command[] = [...(campaigns ?? [])]
    .sort((a, b) => Date.parse(b.updatedAt ?? b.createdAt) - Date.parse(a.updatedAt ?? a.createdAt))
    .map((c) => ({ id: `c-${c.id}`, group: 'Projects', label: c.name, hint: c.source.type === 'text' ? 'From a description' : c.source.value.replace(/^https?:\/\//, ''), icon: <Nav.project />, run: () => go(`/c/${c.id}`) }));
  return [...actions, ...places, ...projects];
}

const GROUPS = ['Actions', 'Places', 'Projects'] as const;

export function Palette({ items, onClose }: { items: Command[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useFocusTrap(box, true);

  const results = useMemo(() => {
    if (!q.trim()) return GROUPS.flatMap((g) => items.filter((i) => i.group === g).slice(0, g === 'Projects' ? 6 : 8));
    return items
      .map((i) => ({ i, s: Math.max(fuzzy(q, i.label) ?? -Infinity, (fuzzy(q, `${i.label} ${i.keywords ?? ''} ${i.hint ?? ''}`) ?? -Infinity) - 4) }))
      .filter((x) => x.s > -Infinity)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map((x) => x.i);
  }, [q, items]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const run = (c?: Command) => {
    if (!c) return;
    onClose();
    c.run();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault();
      setActive((a) => (a + 1) % Math.max(results.length, 1));
    } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault();
      setActive((a) => (a - 1 + results.length) % Math.max(results.length, 1));
    } else if (e.key === 'Home') {
      setActive(0);
    } else if (e.key === 'End') {
      setActive(results.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(results[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  // Grouped only while browsing; a typed query is one ranked list.
  let last = '';
  return (
    <div className="palette-wrap" onKeyDown={onKey}>
      <div className="scrim" onClick={onClose} />
      <div className="palette" ref={box} role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-input">
          <Nav.search />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search Shipcast…"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={results[active] ? `pal-${results[active].id}` : undefined}
            aria-autocomplete="list"
            spellCheck={false}
          />
          <kbd>esc</kbd>
        </div>
        <ul className="palette-list" id="palette-list" role="listbox" ref={list} aria-label="Results">
          {results.map((c, n) => {
            const head = !q.trim() && c.group !== last ? (last = c.group) : null;
            return (
              <li key={c.id} role="presentation">
                {head && <div className="palette-group" aria-hidden="true">{head}</div>}
                <div id={`pal-${c.id}`} role="option" aria-selected={n === active} className="palette-item" onMouseMove={() => n !== active && setActive(n)} onClick={() => run(c)}>
                  <span className="palette-icon">{c.icon}</span>
                  <span className="palette-label">{c.label}</span>
                  {c.hint && <span className="palette-hint">{c.hint}</span>}
                  {n === active && <span className="palette-enter" aria-hidden="true"><Nav.enter /></span>}
                </div>
              </li>
            );
          })}
          {!results.length && <li className="palette-none" role="presentation">Nothing matches “{q}”.</li>}
        </ul>
        <footer className="palette-foot" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </footer>
      </div>
    </div>
  );
}
