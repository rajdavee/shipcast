import type { Campaign } from '../api.ts';
import { CampaignCover } from '../components/CampaignCover.tsx';
import { EmptyState, Loading, PageHeader } from '../components/ui.tsx';
import { Nav } from '../components/icons.tsx';
import { useAccess } from '../session.ts';

export function Library({ campaigns }: { campaigns: Campaign[] | null }) {
  const write = useAccess().write;
  return (
    <main className="page">
      <PageHeader title="Library" description="Everything made in this workspace. Files stay on this computer." actions={write && <a className="btn primary" href="#/new">New piece</a>} />
      {!campaigns ? (
        <Loading />
      ) : campaigns.length === 0 ? (
        <EmptyState icon={<Nav.library />} title="Nothing here yet" action={write && <a className="btn primary" href="#/new">Create something</a>}>
          {write ? 'Paste a link on the Create page — your first set takes about ten minutes.' : 'When someone in this workspace makes something, it shows up here.'}

        </EmptyState>
      ) : (
        <div className="covers">{campaigns.map((c) => <CampaignCover key={c.id} campaign={c} />)}</div>
      )}
    </main>
  );
}
