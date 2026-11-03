import { useState } from 'react';
import { api, type Lesson } from '../api.ts';
import { toast, useLoad } from '../hooks.ts';
import { formatTitle } from '../formats.ts';
import { EmptyState, Loading } from '../components/ui.tsx';
import { Nav } from '../components/icons.tsx';

const pct = (r?: { rate: number; runs: number }) => (r && r.runs ? `${Math.round(r.rate * 100)}% of ${r.runs} runs` : '—');
const STATUS: Record<Lesson['status'], string> = { trial: 'On trial', kept: 'Kept — it works', retired: 'Retired — no effect', off: 'Off' };
const formatName = formatTitle;

/** Insights → Quality & learning: what Shipcast learned from its own runs, and whether each lesson is paying off. */
export function Learning() {
  const data = useLoad(() => api.lessons(), [], 15000);
  const agents = useLoad(() => api.agents(), [], 10000);
  const [busy, setBusy] = useState(false);
  const quality = useLoad(() => api.quality(), [], 30000);
  const job = agents.data?.jobs.find((j) => j.id === 'learn');
  const golden = agents.data?.jobs.find((j) => j.id === 'golden');
  if (!data.data) return <Loading />;
  const { lessons, packs, categories } = data.data;
  const label = (c: string) => categories.find((x) => x.id === c)?.label ?? c;
  const byPack = [...new Set(lessons.map((l) => l.pack))];
  const worst = Object.entries(packs)
    .map(([p, v]) => ({ p, runs: v.runs, top: Object.entries(v.categories).sort((a, b) => b[1] - a[1]).slice(0, 3) }))
    .filter((x) => x.top.length)
    .sort((a, b) => b.top[0][1] - a.top[0][1])
    .slice(0, 8);

  async function toggle(l: Lesson) {
    await api.setLesson(l.id, l.status === 'off' ? 'trial' : 'off');
    await data.reload();
    toast(l.status === 'off' ? 'Lesson back on trial' : 'Lesson switched off');
  }
  async function learnNow() {
    setBusy(true);
    try {
      await api.runAgent('learn');
      await agents.reload();
      toast('Queued — it runs when nothing else is running');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="learning">
      <p className="intro">
        Shipcast reads its own quality checks, the creative director's notes, brand-voice slips, eval scores and the changes you ask for. Problems that keep coming back become short lessons for that format. Each lesson is on trial: after {10} more runs it's kept if the problem got rarer, and retired if it didn't.
      </p>
      <div className="rows">
        <div className="srow">
          <i className={`dot ${job?.running ? 'live' : job?.enabled ? 'ok' : ''}`} />
          <div>
            <h3>{job?.running ? 'Learning now…' : job?.enabled ? 'Learns on its own' : 'Learning is off'}</h3>
            <p className="muted" style={{ fontSize: 13 }}>{job?.lastRun ? `Last run: ${job.lastResult?.summary ?? ''}` : 'Not run yet.'} {job?.waiting ? ` · ${job.waiting}` : ''}</p>
          </div>
          <div className="row-actions">
            <a className="btn ghost" href="#/settings/agents">Schedule</a>
            <button className="btn primary" disabled={busy || job?.running || job?.runNow} onClick={learnNow}>{job?.runNow ? 'Queued' : 'Learn now'}</button>
          </div>
        </div>
      </div>

      <section className="setup-section">
        <h2>Quality over time</h2>
        <p>
          Scores out of 5 from the creative-director critic (eval runs and the nightly quality check{golden?.enabled ? '' : ' — off; switch it on in Settings → Background agents'}).
        </p>
        {quality.data && !Object.keys(quality.data.formats).length && <EmptyState compact icon={<Nav.insights />} title="No scores yet">Scores appear after an eval run or the nightly quality check.</EmptyState>}
        <div className="rows">
          {Object.entries(quality.data?.formats ?? {})
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([p, xs]) => {
              const last = xs.at(-1)!;
              const prev = xs.at(-2);
              const d = prev ? +(last.avg - prev.avg).toFixed(2) : 0;
              return (
                <div className="srow" key={p}>
                  <i className={`dot ${last.avg >= 4 ? 'ok' : last.avg < 3 ? 'bad' : ''}`} />
                  <div>
                    <h3>{formatName(p)} · {last.avg.toFixed(2)}{prev ? <span className="muted" style={{ fontSize: 13 }}> {d > 0 ? `▲ ${d}` : d < 0 ? `▼ ${-d}` : '='}</span> : null}</h3>
                    <p className="muted" style={{ fontSize: 13 }}>
                      {xs.slice(-8).map((x) => x.avg.toFixed(1)).join(' → ')} · lowest last time: {last.low} · {new Date(last.at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              );
            })}
        </div>
      </section>

      <section className="setup-section">
        <h2>Lessons</h2>
        <p>Short rules for one format, each on trial until it proves it helps.</p>
        {!lessons.length && <EmptyState compact title="No lessons yet">They appear after the first learning run finds a problem that repeats.</EmptyState>}
        {byPack.map((p) => (
          <section key={p} className="sub-section">
            <h3>{formatName(p)}</h3>
            <div className="rows">
              {lessons.filter((l) => l.pack === p).map((l) => (
                <div className="srow" key={l.id} style={{ opacity: l.status === 'off' || l.status === 'retired' ? 0.6 : 1 }}>
                  <i className={`dot ${l.status === 'kept' ? 'ok' : l.status === 'trial' ? 'live' : ''}`} />
                  <div>
                    <h3 style={{ fontWeight: 600 }}>{l.rule}</h3>
                    <p className="muted" style={{ fontSize: 13 }}>
                      {STATUS[l.status]} · {label(l.category)} · before: {pct(l.baseline)}{l.after?.runs ? ` → since: ${pct(l.after)}` : ''}
                    </p>
                    {l.examples.length > 0 && (
                      <details>
                        <summary className="muted" style={{ fontSize: 13 }}>Why</summary>
                        <ul style={{ fontSize: 13 }}>{l.examples.map((e, i) => <li key={i}>{e}</li>)}</ul>
                      </details>
                    )}
                  </div>
                  <div className="row-actions">
                    {l.status !== 'retired' && <button className="btn ghost" onClick={() => toggle(l)}>{l.status === 'off' ? 'Turn on' : 'Turn off'}</button>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </section>

      <section className="setup-section">
        <h2>What keeps going wrong</h2>
        <p>The most common problems per format over the last 30 days.</p>
        {!worst.length && <EmptyState compact title="Nothing yet">Problems show up here once a few runs have been checked.</EmptyState>}
        <div className="rows">
          {worst.map((w) => (
            <div className="srow" key={w.p}>
              <i className="dot" />
              <div>
                <h3>{formatName(w.p)}</h3>
                <p className="muted" style={{ fontSize: 13 }}>{w.runs} run{w.runs === 1 ? '' : 's'} · {w.top.map(([c, n]) => `${label(c)} ×${n}`).join(' · ')}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
