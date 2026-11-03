import { useEffect, useRef, type ReactNode } from 'react';
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
