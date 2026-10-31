import type { Campaign } from '../api.ts';
import { CampaignCover } from '../components/CampaignCover.tsx';

export function Library({ campaigns }: { campaigns: Campaign[] | null }) {
  return (
    <main className="page">
      <div className="camp-head">
        <div>
          <h1>Projects</h1>
          <p>Everything you've made. Files live in ~/.shipcast on this computer.</p>
        </div>
        <a className="btn primary" href="#/new">New launch</a>
      </div>
      <div style={{ marginTop: 28 }}>
        {campaigns && campaigns.length === 0 ? (
          <div className="empty">
            <h3>Nothing here yet</h3>
            <p>Paste a link on the Create page — your first set takes about ten minutes.</p>
            <a className="btn primary" href="#/new">Create something</a>
          </div>
        ) : (
          <div className="covers">{campaigns?.map((c) => <CampaignCover key={c.id} campaign={c} />)}</div>
        )}
      </div>
    </main>
  );
}
