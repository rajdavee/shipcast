import { useState } from 'react';
import { api, type TrendCard } from '../api.ts';
import { go, toast, useLoad } from '../hooks.ts';
import { FORMATS } from '../formats.ts';
import { PREFILL_KEY } from './Home.tsx';

const PLATFORMS = ['all', 'linkedin', 'instagram', 'tiktok', 'youtube', 'x', 'newsletter', 'web'];
const KIND: Record<TrendCard['kind'], string> = { format: 'Format', hook: 'Hook', topic: 'Topic', tactic: 'Tactic', 'platform-change': 'Platform change' };
const ago = (iso?: string | null) => {
  if (!iso) return 'never';
  const h = (Date.now() - Date.parse(iso)) / 3_600_000;
  return h < 1 ? 'just now' : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`;
};
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};

/** What's working in marketing right now, refreshed by the trends agent, each with a recipe to make one. */
export function Trending() {
  const feed = useLoad(() => api.trends(), [], 15000);
  const agents = useLoad(() => api.agents(), [], 10000);
  const [platform, setPlatform] = useState('all');
  const [risingOnly, setRisingOnly] = useState(false);
  const job = agents.data?.jobs.find((j) => j.id === 'trends');
  if (!feed.data) return <main className="page"><p className="muted">Loading…</p></main>;
  const cards = feed.data.cards.filter((c) => (platform === 'all' || c.platform === platform || c.platform === 'any') && (!risingOnly || c.strength === 'rising'));

  function makeOne(c: TrendCard) {
    const notes = [`Make this in the style of a current trend: ${c.title}.`, c.what, c.recipe.angle && `Angle: ${c.recipe.angle}`, c.recipe.hookPattern && `Hook pattern: ${c.recipe.hookPattern}`, c.recipe.structure.length ? `Structure:\n${c.recipe.structure.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : '', 'Follow the pattern, not anyone’s actual post.'].filter(Boolean).join('\n\n');
    try {
      sessionStorage.setItem(PREFILL_KEY, JSON.stringify({ format: c.recipe.pack, notes }));
    } catch {}
    go('#/new');
  }
  async function refresh() {
    await api.refreshTrends();
    await agents.reload();
    toast('Refresh queued — it runs when nothing else is running');
  }

  return (
    <main className="page">
      <div className="page-head" style={{ display: 'flex', gap: 16, alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <h1>Trending</h1>
          <p className="muted">What's working in marketing right now — formats, hooks, topics and platform changes, each with evidence. Refreshed {ago(feed.data.refreshedAt)}{job?.enabled ? `; next ${job.running ? 'running now' : job.waiting ? `waiting (${job.waiting.toLowerCase()})` : 'on schedule'}` : ' (auto-refresh is off)'}.</p>
        </div>
        <button className="btn ghost" disabled={job?.running || job?.runNow} onClick={refresh}>{job?.running ? 'Refreshing…' : job?.runNow ? 'Queued' : 'Refresh now'}</button>
      </div>
      <div className="chips" role="group" aria-label="Platform" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '14px 0' }}>
        {PLATFORMS.map((p) => (
          <button key={p} className={`btn ${platform === p ? 'primary' : 'ghost'}`} onClick={() => setPlatform(p)}>{p === 'all' ? 'All' : p === 'x' ? 'X' : p[0].toUpperCase() + p.slice(1)}</button>
        ))}
        <label className="switch" style={{ marginLeft: 'auto' }}><input type="checkbox" checked={risingOnly} onChange={(e) => setRisingOnly(e.target.checked)} /> Rising only</label>
      </div>
      {!feed.data.cards.length && <p className="muted">No trends yet. The first refresh runs a few minutes after Shipcast starts (outside quiet hours), or press Refresh now.</p>}
      <div className="trend-grid">
        {cards.map((c) => (
          <article className="trend-card" key={c.key}>
            <div className="trend-meta">
              <span className={`tag ${c.strength}`}>{c.strength === 'rising' ? '↑ Rising' : c.strength === 'fading' ? '↓ Fading' : 'Steady'}</span>
              <span>{KIND[c.kind]} · {c.platform === 'any' ? 'All platforms' : c.platform}</span>
              <span className="muted">{c.seen > 1 ? `seen ${c.seen}× since ${new Date(c.firstSeen).toLocaleDateString()}` : 'new'}</span>
            </div>
            <h3>{c.title}</h3>
            <p>{c.what}</p>
            {c.recipe.hookPattern && <p className="hook">“{c.recipe.hookPattern}”</p>}
            <ul className="evidence">
              {c.evidence.slice(0, 3).map((e) => (
                <li key={e.url}><a href={e.url} target="_blank" rel="noreferrer noopener">{host(e.url)}</a>{e.metric ? ` · ${e.metric}` : ''}{e.date ? ` · ${e.date}` : ''}</li>
              ))}
            </ul>
            <div className="trend-foot">
              <span className="muted">as {FORMATS.find((f) => f.id === c.recipe.pack)?.title ?? c.recipe.pack}</span>
              <button className="btn primary" onClick={() => makeOne(c)}>Make one like this</button>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
