import type { Campaign } from '../api.ts';

const SOURCE: Record<string, string> = { url: 'Website', github: 'GitHub', local: 'Folder', text: 'Brief' };

export function Campaigns({ campaigns }: { campaigns: Campaign[] | null }) {
  return (
    <div style={{ maxWidth: 960 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">Campaigns</h1>
          <p className="lede">Everything lives in ~/.shipcast on this machine.</p>
        </div>
        <a className="btn primary" href="#/new">New campaign</a>
      </div>
      {campaigns && campaigns.length === 0 && (
        <div className="empty">
          <h3>No campaigns yet</h3>
          <p>Paste a website or a repo and pick what to make. The first one takes a few minutes.</p>
          <a className="btn primary" href="#/new">Start a campaign</a>
        </div>
      )}
      <div className="list">
        {campaigns?.map((c) => {
          const packs = c.steps.filter((s) => s.kind === 'pack');
          const done = packs.filter((s) => s.status === 'done').length;
          return (
            <a key={c.id} className="row" href={`#/c/${c.id}`}>
              <div>
                <h3>{c.name}</h3>
                <p>
                  {SOURCE[c.source.type]}: {c.source.type === 'text' ? c.source.value.slice(0, 80) + '…' : c.source.value} · {new Date(c.createdAt).toLocaleDateString()}
                </p>
              </div>
              <div className="pips" aria-label={`${done} of ${packs.length} done`}>
                {c.steps.map((s) => (
                  <i key={s.id} className={`status-dot ${s.status}`} title={`${s.pack ?? 'brief'}: ${s.status}`} />
                ))}
                <span className="hint tnum" style={{ marginLeft: 6 }}>{done}/{packs.length}</span>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
