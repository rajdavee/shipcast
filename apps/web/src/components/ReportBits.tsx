import { useId } from 'react';
import { chartBars, fmtChange, fmtDelta, fmtExact, fmtKpi, goalBar, goalTitle, liftText, sparkPath, splitView, waterfallBars, channelLabel, whyChip, type AskChart, type Facts, type GoalFact, type Kpi, type PostFact } from '../reports-model.ts';
import { ChannelIcon } from './CalendarBits.tsx';

/** "+23%" in green, "−8%" in red, with an arrow and a spoken label. */
export function ChangePill({ change, size }: { change?: number; size?: 'sm' }) {
  const c = fmtChange(change);
  return (
    <span className={`rp-change t-${c.tone}${size ? ` ${size}` : ''}`} title={c.label} aria-label={c.label}>
      {c.arrow && <span aria-hidden="true">{c.arrow}</span>}
      {c.arrow ? c.text.replace(/^[+−]/, '') : c.text}
    </span>
  );
}

/** A small line over the last periods, the latest point marked. */
export function Sparkline({ series, tone = 'none', w = 120, h = 34, label }: { series: number[]; tone?: string; w?: number; h?: number; label?: string }) {
  const id = useId();
  const s = sparkPath(series, w, h);
  if (!s.line) return null;
  return (
    <svg className={`rp-spark t-${tone}`} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <defs>
        <linearGradient id={`${id}-g`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {s.area && <path d={s.area} fill={`url(#${id}-g)`} stroke="none" />}
      <path d={s.line} className="rp-spark-line" vectorEffect="non-scaling-stroke" />
      {s.last && <circle cx={s.last.x} cy={s.last.y} r={2.6} className="rp-spark-dot" />}
    </svg>
  );
}

export function KpiTile({ k }: { k: Kpi }) {
  const c = fmtChange(k.change);
  const prev = k.prev === undefined ? null : `Before: ${fmtKpi(k.prev, k.unit)}`;
  return (
    <div className="rp-kpi">
      <span className="rp-kpi-label">{k.label}</span>
      <b className="rp-kpi-value tnum">{fmtKpi(k.value, k.unit)}</b>
      <span className="rp-kpi-foot">
        <ChangePill change={k.change} />
        {prev && <span className="muted tnum">{prev}</span>}
      </span>
      <Sparkline series={k.series} tone={c.tone} label={`${k.label} over the last ${k.series.length} periods`} />
    </div>
  );
}

/** Change in reach by channel: one shared scale, gains right of the axis and losses left. */
export function Waterfall({ rows }: { rows: Facts['waterfall'] }) {
  const w = waterfallBars(rows);
  if (!w.bars.length) return null;
  return (
    <div className="rp-water" role="table" aria-label="Change in people reached by channel">
      {w.bars.map((b) => (
        <div className="rp-water-row" role="row" key={b.channel}>
          <span className="rp-water-name" role="rowheader"><ChannelIcon id={b.channel} />{b.name || channelLabel(b.channel)}</span>
          <span className="rp-water-track" role="cell" aria-hidden="true">
            <i className="rp-water-axis" style={{ left: `${w.zero}%` }} />
            <i className={`rp-water-bar t-${b.tone}`} style={{ left: `${b.left}%`, width: `${Math.max(b.width, b.delta ? 0.8 : 0)}%` }} />
          </span>
          <span className={`rp-water-val tnum t-${b.tone}`} role="cell">{fmtDelta(b.delta)}</span>
        </div>
      ))}
      <div className="rp-water-row total" role="row">
        <span className="rp-water-name" role="rowheader">Total</span>
        <span className="rp-water-track" role="cell" aria-hidden="true" />
        <span className={`rp-water-val tnum t-${w.total > 0 ? 'up' : w.total < 0 ? 'down' : 'flat'}`} role="cell">{fmtDelta(w.total)}</span>
      </div>
    </div>
  );
}

/** More posts vs more per post: two parts of one bar and the sentence that explains it. */
export function SplitBar({ split }: { split: Facts['split'] }) {
  const v = splitView(split);
  if (!v || !split) return null;
  return (
    <figure className="rp-split">
      <div className="rp-split-bar" aria-hidden="true">
        <i className={`vol ${split.volume < 0 ? 'neg' : ''}`} style={{ width: `${v.volume}%` }} />
        <i className={`qual ${split.quality < 0 ? 'neg' : ''}`} style={{ width: `${v.quality}%` }} />
      </div>
      <div className="rp-split-keys">
        <span><i className="key vol" />Posting {split.volume >= 0 ? 'more' : 'less'} <b className="tnum">{fmtDelta(split.volume)}</b></span>
        <span><i className="key qual" />{split.quality >= 0 ? 'More' : 'Less'} per post <b className="tnum">{fmtDelta(split.quality)}</b></span>
      </div>
      <figcaption>{v.caption}</figcaption>
    </figure>
  );
}

export function TopPost({ p, rank }: { p: PostFact; rank: number }) {
  return (
    <li className="rp-post">
      <span className="rp-post-rank tnum" aria-hidden="true">{rank}</span>
      <div className="rp-post-main">
        <a className="rp-post-title" href={`#/calendar/post/${p.post}`}>{p.title}</a>
        <span className="rp-post-meta">
          <ChannelIcon id={p.channel} />{channelLabel(p.channel)}
          <span aria-hidden="true">·</span>
          {new Date(p.at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
          {p.format && <><span aria-hidden="true">·</span>{p.format}</>}
        </span>
        {p.why.length > 0 && (
          <span className="rp-why" aria-label="Why it worked">
            {p.why.slice(0, 4).map((w) => <span key={w} className="rp-why-chip" title={w}>{whyChip(w)}</span>)}
          </span>
        )}
      </div>
      <dl className="rp-post-nums">
        {p.lift !== undefined && <div className="lift-cell"><dt>Compared with usual</dt><dd className={p.lift >= 1 ? 'up-text' : 'down-text'}>{liftText(p.lift)}</dd></div>}
        {p.audience !== undefined && <div><dt>Reached</dt><dd className="tnum">{fmtExact(p.audience)}</dd></div>}
        {p.visits !== undefined && <div><dt>Site visits</dt><dd className="tnum">{fmtExact(p.visits)}</dd></div>}
        {p.keyEvents !== undefined && p.keyEvents > 0 && <div><dt>Key events</dt><dd className="tnum">{fmtExact(p.keyEvents)}</dd></div>}
      </dl>
    </li>
  );
}

/** Progress toward a goal, a tick where it should be by now, and the forecast end (labelled as such). */
export function GoalRow({ g }: { g: GoalFact }) {
  const b = goalBar(g);
  const rate = g.metric === 'rate';
  const unit = rate ? 'percent' : undefined;
  return (
    <li className={`rp-goal t-${b.tone}`}>
      <div className="rp-goal-head">
        <b>{g.label || goalTitle(g)}</b>
        <span className={`rp-goal-state t-${b.tone}`}>{b.text}</span>
      </div>
      <div className="rp-goal-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(b.pct)} aria-label={`${g.label}: ${fmtKpi(g.actual, unit)} of ${fmtKpi(g.target, unit)}`}>
        <i className="fill" style={{ width: `${b.pct}%` }} />
        {b.projected !== undefined && !rate && b.projected > b.pct && <i className="proj" style={{ left: `${b.pct}%`, width: `${b.projected - b.pct}%` }} />}
        {!rate && <i className="pace" style={{ left: `${b.pace}%` }} title="Where you'd be at an even pace" />}
      </div>
      <div className="rp-goal-foot">
        <span className="tnum"><b>{fmtKpi(g.actual, unit)}</b> of {fmtKpi(g.target, unit)} · {g.window.label}</span>
        {g.projected !== undefined && !g.done && !rate && <span className="tnum muted">Forecast: about {fmtKpi(g.projected, unit)} by the end</span>}
        {g.needPerWeek !== undefined && g.onTrack === false && <span className="tnum">Needs {fmtExact(g.needPerWeek)} a week from here</span>}
      </div>
    </li>
  );
}

/** The small chart that can come with an answer: bars, or a line for one long series. */
export function AskChartView({ chart }: { chart: AskChart }) {
  if (!chart.labels.length || !chart.series.length) return null;
  if (chart.series.length === 1 && chart.labels.length > 6) {
    const s = chart.series[0];
    const w = 320, h = 90;
    const sp = sparkPath(s.values, w, h, 6);
    return (
      <figure className="rp-ask-chart">
        <figcaption>{chart.title}</figcaption>
        <svg viewBox={`0 0 ${w} ${h}`} className="rp-ask-line" role="img" aria-label={`${chart.title}: ${chart.labels.map((l, i) => `${l} ${fmtExact(s.values[i])}`).join(', ')}`}>
          <path d={sp.area} className="area" />
          <path d={sp.line} className="line" />
        </svg>
        <div className="rp-ask-axis"><span>{chart.labels[0]}</span><span>{chart.labels[chart.labels.length - 1]}</span></div>
      </figure>
    );
  }
  const rows = chartBars(chart);
  return (
    <figure className="rp-ask-chart">
      <figcaption>{chart.title}</figcaption>
      {chart.series.length > 1 && <div className="rp-ask-keys">{chart.series.map((s, i) => <span key={s.name}><i className={`key s${i % 3}`} />{s.name}</span>)}</div>}
      <div className="rp-ask-bars">
        {rows.map((r) => (
          <div key={r.label} className="rp-ask-row">
            <span className="rp-ask-label">{r.label}</span>
            <span className="rp-ask-vals">
              {r.values.map((v, i) => (
                <span key={v.name} className="rp-ask-bar-wrap">
                  <i className={`rp-ask-bar s${i % 3}${v.value < 0 ? ' neg' : ''}`} style={{ width: `${Math.max(v.pct, 0.8)}%` }} />
                  <b className="tnum">{fmtExact(v.value)}</b>
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </figure>
  );
}
