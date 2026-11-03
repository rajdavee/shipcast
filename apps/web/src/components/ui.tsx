import type { ReactNode } from 'react';

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
