import type { Campaign } from '../api.ts';
import { CampaignCover } from '../components/CampaignCover.tsx';
import { EmptyState, Loading, PageHeader } from '../components/ui.tsx';
import { Nav } from '../components/icons.tsx';

export function Library({ campaigns }: { campaigns: Campaign[] | null }) {
  return (
    <main className="page">
      <PageHeader title="Library" description="Everything you've made. Files live in ~/.shipcast on this computer." actions={<a className="btn primary" href="#/new">New piece</a>} />
      {!campaigns ? (
        <Loading />
      ) : campaigns.length === 0 ? (
        <EmptyState icon={<Nav.library />} title="Nothing here yet" action={<a className="btn primary" href="#/new">Create something</a>}>
          Paste a link on the Create page — your first set takes about ten minutes.
        </EmptyState>
      ) : (
        <div className="covers">{campaigns.map((c) => <CampaignCover key={c.id} campaign={c} />)}</div>
      )}
    </main>
  );
}
