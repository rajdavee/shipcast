import { useEffect, useState } from 'react';
import { api, type ChannelPlaybook, type Performance, type PlaybookFinding } from '../api.ts';
import { CHANNEL_ORDER, type ChannelId, type ContentPlan, type Post } from '../calendar-model.ts';
import { toast, useLoad } from '../hooks.ts';
import { calibrationLine, criticLine, fmtX, heatLevel, leaderboard, levelName, mediaKind, MIN_BASELINE, MIN_POSTS, whySentence } from '../pulse-model.ts';
import { Dialog, EmptyState, Loading } from '../components/ui.tsx';
import { Cal, Nav } from '../components/icons.tsx';
import { ChannelIcon, isImage, mediaUrl } from '../components/CalendarBits.tsx';
import { ConfidenceChip, EffectBar, HeatMap, LiftBadge } from '../components/PulseBits.tsx';

const SAMPLE = /^Sample · /;
const postLink = (id: string) => `#/calendar/post/${id}`;
const ago = (iso: string) => {
  const m = (Date.now() - Date.parse(iso)) / 60_000;
  return m < 2 ? 'just now' : m < 90 ? `${Math.round(m)} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

/** Insights → Performance: what works for this brand on each channel, and why, from its own numbers. */
export function PerformanceInsights() {
  const pb = useLoad(() => api.metrics.playbook());
  const perf = useLoad(() => api.metrics.performance());
  const posts = useLoad(() => api.calendar.posts());
  const cal = useLoad(() => api.metrics.calibration().catch(() => null));
  const slots = useLoad(() => api.metrics.suggestedSlots().catch(() => ({}) as Awaited<ReturnType<typeof api.metrics.suggestedSlots>>));
  const plan = useLoad(() => api.calendar.plan());
  const chans = useLoad(() => api.calendar.channels());
  const [pick, setPick] = useState<ChannelId | null>(null);
  const [refreshing, setRefreshing] = useState<number | null>(null);
  const [, setTick] = useState(0);
  // A once-a-second tick so the elapsed time shows the refresh is alive (it can take a minute).
  useEffect(() => {
    if (refreshing === null) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [refreshing]);

  if (pb.error || perf.error) return <div className="banner" role="alert">Couldn't load performance: {pb.error ?? perf.error}</div>;
  if (!pb.data || !perf.data || !posts.data || !chans.data) return <Loading label="Reading your numbers…" />;
  const name = (id: ChannelId) => chans.data!.find((c) => c.id === id)?.name ?? id;
  const byId = new Map(posts.data.map((p) => [p.id, p]));
  const withNumbers = new Set(perf.data.map((p) => p.post));
  const sample = [...withNumbers].some((id) => SAMPLE.test(byId.get(id)?.title ?? ''));
  const channels = [...new Set([...pb.data.channels.map((c) => c.channel), ...perf.data.map((p) => p.channel)])].sort((a, b) => CHANNEL_ORDER.indexOf(a) - CHANNEL_ORDER.indexOf(b));
  const ch = pick && channels.includes(pick) ? pick : channels[0];
  const cp = pb.data.channels.find((c) => c.channel === ch);

  async function refresh() {
    setRefreshing(Date.now());
    try {
      const fresh = await api.metrics.refreshPlaybook(true);
      pb.setData(fresh);
      await Promise.all([perf.reload(), slots.reload(), cal.reload()]);
      toast('Playbook updated');
    } catch (e) {
      toast(`Couldn't refresh: ${(e as Error).message}`);
    } finally {
      setRefreshing(null);
    }
  }
  const secs = refreshing ? Math.round((Date.now() - refreshing) / 1000) : 0;

  if (!channels.length) {
    return (
      <EmptyState icon={<Nav.insights />} title="No numbers yet" action={<a className="btn primary" href="#/calendar">Open the calendar</a>}>
        Once your posts go out, add how they did: open a published post → Performance → Add numbers (type them, drop a screenshot of the stats, or import the platform's CSV export). Each post is compared with your usual on that channel once {MIN_BASELINE} others have numbers, and the playbook appears at {MIN_POSTS} posts per channel.
      </EmptyState>
    );
  }

  return (
    <div className="pi">
      {sample && <div className="banner info sample-note">This history includes <b>sample posts</b> (titles start “Sample ·”) seeded for demos — their numbers are made up. Delete them from the calendar before relying on the playbook.</div>}
      <div className="pi-bar">
        <div className="seg" role="radiogroup" aria-label="Channel">
          {channels.map((id) => (
            <button key={id} role="radio" aria-checked={id === ch} aria-pressed={id === ch} onClick={() => setPick(id)}><ChannelIcon id={id} />{name(id)}</button>
          ))}
        </div>
        <span className="pi-refresh">
          <span className="hint" role="status">{refreshing ? `Refreshing — fitting the model and writing the why (${secs} s)…` : pb.data.computedAt ? `Playbook updated ${ago(pb.data.computedAt)}` : 'Not computed yet'}</span>
          <button className="btn" disabled={refreshing !== null} onClick={refresh}>{refreshing ? <><span className="spinner" aria-hidden="true" />Refreshing…</> : 'Refresh playbook'}</button>
        </span>
      </div>

      <section className="pi-card pi-playbook" aria-labelledby="pi-pb">
        <header><h2 id="pi-pb">Playbook · {name(ch)}</h2>{cp?.ready && <span className="hint">{cp.n} posts with numbers · effects are × your usual after allowing for everything else about a post</span>}</header>
        {!cp || !cp.ready ? (
          <NotReady cp={cp} n={new Set(perf.data.filter((p) => p.channel === ch && p.lift !== undefined).map((p) => p.post)).size} name={name(ch)} computed={!!pb.data.computedAt} />
        ) : (
          <>
            {cp.narrative?.length ? (
              <div className="pi-why"><b>In plain words</b>{cp.narrative.map((s) => <p key={s}>{s}</p>)}</div>
            ) : null}
            {cp.message && <p className="hint">{cp.message}</p>}
            <div className="pi-findings">
              <Findings title="What wins" list={cp.wins} ch={name(ch)} byId={byId} perf={perf.data} empty="Nothing clearly above your usual yet." />
              <Findings title="What loses" list={cp.losses} ch={name(ch)} byId={byId} perf={perf.data} empty="Nothing clearly below your usual yet." />
            </div>
          </>
        )}
      </section>

      <div className="pi-grid">
        <section className="pi-card" aria-labelledby="pi-heat">
          <header><h2 id="pi-heat">When it lands</h2><span className="hint">Weekday × time of day · {name(ch)} · your time zone</span></header>
          {cp?.heat.length ? <HeatMap cells={cp.heat} onCell={(c) => c.posts[0] && (location.hash = postLink(c.posts[0]))} /> : <p className="hint">No posts with a lift yet on {name(ch)}.</p>}
        </section>
        <BestTimes ch={ch} name={name(ch)} plan={plan.data} suggested={slots.data?.[ch]} onSaved={(p) => plan.setData(p)} />
        <section className="pi-card" aria-labelledby="pi-lb">
          <header><h2 id="pi-lb">Leaderboard · {name(ch)}</h2><span className="hint">By lift at the most settled age</span></header>
          <Leaderboard ch={ch} perf={perf.data} byId={byId} />
        </section>
        <section className="pi-card" aria-labelledby="pi-trust">
          <header><h2 id="pi-trust">How far to trust it</h2></header>
          <Trust cal={cal.data} />
        </section>
      </div>

      <section className="pi-card" aria-labelledby="pi-matrix">
        <header><h2 id="pi-matrix">Format × channel</h2><span className="hint">Each format's effect on each channel, after allowing for day, time and hook</span></header>
        <Matrix channels={pb.data.channels} name={name} />
      </section>
    </div>
  );
}

function NotReady({ cp, n, name, computed }: { cp?: ChannelPlaybook; n: number; name: string; computed: boolean }) {
  const have = cp?.n ?? n;
  return (
    <div className="not-ready">
      <div className="nr-meter" role="img" aria-label={`${have} of ${MIN_POSTS} posts with numbers`}><i style={{ width: `${Math.min(100, (have / MIN_POSTS) * 100)}%` }} /></div>
      <p><b>{have} of {MIN_POSTS} posts</b> on {name} have a lift so far. {cp?.message && !computed ? '' : `The playbook for ${name} appears at ${MIN_POSTS}.`}</p>
      <p className="hint">A post gets a lift once {MIN_BASELINE} other {name} posts have numbers at the same age. Add numbers from a published post's <b>Performance</b> tab — type them, drop a screenshot of its stats, or import the platform's CSV export.{!computed && ' Then press Refresh playbook.'}</p>
    </div>
  );
}

function Findings({ title, list, ch, byId, perf, empty }: { title: string; list: PlaybookFinding[]; ch: string; byId: Map<string, Post>; perf: Performance[]; empty: string }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="findings">
      <h3>{title}</h3>
      {!list.length ? <p className="hint">{empty}</p> : (
        <ul>
          {list.map((f) => {
            const key = `${f.feature}:${f.level}`;
            return (
              <li key={key} className="finding">
                <div className="finding-top">
                  <b className="finding-name">{levelName(f.feature, f.level)}</b>
                  <b className={`tnum finding-x ${f.effect >= 1 ? 'up-text' : 'down-text'}`}>{fmtX(f.effect)}</b>
                  <EffectBar e={f} />
                </div>
                <p className="finding-why">{whySentence(f, ch)}</p>
                <div className="finding-meta">
                  <ConfidenceChip c={f.confidence} />
                  <button className="linkish" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)}>{f.posts.length} post{f.posts.length === 1 ? '' : 's'} behind this</button>
                </div>
                {open === key && (
                  <ul className="finding-posts">
                    {f.posts.map((id) => {
                      const p = byId.get(id);
                      const h = perf.filter((x) => x.post === id && x.lift !== undefined).sort((a, b) => b.ageHours - a.ageHours)[0];
                      return <li key={id}><a href={postLink(id)}>{p?.title ?? 'A deleted post'}</a>{h && <LiftBadge lift={h.lift} />}</li>;
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Leaderboard({ ch, perf, byId }: { ch: ChannelId; perf: Performance[]; byId: Map<string, Post> }) {
  const lb = leaderboard(perf, ch);
  if (!lb.top.length) return <p className="hint">Posts appear here once they have a lift.</p>;
  const row = (h: Performance) => {
    const p = byId.get(h.post);
    const c = p?.channels.find((x) => x.channel === ch);
    const img = c?.media.find(isImage);
    const url = img && mediaUrl(img);
    const kind = c ? mediaKind(c) : 'text-only';
    return (
      <li key={h.post}>
        <a href={postLink(h.post)} className="lb-row">
          {url ? <img className="lb-thumb" src={url} alt="" loading="lazy" /> : <span className={`lb-thumb lb-glyph k-${kind}`} aria-hidden="true">{kind === 'pdf-carousel' ? 'PDF' : kind.startsWith('video') ? '▶' : 'Aa'}</span>}
          <span className="lb-main"><b>{p?.title ?? 'A deleted post'}</b><small className="muted">{p?.at ? new Date(p.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''}{p?.at ? ' · ' : ''}{levelName('mediaKind', kind)}</small></span>
          <LiftBadge lift={h.lift} />
        </a>
      </li>
    );
  };
  return (
    <div className="lb">
      <h3>Top</h3>
      <ol>{lb.top.map(row)}</ol>
      {lb.bottom.length > 0 && <><h3>Bottom</h3><ol>{lb.bottom.map(row)}</ol></>}
    </div>
  );
}

function Trust({ cal }: { cal: Awaited<ReturnType<typeof api.metrics.calibration>> | null }) {
  if (!cal) return <p className="hint">Not available.</p>;
  const line = calibrationLine(cal);
  return (
    <div className="trust">
      <div>
        <h3>Forecasts</h3>
        {line ? (
          <>
            <p className="trust-big">{line}</p>
            <p className="hint">Aim: about 8 in 10 — the range is an 80 % band.{cal.rank !== null && ` Higher forecasts ${cal.rank >= 0.3 ? 'did tend to do better' : 'didn’t reliably do better'} (rank ${cal.rank.toFixed(2)}).`}</p>
          </>
        ) : <p className="hint">None scored yet. Shipcast records a forecast when a post is scheduled and checks it once its numbers are in.</p>}
      </div>
      <div>
        <h3>Critic</h3>
        <p className={cal.critic.rank === null ? 'hint' : 'trust-big'}>{criticLine(cal.critic)}</p>
        {cal.critic.rank !== null && <p className="hint">Does the creative-director score before posting predict lift after? Rank match across posts made in Shipcast.</p>}
      </div>
    </div>
  );
}

function Matrix({ channels, name }: { channels: ChannelPlaybook[]; name: (id: ChannelId) => string }) {
  const cols = channels.filter((c) => c.model).sort((a, b) => CHANNEL_ORDER.indexOf(a.channel) - CHANNEL_ORDER.indexOf(b.channel));
  const kinds = ['pdf-carousel', 'image-carousel', 'single-image', 'video-vertical', 'video-landscape', 'text-only'].filter((k) => cols.some((c) => c.model!.effects.some((e) => e.feature === 'mediaKind' && e.level === k)));
  if (!cols.length || !kinds.length) return <p className="hint">Appears once a channel's playbook is ready and its posts use more than one format.</p>;
  return (
    <div className="table-scroll">
      <table className="matrix">
        <thead><tr><td />{cols.map((c) => <th key={c.channel} scope="col"><ChannelIcon id={c.channel} />{name(c.channel)}</th>)}</tr></thead>
        <tbody>
          {kinds.map((k) => (
            <tr key={k}>
              <th scope="row">{levelName('mediaKind', k)}</th>
              {cols.map((c) => {
                const e = c.model!.effects.find((x) => x.feature === 'mediaKind' && x.level === k);
                if (!e) return <td key={c.channel} className="mx-cell empty">—</td>;
                const l = heatLevel(e.effect);
                return <td key={c.channel} className={`mx-cell heat-cell t-${l.tone} l-${l.level}${e.n < 3 ? ' thin' : ''}`} title={`${levelName('mediaKind', k)} on ${name(c.channel)}: ${fmtX(e.effect)} your usual, ${e.n} posts, ${e.confidence} confidence`}><b>{fmtX(e.effect)}</b><small>{e.n} posts</small></td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "Your best times": the playbook's strongest slots, applied to the plan's cadence after a confirm. */
function BestTimes({ ch, name, plan, suggested, onSaved }: { ch: ChannelId; name: string; plan: ContentPlan | null; suggested?: { slots: string[]; why: string[] }; onSaved: (p: ContentPlan) => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const cur = plan?.cadence[ch];
  const same = !!suggested && !!cur && suggested.slots.length === cur.slots.length && suggested.slots.every((s) => cur.slots.includes(s));
  async function apply() {
    if (!plan || !suggested) return;
    setBusy(true);
    try {
      const perWeek = Math.max(cur?.perWeek ?? 0, cur?.perWeek ? 0 : suggested.slots.length);
      onSaved(await api.calendar.savePlan({ cadence: { ...plan.cadence, [ch]: { perWeek, slots: suggested.slots } } }));
      toast(`${name} now posts ${suggested.slots.join(', ')}`);
      setConfirm(false);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="pi-card" aria-labelledby="pi-best">
      <header><h2 id="pi-best">Your best times · {name}</h2></header>
      {!suggested ? (
        <p className="hint">No slot stands out yet — a slot needs at least 2 posts doing better than your usual.</p>
      ) : (
        <>
          <ul className="best-times">
            {suggested.slots.map((s, i) => <li key={s}><b className="tnum">{s}</b><span className="hint">{suggested.why[i]}</span></li>)}
          </ul>
          <div className="best-foot">
            <span className="hint">{cur?.slots.length ? `Your plan now: ${cur.slots.join(', ')}` : `${name} has no slots in your plan yet.`}</span>
            <button className="btn primary" disabled={same || !plan} onClick={() => setConfirm(true)}><Cal.clock />{same ? 'Already in your plan' : 'Use these slots'}</button>
          </div>
        </>
      )}
      {confirm && suggested && (
        <Dialog title={`Use these slots for ${name}?`} size="sm" busy={busy} onClose={() => setConfirm(false)} foot={<><button className="btn" onClick={() => setConfirm(false)}>Cancel</button><button className="btn primary" data-autofocus disabled={busy} onClick={apply}>{busy ? 'Saving…' : 'Use these slots'}</button></>}>
          <p className="dialog-lead">Plan my month and new posts will prefer these times. Posts already on the calendar don't move.</p>
          <dl className="slot-diff">
            <dt>Now</dt><dd>{cur?.slots.length ? cur.slots.join(', ') : 'No slots'}</dd>
            <dt>Suggested</dt><dd><b>{suggested.slots.join(', ')}</b></dd>
          </dl>
        </Dialog>
      )}
    </section>
  );
}

