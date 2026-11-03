import { EmptyState, PageHeader } from '../components/ui.tsx';
import { Nav } from '../components/icons.tsx';

/** Placeholder until the calendar UI lands (sprint v7, M3); the route and nav entry exist now so links stay stable. */
export function Calendar() {
  return (
    <main className="page">
      <PageHeader title="Calendar" description="Plan every post for every channel in one place — then make it and get it out." />
      <EmptyState
        icon={<Nav.calendar />}
        title="The content calendar is coming"
        action={
          <>
            <a className="btn primary" href="#/new">Create a piece</a>
            <a className="btn" href="#/ideas">Browse ideas</a>
          </>
        }
      >
        Month, week and list views, an ideas backlog, “Plan my month” and publishing to LinkedIn, Instagram and YouTube are on their way. Until then, make pieces in Create and find them in Library.
      </EmptyState>
    </main>
  );
}
