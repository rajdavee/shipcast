import { useState } from 'react';
import { api, type Lesson } from '../api.ts';
import { toast, useLoad } from '../hooks.ts';
import { FORMATS } from '../formats.ts';

const pct = (r?: { rate: number; runs: number }) => (r && r.runs ? `${Math.round(r.rate * 100)}% of ${r.runs} runs` : '—');
const STATUS: Record<Lesson['status'], string> = { trial: 'On trial', kept: 'Kept — it works', retired: 'Retired — no effect', off: 'Off' };
const formatName = (id: string) => FORMATS.find((f) => f.id === id)?.title ?? id;

/** What Shipcast learned from its own runs, and whether each lesson is paying off. */
export function Learning() {
  const data = useLoad(() => api.lessons(), [], 15000);
  const agents = useLoad(() => api.agents(), [], 10000);
  const [busy, setBusy] = useState(false);
  const job = agents.data?.jobs.find((j) => j.id === 'learn');
  if (!data.data) return <main className="page narrow"><p className="muted">Loading…</p></main>;
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
    <main className="page narrow">
      <h1>Learning</h1>
      <p className="muted">
        Shipcast reads its own quality checks, the creative director's notes, brand-voice slips, eval scores and the changes you ask for. Problems that keep coming back become short lessons for that format. Each lesson is on trial: after {10} more runs it's kept if the problem got rarer, and retired if it didn't.
      </p>
      <div className="srow" style={{ margin: '14px 0 22px' }}>
        <i className={`dot ${job?.running ? 'live' : job?.enabled ? 'ok' : ''}`} />
        <div>
          <h3>{job?.running ? 'Learning now…' : job?.enabled ? 'Learns on its own' : 'Learning is off'}</h3>
          <p className="muted" style={{ fontSize: 13 }}>{job?.lastRun ? `Last run: ${job.lastResult?.summary ?? ''}` : 'Not run yet.'} {job?.waiting ? ` · ${job.waiting}` : ''}</p>
        </div>
        <div className="row-actions">
          <a className="btn ghost" href="#/setup">Schedule</a>
          <button className="btn primary" disabled={busy || job?.running || job?.runNow} onClick={learnNow}>{job?.runNow ? 'Queued' : 'Learn now'}</button>
        </div>
      </div>

      <h2>Lessons</h2>
      {!lessons.length && <p className="muted">No lessons yet. They appear after the first learning run finds a problem that repeats.</p>}
      {byPack.map((p) => (
        <section key={p} style={{ marginBottom: 18 }}>
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

      <h2 style={{ marginTop: 26 }}>What keeps going wrong (last 30 days)</h2>
      {!worst.length && <p className="muted">Nothing yet.</p>}
      <div className="rows">
        {worst.map((w) => (
          <div className="srow" key={w.p}>
            <i className="dot" />
            <div>
              <h3>{formatName(w.p)}</h3>
              <p className="muted" style={{ fontSize: 13 }}>{w.runs} runs · {w.top.map(([c, n]) => `${label(c)} ×${n}`).join(' · ')}</p>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
