import { useEffect, useMemo, useState } from 'react';
import { api, type Campaign } from '../api.ts';
import { addDays, addMonths, cadenceCount, CHANNEL_ORDER, DAY_NAMES, rebalance, todayIn, type ChannelId, type ChannelInfo, type ContentPlan, type Post } from '../calendar-model.ts';
import { toast } from '../hooks.ts';
import { Dialog } from './ui.tsx';
import { ChannelIcon } from './CalendarBits.tsx';
import { Cal } from './icons.tsx';

const longDate = (d: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' });
const monthName = (d: string) => longDate(d, { month: 'long', year: 'numeric' });

/** Projects with research done, newest first — the planner reads the brief of one of these. */
export const plannable = (campaigns: Campaign[] | null) => [...(campaigns ?? [])].filter((c) => c.steps.some((s) => s.kind === 'brief' && s.status === 'done')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export function cadenceLine(plan: ContentPlan, channels: ChannelInfo[], from: string, to: string, taken: Post[] = []) {
  const counts = cadenceCount(plan, from, to, taken);
  const total = counts.reduce((a, c) => a + c.posts, 0);
  return { total, counts, text: `${total} post${total === 1 ? '' : 's'}: ${counts.map((c) => `${channels.find((x) => x.id === c.channel)?.name ?? c.channel} ×${c.perWeek}/wk`).join(', ') || 'no channels in your cadence yet'}` };
}

export interface PlanRun { from: string; to: string; project?: string; started: number }

export function PlanMonthDialog({ plan, channels, campaigns, posts, running, onRun, onClose, onSettings }: {
  plan: ContentPlan;
  posts: Post[];
  channels: ChannelInfo[];
  campaigns: Campaign[] | null;
  running: PlanRun | null;
  onRun: (r: { from: string; to: string; project?: string }) => void;
  onClose: () => void;
  onSettings: () => void;
}) {
  const today = todayIn(plan.tz);
  const presets = useMemo(() => {
    const next = addMonths(today, 1);
    return [
      { id: 'next4', label: 'Next 4 weeks', from: addDays(today, 1), to: addDays(today, 29) },
      { id: 'this', label: `Rest of ${monthName(today).split(' ')[0]}`, from: addDays(today, 1), to: addMonths(today, 1) },
      { id: 'next', label: monthName(next), from: next, to: addMonths(next, 1) },
    ];
  }, [today]);
  const [preset, setPreset] = useState('next4');
  const [range, setRange] = useState({ from: presets[0].from, to: presets[0].to });
  const projects = plannable(campaigns);
  const [project, setProject] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [running]);
  const line = cadenceLine(plan, channels, range.from, range.to, posts);
  const elapsed = running ? Math.floor((Date.now() - running.started) / 1000) : 0;
  void tick;

  if (running) {
    return (
      <Dialog title="Planning your month" onClose={onClose} size="sm" foot={<button className="btn" onClick={onClose}>Keep working — I'll wait</button>}>
        <div className="plan-progress" role="status" aria-live="polite">
          <span className="spinner big" aria-hidden="true" />
          <b>{elapsed < 15 ? 'Reading your brief and brand voice…' : elapsed < 35 ? "Checking what's trending…" : `Writing ${line.total || ''} ideas across your pillars…`}</b>
          <p className="hint">One Claude call fills every slot; it usually takes one to three minutes. You can close this — the drafts land on the calendar when they're ready.</p>
          <p className="tnum muted">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</p>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      title="Plan my month"
      onClose={onClose}
      foot={
        <>
          <button className="btn ghost" onClick={onSettings}>Edit plan settings</button>
          <button className="btn primary" disabled={!line.total || range.to <= range.from} onClick={() => onRun({ ...range, project: project || undefined })}><Cal.spark />{line.total ? `Plan ${line.total} post${line.total === 1 ? '' : 's'}` : 'Nothing to plan'}</button>
        </>
      }
    >
      <p className="dialog-lead">Shipcast lays out your posting slots, then writes one idea per slot — balanced across your pillars, in your brand voice, using what's trending. Everything lands as a draft for you to approve.</p>
      <div className="field">
        <span>When</span>
        <div className="seg" role="radiogroup" aria-label="Range">
          {presets.map((p) => (
            <button key={p.id} role="radio" aria-checked={preset === p.id} aria-pressed={preset === p.id} onClick={() => (setPreset(p.id), setRange({ from: p.from, to: p.to }))}>{p.label}</button>
          ))}
          <button role="radio" aria-checked={preset === 'custom'} aria-pressed={preset === 'custom'} onClick={() => setPreset('custom')}>Custom</button>
        </div>
        {preset === 'custom' ? (
          <div className="range-row">
            <label className="field"><span>From</span><input className="input" type="date" value={range.from} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} /></label>
            <label className="field"><span>Until (inclusive)</span><input className="input" type="date" value={addDays(range.to, -1)} min={range.from} max={addDays(range.from, 41)} onChange={(e) => e.target.value && setRange({ ...range, to: addDays(e.target.value, 1) })} /></label>
          </div>
        ) : (
          <p className="hint">{longDate(range.from, { weekday: 'short', day: 'numeric', month: 'short' })} – {longDate(addDays(range.to, -1), { weekday: 'short', day: 'numeric', month: 'short' })}</p>
        )}
      </div>
      <label className="field">
        <span>About</span>
        {projects.length ? (
          <select className="select" value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">Latest project — {projects[0].name}</option>
            {projects.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        ) : (
          <p className="hint">No project with research yet — ideas will be general. <a href="#/new">Create one first</a> for posts about your product.</p>
        )}
      </label>
      <div className="plan-summary">
        <div>
          <b>{line.text}</b>
          <div className="plan-chips">
            {line.counts.map((c) => <span key={c.channel} className="tag"><ChannelIcon id={c.channel} />{c.posts} on {channels.find((x) => x.id === c.channel)?.name}</span>)}
          </div>
        </div>
        <div>
          <b>Pillars</b>
          <div className="plan-chips">{plan.pillars.map((p) => <span key={p.name} className="tag">{p.name} {p.share}%</span>)}</div>
        </div>
        <p className="hint">Days that already have a post on a channel are skipped. Times are {plan.tz.replace(/_/g, ' ')}.</p>
      </div>
    </Dialog>
  );
}

const ZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone');
  } catch {
    return [];
  }
})();

export function PlanSettingsDialog({ plan, channels, onSaved, onClose }: { plan: ContentPlan; channels: ChannelInfo[]; onSaved: (p: ContentPlan) => void; onClose: () => void }) {
  const [p, setP] = useState<ContentPlan>(() => structuredClone(plan));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newSlot, setNewSlot] = useState<Record<string, { day: string; time: string }>>({});
  const sum = p.pillars.reduce((a, x) => a + x.share, 0);
  const explore = Math.round((p.explore ?? 0.2) * 100);
  const setShare = (i: number, v: number) => {
    const next = rebalance(p.pillars.map((x) => x.share), i, v);
    setP({ ...p, pillars: p.pillars.map((x, j) => ({ ...x, share: next[j] })) });
  };
  const setCad = (id: ChannelId, patch: Partial<{ perWeek: number; slots: string[] }>) => {
    const cur = p.cadence[id] ?? { perWeek: 0, slots: [] };
    setP({ ...p, cadence: { ...p.cadence, [id]: { ...cur, ...patch } } });
  };
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const saved = await api.calendar.savePlan(p);
      onSaved(saved);
      toast('Plan saved');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const sortSlots = (s: string[]) => [...new Set(s)].sort((a, b) => DAY_NAMES.indexOf(a.slice(0, 3) as never) - DAY_NAMES.indexOf(b.slice(0, 3) as never) || a.localeCompare(b));

  return (
    <Dialog title="Content plan" onClose={onClose} size="lg" busy={busy} foot={<><span className={`hint ${sum !== 100 ? 'warn-text' : ''}`}>{sum !== 100 ? `Pillars add up to ${sum}% — make it 100%` : ''}</span><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || sum !== 100} onClick={save}>{busy ? 'Saving…' : 'Save plan'}</button></>}>
      {error && <div className="banner" role="alert">{error}</div>}
      <section className="plan-sec">
        <h3>Time zone</h3>
        <p className="hint">Which day a post falls on and the times you pick are in this zone.</p>
        <select className="select tz-select" value={p.tz} onChange={(e) => setP({ ...p, tz: e.target.value })} aria-label="Time zone">
          {(ZONES.includes(p.tz) ? ZONES : [p.tz, ...ZONES]).map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
        </select>
      </section>
      <section className="plan-sec">
        <h3>Pillars <small className="muted">· {sum}%</small></h3>
        <p className="hint">The themes your posts rotate through. Moving one slider shares the difference among the rest.</p>
        <div className="pillars">
          {p.pillars.map((x, i) => (
            <div key={i} className="pillar-row">
              <input className="input" value={x.name} aria-label={`Pillar ${i + 1} name`} onChange={(e) => setP({ ...p, pillars: p.pillars.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) })} />
              <input type="range" min={0} max={100} value={x.share} aria-label={`${x.name || `Pillar ${i + 1}`} share`} onChange={(e) => setShare(i, Number(e.target.value))} />
              <span className="tnum share">{x.share}%</span>
              <button className="btn ghost icon-btn" aria-label={`Remove ${x.name}`} disabled={p.pillars.length <= 1} onClick={() => {
                const rest = p.pillars.filter((_, j) => j !== i);
                const shares = rebalance([...rest.map((y) => y.share), 0], rest.length, 0);
                setP({ ...p, pillars: rest.map((y, j) => ({ ...y, share: shares[j] })) });
              }}><Cal.trash /></button>
              <input className="input about" value={x.about ?? ''} placeholder="What this pillar covers" aria-label={`${x.name} description`} onChange={(e) => setP({ ...p, pillars: p.pillars.map((y, j) => (j === i ? { ...y, about: e.target.value } : y)) })} />
            </div>
          ))}
        </div>
        {p.pillars.length < 8 && <button className="btn sm" onClick={() => {
          const shares = rebalance([...p.pillars.map((y) => y.share), 0], p.pillars.length, 10);
          setP({ ...p, pillars: [...p.pillars.map((y, j) => ({ ...y, share: shares[j] })), { name: 'New pillar', share: shares[p.pillars.length] }] });
        }}><Cal.plus />Add pillar</button>}
      </section>
      <section className="plan-sec">
        <h3>Experiments</h3>
        <p className="hint" id="explore-hint">Share of planned posts that deliberately try something new — a format or hook with few posts behind it — so the playbook keeps learning. They're marked “Experiment” on the calendar. 0 turns them off.</p>
        <div className="explore-row">
          <input type="range" min={0} max={50} step={5} value={explore} aria-label="Experiments, percent of planned posts" aria-describedby="explore-hint" aria-valuetext={`${explore}% of planned posts`} onChange={(e) => setP({ ...p, explore: Number(e.target.value) / 100 })} />
          <span className="tnum share">{explore}%</span>
        </div>
      </section>
      <section className="plan-sec">
        <h3>Cadence</h3>
        <p className="hint">Posts a week per channel and the slots they prefer. Zero leaves a channel out of the plan.</p>
        <div className="cadence">
          {CHANNEL_ORDER.filter((id) => channels.some((c) => c.id === id)).map((id) => {
            const cad = p.cadence[id] ?? { perWeek: 0, slots: [] };
            const ns = newSlot[id] ?? { day: 'Tue', time: '09:00' };
            return (
              <div key={id} className={`cad-row${cad.perWeek ? '' : ' off'}`}>
                <span className="cad-name"><ChannelIcon id={id} />{channels.find((c) => c.id === id)?.name}</span>
                <label className="cad-n"><input className="input" type="number" min={0} max={21} value={cad.perWeek} aria-label={`${id} posts a week`} onChange={(e) => setCad(id, { perWeek: Math.max(0, Math.min(21, Number(e.target.value) || 0)) })} /><span className="hint">/ week</span></label>
                {cad.perWeek > 0 && (
                  <div className="cad-slots">
                    {cad.slots.map((s) => <span key={s} className="hashtag">{s}<button aria-label={`Remove ${s}`} onClick={() => setCad(id, { slots: cad.slots.filter((x) => x !== s) })}>×</button></span>)}
                    <span className="slot-add">
                      <select className="select" value={ns.day} aria-label="Day" onChange={(e) => setNewSlot({ ...newSlot, [id]: { ...ns, day: e.target.value } })}>{DAY_NAMES.map((d) => <option key={d}>{d}</option>)}</select>
                      <input className="input" type="time" step={900} value={ns.time} aria-label="Time" onChange={(e) => setNewSlot({ ...newSlot, [id]: { ...ns, time: e.target.value } })} />
                      <button className="btn sm" onClick={() => ns.time && setCad(id, { slots: sortSlots([...cad.slots, `${ns.day} ${ns.time}`]) })}>Add slot</button>
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </Dialog>
  );
}

export function SubscribeDialog({ onClose }: { onClose: () => void }) {
  const url = api.calendar.icsUrl();
  return (
    <Dialog title="Subscribe in your calendar app" onClose={onClose} size="sm" foot={<><a className="btn" href="/api/calendar.ics" download="shipcast.ics"><Cal.download />Download .ics</a><button className="btn primary" onClick={() => navigator.clipboard.writeText(url).then(() => toast('Link copied'))}>Copy link</button></>}>
      <p className="dialog-lead">Every dated post shows up in Google Calendar, Apple Calendar or Outlook, and stays in sync as you plan.</p>
      <div className="copy-url"><code>{url}</code></div>
      <ul className="steps-list">
        <li><b>Apple Calendar</b> (this computer): File → New Calendar Subscription, paste the link — or <a href={url.replace(/^https?:/, 'webcal:')}>open it directly</a>.</li>
        <li><b>Google Calendar</b>: Other calendars → + → From URL. Google fetches the link from the internet, so it only works if Shipcast is reachable from outside (for example through a tunnel). Otherwise download the .ics and import it.</li>
      </ul>
    </Dialog>
  );
}

export function ImportDialog({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const [csv, setCsv] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; problems: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.calendar.importCsv(csv);
      setResult(r);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Import posts from CSV" onClose={onClose} size="sm" busy={busy} foot={result ? <button className="btn primary" onClick={onClose}>Done</button> : <><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!csv.trim() || busy} onClick={go}>{busy ? 'Importing…' : 'Import'}</button></>}>
      {result ? (
        <div className="import-result">
          <b>{result.created} post{result.created === 1 ? '' : 's'} imported.</b>
          {result.problems.length > 0 && <ul className="problems">{result.problems.slice(0, 12).map((p) => <li key={p}>{p}</li>)}</ul>}
        </div>
      ) : (
        <>
          <p className="dialog-lead">Columns (any order): <code>date, time, tz, channels, title, status, pillar, format, caption, hashtags, notes</code> — the same as Export CSV. Rows without a date go to the ideas backlog.</p>
          <label className="file-drop">
            <input type="file" accept=".csv,text/csv" onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setName(f.name);
              setCsv(await f.text());
            }} />
            <span>{name ? `${name} · ${csv.split('\n').filter(Boolean).length - 1} rows` : 'Choose a .csv file'}</span>
          </label>
          {error && <div className="banner" role="alert">{error}</div>}
        </>
      )}
    </Dialog>
  );
}
