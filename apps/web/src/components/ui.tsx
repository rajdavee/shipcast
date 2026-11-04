import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useEscape, useFocusTrap } from '../hooks.ts';
import { Nav } from './icons.tsx';

/** Every page opens the same way: what this place is, in one line, and the one thing to do here. */
export function PageHeader({ title, description, actions, back, hero }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: { href: string; label: string }; hero?: boolean }) {
  return (
    <header className={`page-head${hero ? ' hero' : ''}`}>
      {back && <a className="back" href={back.href}>← {back.label}</a>}
      <div className="page-head-row">
        <div className="page-head-text">
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className="page-head-actions">{actions}</div>}
      </div>
    </header>
  );
}

export function EmptyState({ icon, title, children, action, compact }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={`empty${compact ? ' compact' : ''}`}>
      {icon && <span className="empty-icon" aria-hidden="true">{icon}</span>}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </p>
  );
}

/** A modal dialog: focus stays inside, Escape or the scrim closes it, focus returns to what opened it. */
export function Dialog({ title, onClose, children, foot, size = 'md', busy }: { title: ReactNode; onClose: () => void; children: ReactNode; foot?: ReactNode; size?: 'sm' | 'md' | 'lg'; busy?: boolean }) {
  const card = useRef<HTMLDivElement>(null);
  useFocusTrap(card, true);
  useEscape(true, () => !busy && onClose());
  useEffect(() => {
    card.current?.querySelector<HTMLElement>('[data-autofocus],.dialog-body input,.dialog-body select,.dialog-body textarea,.dialog-body button')?.focus();
  }, []);
  return (
    <div className="modal dialog-wrap">
      <div className="scrim" onClick={() => !busy && onClose()} />
      <div className={`modal-card dialog ${size}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title" ref={card}>
        <header className="dialog-head">
          <h2 id="dialog-title">{title}</h2>
          <button className="btn ghost icon-btn" aria-label="Close" disabled={busy} onClick={onClose}><Nav.close /></button>
        </header>
        <div className="dialog-body">{children}</div>
        {foot && <footer className="dialog-foot">{foot}</footer>}
      </div>
    </div>
  );
}

/** In place of a control the role can't use: why, in a word. The server enforces it either way. */
export function AskAdmin({ children = 'Ask a workspace admin' }: { children?: ReactNode }) {
  return <span className="ask-admin">{children}</span>;
}

export interface MenuItem { id: string; label: ReactNode; hint?: ReactNode; icon?: ReactNode; current?: boolean; danger?: boolean; run: () => void }

/**
 * A menu that floats out of the sidebar: fixed-positioned from its trigger so the sidebar's
 * overflow can't clip it, opening beside the rail, below a header or above a footer.
 * Arrow keys move, Escape closes and focus goes back to the trigger.
 */
export function PopMenu({ trigger, label, items, up, head }: { trigger: (p: { open: boolean; toggle: () => void; ref: RefObject<HTMLButtonElement | null> }) => ReactNode; label: string; items: (MenuItem | 'sep')[]; up?: boolean; head?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  };
  useEscape(open, () => close());
  const toggle = () => {
    if (open) return close();
    const r = btn.current!.getBoundingClientRect();
    const rail = r.width < 100;
    const width = Math.min(300, innerWidth - 16);
    const left = Math.max(8, Math.min(rail ? r.right + 8 : r.left, innerWidth - width - 8));
    // Both edges are always set: .menu-pop has a default top that would otherwise stretch an upward menu.
    const v = rail ? (up ? { top: 'auto', bottom: innerHeight - r.bottom } : { top: r.top, bottom: 'auto' }) : up ? { top: 'auto', bottom: innerHeight - r.top + 6 } : { top: r.bottom + 6, bottom: 'auto' };
    setPos({ left, width: rail ? width : Math.max(width, r.width), ...v });
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node) && close(false);
    const shut = () => close(false);
    document.addEventListener('mousedown', away);
    addEventListener('resize', shut);
    (pop.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? pop.current?.querySelector<HTMLElement>('[role^="menuitem"]'))?.focus();
    return () => {
      document.removeEventListener('mousedown', away);
      removeEventListener('resize', shut);
    };
  }, [open]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const els = [...(pop.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    const to = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? els.length - 1 : null;
    if (to === null) return void (e.key === 'Tab' && close(false));
    e.preventDefault();
    els[(to + els.length) % els.length]?.focus();
  };
  return (
    <>
      {trigger({ open, toggle, ref: btn })}
      {open && (
        <div className="menu-pop float-menu" role="menu" aria-label={label} ref={pop} style={pos} onKeyDown={onKey}>
          {head}
          {items.map((it, n) =>
            it === 'sep' ? <div key={`sep${n}`} role="separator" className="menu-sep" /> : (
              <button key={it.id} role={it.current !== undefined ? 'menuitemradio' : 'menuitem'} aria-checked={it.current} className={`menu-item${it.danger ? ' danger' : ''}`} onClick={() => (close(), it.run())}>
                {it.icon && <span className="menu-icon" aria-hidden="true">{it.icon}</span>}
                <span className="menu-label">{it.label}</span>
                {it.hint && <span className="menu-hint">{it.hint}</span>}
                {it.current && <span className="menu-check" aria-hidden="true"><Nav.check /></span>}
              </button>
            ),
          )}
        </div>
      )}
    </>
  );
}
