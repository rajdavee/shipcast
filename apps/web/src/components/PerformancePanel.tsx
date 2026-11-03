import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { api, type ChannelPlaybook, type Forecast, type MetricKey, type Performance, type PublishConnections, type Snapshot } from '../api.ts';
import type { ChannelId, ChannelInfo, Post, PostChannel } from '../calendar-model.ts';
import { ageLabel, BUCKET_ADJ, BUCKET_LABEL, bucketOf, draftFeatures, factorsFor, fieldsFor, fmtCount, fmtX, forecastHint, forecastLabel, headlineOf, levelName, liftHeadline, METRIC_KEYS, metricLabel, MIN_POSTS, readForm, SOURCE_LABEL } from '../pulse-model.ts';
import { toast } from '../hooks.ts';
import { Cal } from './icons.tsx';
import { ChannelIcon } from './CalendarBits.tsx';
import { ConfidenceChip, EffectBar, ExperimentTag, ForecastBand, LiftBadge, SnapshotChart } from './PulseBits.tsx';

const sent = (p: Post) => p.channels.filter((c) => c.state === 'sent' || (p.status === 'published' && (c.sentAt || p.at)));
export const wentOut = (p: Post) => sent(p).length > 0;
const H = 3_600_000;

/** Can something read this channel's numbers by itself? (the engine's collectorFor, from what the UI can see) */
function hasCollector(c: PostChannel, conns: PublishConnections | null) {
  if (c.via === 'postiz' && c.remoteId) return true;
  return c.channel === 'youtube' && !!conns?.youtube.connected && !!conns.youtube.stats?.stats && !!(c.remoteId || c.url);
}

/** The drawer's Performance tab: per channel, how it did against your usual, the readings behind it, and ways to add more. */
export function PerformancePanel({ post, channels, conns, addFor, onCreated }: { post: Post; channels: ChannelInfo[]; conns: PublishConnections | null; addFor?: ChannelId; onCreated: (ps: Post[], what: string) => void }) {
  const [data, setData] = useState<{ snapshots: Snapshot[]; performance: Performance[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<ChannelId | null>(addFor ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => api.metrics.post(post.id).then(setData).catch((e) => setError((e as Error).message));
  useEffect(() => void load(), [post.id]);
  const name = (id: ChannelId) => channels.find((c) => c.id === id)?.name ?? id;
  const out = sent(post);
  const collectable = out.some((c) => hasCollector(c, conns));

  async function remove(s: Snapshot) {
    // Optimistic: the row goes at once and comes back if the server says no.
    setData((d) => d && { ...d, snapshots: d.snapshots.filter((x) => x.id !== s.id) });
    try {
      await api.metrics.remove(s.id);
      await load();
      toast('Reading deleted');
    } catch (e) {
      await load();
      toast(`Couldn't delete it: ${(e as Error).message}`);
    }
  }
  async function act(what: string, fn: () => Promise<void>) {
    setBusy(what);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (error) return <div className="banner" role="alert">Couldn't load the numbers: {error}</div>;
  if (!data) return <p className="hint" role="status">Loading numbers…</p>;
  return (
    <div className="perf">
      {out.map((c) => {
        const h = headlineOf(data.performance, post.id, c.channel);
        const snaps = data.snapshots.filter((s) => s.channel === c.channel);
        // The channel's own fields that have numbers, then anything else a reading carried.
        const fields = [...fieldsFor(c.channel), ...METRIC_KEYS.filter((k) => !fieldsFor(c.channel).includes(k))].filter((k) => snaps.some((s) => s[k] !== undefined)).slice(0, 8);
        return (
          <section key={c.channel} className="perf-ch" aria-labelledby={`perf-${c.channel}`}>
            <header className="perf-head">
              <h3 id={`perf-${c.channel}`}><ChannelIcon id={c.channel} />{name(c.channel)}</h3>
              {h && <LiftBadge lift={h.lift} size="lg" />}
            </header>
            {h ? <p className="perf-line">{liftHeadline(h, name(c.channel))}{h.lift !== undefined && <span className="muted"> · source: {SOURCE_LABEL[h.source]}</span>}</p> : <p className="perf-line muted">No numbers yet for {name(c.channel)}.</p>}
            {snaps.length > 0 && <SnapshotChart snaps={snaps} />}
            {snaps.length > 0 && (
              <div className="table-scroll">
                <table className="snap-table">
                  <thead>
                    <tr><th scope="col">Age</th>{fields.map((k) => <th key={k} scope="col">{metricLabel(c.channel, k)}</th>)}<th scope="col">From</th><th><span className="sr-only">Actions</span></th></tr>
                  </thead>
                  <tbody>
                    {snaps.map((s) => (
                      <tr key={s.id}>
                        <th scope="row" className="tnum" title={`${ageLabel(s.ageHours)} after posting`}>{bucketOf(s.ageHours) ? BUCKET_LABEL[bucketOf(s.ageHours)!] : ageLabel(s.ageHours)}</th>
                        {fields.map((k) => <td key={k} className="tnum">{s[k] === undefined ? '—' : k === 'avgViewPct' ? `${s[k]}%` : fmtCount(s[k])}</td>)}
                        <td><span className={`src src-${s.source}`}>{SOURCE_LABEL[s.source]}</span></td>
                        <td><button className="btn ghost icon-btn sm" aria-label={`Delete the ${ageLabel(s.ageHours)} reading`} title="Delete this reading" onClick={() => remove(s)}><Cal.trash /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {adding === c.channel ? (
              <AddNumbers post={post} ch={c} name={name(c.channel)} onCancel={() => setAdding(null)} onSaved={async () => { setAdding(null); await load(); }} />
            ) : (
              <div className="perf-actions">
                <button className="btn sm" onClick={() => setAdding(c.channel)}><Cal.plus />Add numbers</button>
              </div>
            )}
          </section>
        );
      })}
      <div className="perf-foot">
        {collectable && <button className="btn sm" disabled={!!busy} onClick={() => act('collect', async () => toast((await api.metrics.collectNow(post.id)).note))}>{busy === 'collect' ? 'Asking…' : 'Collect now'}</button>}
        <button className="btn sm" disabled={!!busy} onClick={() => act('more', async () => onCreated([await api.metrics.more(post.id)], 'A follow-up idea is in your backlog'))}><Cal.spark />{busy === 'more' ? 'Adding…' : 'Make more like this'}</button>
        <button className="btn sm" disabled={!!busy} onClick={() => act('remix', async () => {
          const ps = await api.metrics.remix(post.id);
          if (!ps.length) return toast('No other channels in your plan to remix it for');
          onCreated(ps, `${ps.length} remix idea${ps.length === 1 ? '' : 's'} in your backlog`);
        })}>{busy === 'remix' ? 'Adding…' : 'Remix for other channels'}</button>
      </div>
    </div>
  );
}

/** Three ways in: type the numbers, drop a screenshot of the stats (read, then confirmed), or the platform's CSV export. */
export function AddNumbers({ post, ch, name, onSaved, onCancel }: { post: Post; ch: PostChannel; name: string; onSaved: () => void; onCancel: () => void }) {
  const [values, setValues] = useState<Partial<Record<MetricKey, string>>>({});
  const [read, setRead] = useState<{ keys: MetricKey[]; seen: { date?: string; title?: string }; dropped: string[] } | null>(null);
  const [reading, setReading] = useState(false);
  const [over, setOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bad, setBad] = useState<MetricKey[]>([]);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  const fields = [...new Set([...fieldsFor(ch.channel), ...(read?.keys ?? [])])];
  const went = ch.sentAt ?? post.at;
  const age = went ? (Date.now() - Date.parse(went)) / H : 0;
  const b = bucketOf(age);

  async function readShot(file: File) {
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) return setError('Drop a PNG, JPEG, WebP or GIF screenshot.');
    setReading(true);
    setError(null);
    try {
      const r = await api.metrics.readScreenshot(file, ch.channel);
      const keys = Object.keys(r.values) as MetricKey[];
      if (!keys.length) throw new Error("Couldn't find any numbers in that screenshot — type them instead.");
      setValues((v) => ({ ...v, ...Object.fromEntries(keys.map((k) => [k, String(r.values[k])])) }));
      setRead({ keys, seen: r.seen, dropped: r.dropped });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReading(false);
    }
  }
  async function importCsv(file: File) {
    setError(null);
    setSaving(true);
    try {
      const r = await api.metrics.importCsv(await file.text(), ch.channel);
      toast(r.saved ? `Imported ${r.saved} reading${r.saved === 1 ? '' : 's'}${r.unmatched.length ? ` · ${r.unmatched.length} row${r.unmatched.length === 1 ? '' : 's'} didn't match a post` : ''}` : 'Nothing in that file matched your posts');
      if (r.saved) onSaved();
      else setError(r.unmatched.slice(0, 3).join(' ') || 'No rows matched.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    const f = readForm(values);
    setBad(f.bad);
    if (f.bad.length) return setError(`Check ${f.bad.map((k) => metricLabel(ch.channel, k)).join(', ')} — numbers like 1240 or 1.2K.`);
    if (!Object.keys(f.values).length) return setError('Type at least one number.');
    setSaving(true);
    setError(null);
    try {
      await api.metrics.add({ post: post.id, channel: ch.channel, source: read ? 'screenshot' : 'manual', ...f.values });
      toast(read ? 'Saved the numbers from your screenshot' : 'Numbers saved');
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f) void (/\.csv$/i.test(f.name) ? importCsv(f) : readShot(f));
  };

  return (
    <form className={`add-nums${over ? ' over' : ''}`} onSubmit={save} onDragOver={(e) => (e.preventDefault(), setOver(true))} onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)} onDrop={onDrop} aria-label={`Add ${name} numbers`}>
      <div className="add-head">
        <b>Add {name} numbers</b>
        <span className="hint">{b ? `Counts as the ${BUCKET_ADJ[b]} reading — the post is ${ageLabel(age)} old.` : `The post is ${ageLabel(age)} old — between comparison ages, so this reading is kept but not compared.`}</span>
      </div>
      {read && (
        <div className="banner info read-note" role="status">
          Read from your screenshot{read.seen.title ? ` of “${read.seen.title.slice(0, 60)}”` : ''}{read.seen.date ? ` (${read.seen.date})` : ''}. Check the highlighted numbers, fix any that are off, then save.
          {read.dropped.length > 0 && <> Left out: {read.dropped.join(', ')}.</>}
        </div>
      )}
      <div className="num-grid">
        {fields.map((k, i) => (
          <label key={k} className={`field num-field${read?.keys.includes(k) ? ' was-read' : ''}${bad.includes(k) ? ' bad' : ''}`}>
            <span><span className="lbl">{metricLabel(ch.channel, k)}</span>{read?.keys.includes(k) && <small className="read-mark" title="Read from your screenshot">read</small>}</span>
            <input ref={i === 0 ? first : undefined} className="input tnum" inputMode="decimal" autoComplete="off" placeholder={k === 'avgViewPct' ? '45%' : '1.2K'} value={values[k] ?? ''} aria-invalid={bad.includes(k) || undefined} onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))} />
          </label>
        ))}
      </div>
      {error && <div className="banner" role="alert">{error}</div>}
      <div className="add-ways">
        <label className={`drop-shot${reading ? ' busy' : ''}`}>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={reading} onChange={(e) => e.target.files?.[0] && readShot(e.target.files[0])} />
          {reading ? <><span className="spinner" aria-hidden="true" />Reading the screenshot…</> : <><Cal.doc />Drop a stats screenshot here, or choose one</>}
        </label>
        <label className="btn sm ghost csv-pick">
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
          Import CSV export
        </label>
      </div>
      <div className="add-foot">
        <span className="hint">Accepts 1,240 · 1.2K · 3M. Leave out what the platform doesn't show.</span>
        <button type="button" className="btn sm ghost" onClick={onCancel}>Cancel</button>
        <button className="btn sm primary" disabled={saving || reading}>{saving ? 'Saving…' : read ? 'Confirm and save' : 'Save numbers'}</button>
      </div>
    </form>
  );
}

/** The drawer's Forecast tab for a post that hasn't gone out: the model's expected range and what drives it. Always labelled a forecast. */
export function ForecastPanel({ post, channels }: { post: Post; channels: ChannelInfo[] }) {
  const [fc, setFc] = useState<{ channel: ChannelId; forecast: Forecast | null }[] | null>(null);
  const [pb, setPb] = useState<ChannelPlaybook[] | null>(null);
  useEffect(() => {
    api.metrics.forecast(post.id).then((r) => setFc(r.forecasts)).catch(() => setFc([]));
  }, [post.id, post.updatedAt]);
  useEffect(() => void api.metrics.playbook().then((p) => setPb(p.channels)).catch(() => setPb([])), []);
  const name = (id: ChannelId) => channels.find((c) => c.id === id)?.name ?? id;
  if (!fc || !pb) return <p className="hint" role="status">Working out the forecast…</p>;
  return (
    <div className="perf">
      {post.experiment && (
        <div className="exp-note"><ExperimentTag reason={post.experiment} /><span>{post.experiment.replace(/^Experiment:\s*/, '')}</span></div>
      )}
      <p className="hint">A forecast from your own history on each channel — not a result. It updates as you change the post (after it saves).</p>
      {post.channels.map((c) => {
        const f = fc.find((x) => x.channel === c.channel)?.forecast;
        const cp = pb.find((x) => x.channel === c.channel);
        const factors = factorsFor(cp?.model, draftFeatures(post, c.channel));
        return (
          <section key={c.channel} className="perf-ch fc" aria-labelledby={`fc-${c.channel}`}>
            <header className="perf-head">
              <h3 id={`fc-${c.channel}`}><ChannelIcon id={c.channel} />{name(c.channel)}</h3>
              <span className="fc-tag">Forecast</span>
              {f && <span className="fc-big" aria-hidden="true">{forecastHint(f)}</span>}
            </header>
            {!f ? (
              <p className="perf-line muted">No forecast yet — {cp?.ready === false || !cp ? `the ${name(c.channel)} playbook needs ${MIN_POSTS} posts with numbers (${cp?.n ?? 0} so far).` : 'no model for this channel yet.'}</p>
            ) : (
              <>
                <p className="perf-line">{forecastLabel(f)}{f.lift < 0.9 ? ' — the weak one of your plan; see what pulls it down.' : ''}</p>
                <ForecastBand f={f} />
                {factors.length > 0 && (
                  <ul className="factors" aria-label="What drives this forecast">
                    {factors.map((e) => (
                      <li key={`${e.feature}:${e.level}`}>
                        <span className="factor-name">{levelName(e.feature, e.level)}</span>
                        <EffectBar e={e} />
                        <b className={`tnum ${e.effect >= 1 ? 'up-text' : 'down-text'}`}>{fmtX(e.effect)}</b>
                        <small className="muted">{e.n} posts</small>
                        <ConfidenceChip c={e.confidence} />
                      </li>
                    ))}
                  </ul>
                )}
                {f.unseen.length > 0 && <p className="hint">New to the model here: {f.unseen.map((k) => levelName(k, draftFeatures(post, c.channel)?.[k] ?? '')).join(', ')} — it adds nothing either way until a few posts like it have numbers.</p>}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
