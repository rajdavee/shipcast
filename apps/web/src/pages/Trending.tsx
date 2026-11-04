import { useState } from 'react';
import { api, type TrendCard } from '../api.ts';
import { go, toast, useLoad } from '../hooks.ts';
import { formatTitle } from '../formats.ts';
import { PREFILL_KEY } from './Home.tsx';
import { EmptyState, Loading, PageHeader } from '../components/ui.tsx';
import { Nav } from '../components/icons.tsx';
import { useAccess } from '../session.ts';

const PLATFORMS = ['all', 'linkedin', 'instagram', 'tiktok', 'youtube', 'x', 'newsletter', 'web'];
const PLATFORM_NAME: Record<string, string> = { all: 'All', linkedin: 'LinkedIn', instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', x: 'X', newsletter: 'Newsletter', web: 'Web', any: 'All platforms' };
const platformName = (p: string) => PLATFORM_NAME[p] ?? p[0].toUpperCase() + p.slice(1);
const formatName = formatTitle;
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
  const write = useAccess().write;
  const feed = useLoad(() => api.trends(), [], 15000);
  const agents = useLoad(() => api.agents(), [], 10000);
  const [platform, setPlatform] = useState('all');
  const [risingOnly, setRisingOnly] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const job = agents.data?.jobs.find((j) => j.id === 'trends');
  if (!feed.data) return <main className="page"><PageHeader title="Ideas" /><Loading /></main>;
  const cards = feed.data.cards.filter((c) => (platform === 'all' || c.platform === platform || c.platform === 'any') && (!risingOnly || c.strength === 'rising'));

  function makeOne(c: TrendCard) {
    const notes = [`Make this in the style of a current trend: ${c.title}.`, c.what, c.recipe.angle && `Angle: ${c.recipe.angle}`, c.recipe.hookPattern && `Hook pattern: ${c.recipe.hookPattern}`, c.recipe.structure.length ? `Structure:\n${c.recipe.structure.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : '', 'Follow the pattern, not anyone’s actual post.'].filter(Boolean).join('\n\n');
    try {
      sessionStorage.setItem(PREFILL_KEY, JSON.stringify({ format: c.recipe.pack, notes }));
    } catch {}
    go('#/new');
  }
  async function addToCalendar(c: TrendCard) {
    setAdding(c.key);
    try {
      await api.calendar.fromTrend(c.key, c.platform);
      toast('Added to your calendar ideas');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setAdding(null);
    }
  }
  async function refresh() {
    await api.refreshTrends();
    await agents.reload();
    toast('Refresh queued — it runs when nothing else is running');
  }

  return (
    <main className="page">
      <PageHeader
        title="Ideas"
        description={<>What's working in marketing right now — formats, hooks, topics and platform changes, each with evidence. Refreshed {ago(feed.data.refreshedAt)}{job?.enabled ? `; next ${job.running ? 'running now' : job.waiting ? `waiting (${job.waiting.toLowerCase()})` : 'on schedule'}` : ' (auto-refresh is off)'}.</>}
        actions={write && <button className="btn" disabled={job?.running || job?.runNow} onClick={refresh}>{job?.running ? 'Refreshing…' : job?.runNow ? 'Queued' : 'Refresh now'}</button>}
      />
      <div className="filter-bar">
        <div className="seg" role="group" aria-label="Platform">
          {PLATFORMS.map((p) => (
            <button key={p} aria-pressed={platform === p} onClick={() => setPlatform(p)}>{platformName(p)}</button>
          ))}
        </div>
        <label className="switch"><input type="checkbox" checked={risingOnly} onChange={(e) => setRisingOnly(e.target.checked)} /> Rising only</label>
      </div>
      {!feed.data.cards.length ? (
        <EmptyState icon={<Nav.ideas />} title="No trends yet" action={write && <button className="btn primary" disabled={job?.running || job?.runNow} onClick={refresh}>{job?.runNow ? 'Queued' : 'Refresh now'}</button>}>
          The first refresh runs a few minutes after Shipcast starts (outside quiet hours), or press Refresh now.
        </EmptyState>
      ) : !cards.length ? (
        <EmptyState compact title="Nothing matches these filters">Try another platform{risingOnly ? ' or show steady trends too' : ''}.</EmptyState>
      ) : null}
      <div className="trend-grid">
        {cards.map((c) => (
          <article className="trend-card" key={c.key}>
            <div className="trend-meta">
              <span className={`tag ${c.strength}`}>{c.strength === 'rising' ? '↑ Rising' : c.strength === 'fading' ? '↓ Fading' : 'Steady'}</span>
              <span>{KIND[c.kind]} · {platformName(c.platform)}</span>
              <span className="muted">{c.seen > 1 ? `seen ${c.seen}× since ${new Date(c.firstSeen).toLocaleDateString()}` : 'new'}</span>
              {c.fit !== undefined && <FitChip fit={c.fit} why={c.fitWhy} />}
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
              <span className="muted">as {formatName(c.recipe.pack)}</span>
              {write && <span className="trend-actions">
                <button className="btn" disabled={adding === c.key} onClick={() => addToCalendar(c)}>{adding === c.key ? 'Adding…' : 'Add to calendar'}</button>
                <button className="btn primary" onClick={() => makeOne(c)}>Make one like this</button>
              </span>}

            </div>
          </article>
        ))}
      </div>
    </main>
  );
}

/** How well a trend's recipe matches what wins for you, with the playbook's reason on hover or focus. */
function FitChip({ fit, why }: { fit: number; why?: string }) {
  const good = fit >= 1;
  const text = `${good ? 'Fits you' : 'Weak fit'} ×${fit.toFixed(1)}`;
  return (
    <span className={`fit-chip ${good ? 'up' : 'down'}${why ? ' has-tip' : ''}`} tabIndex={why ? 0 : undefined} data-tip={why} aria-label={why ? `${text}: ${why}` : text}>
      {text}
    </span>
  );
}
