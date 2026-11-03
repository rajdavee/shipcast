import { useId } from 'react';
import { audienceOf, bandPos, CONFIDENCE_LABEL, effectBar, engagementOf, fmtCount, fmtX, forecastHint, forecastLabel, heatGrid, heatLevel, HOUR_BUCKETS, HOUR_LABEL, HOUR_RANGE, liftBadge, stepChart, stepPath, WEEKDAYS, type Confidence, type Effect, type Forecast, type HeatCell, type Snapshot } from '../pulse-model.ts';

/** ▲2.1× in green, ▼0.6× in red, — when there's no baseline yet. A real result, never a forecast. */
export function LiftBadge({ lift, size }: { lift?: number; size?: 'sm' | 'lg' }) {
  const b = liftBadge(lift);
  return <span className={`lift lift-${b.tone}${size ? ` ${size}` : ''}`} title={b.label} aria-label={b.tone === 'none' ? 'No baseline yet' : `Result: ${b.label}`}>{b.text}</span>;
}

/** "~1.4×" with a dashed outline: what the model expects, clearly not a result. */
export function ForecastHint({ f }: { f: Pick<Forecast, 'lift' | 'lo' | 'hi'> }) {
  return <span className="fc-hint" title={forecastLabel(f)} aria-label={forecastLabel(f)}>{forecastHint(f)}</span>;
}

export function ExperimentTag({ reason, compact }: { reason: string; compact?: boolean }) {
  return <span className={`exp-tag${compact ? ' compact' : ''}`} title={reason} aria-label={`Experiment: ${reason}`}>{compact ? 'Exp' : 'Experiment'}</span>;
}

export function ConfidenceChip({ c }: { c: Confidence }) {
  return <span className={`conf conf-${c}`}>{CONFIDENCE_LABEL[c]}</span>;
}

/** A diverging bar around "your usual" with the 80 % band as a whisker. */
export function EffectBar({ e }: { e: Pick<Effect, 'effect' | 'lo' | 'hi'> }) {
  const b = effectBar(e);
  return (
    <span className={`fx-bar ${e.effect >= 1 ? 'up' : 'down'}`} aria-hidden="true">
      <i className="fx-mid" />
      <i className="fx-fill" style={{ left: `${b.left}%`, width: `${b.width}%` }} />
      <i className="fx-band" style={{ left: `${b.lo}%`, width: `${Math.max(0.5, b.hi - b.lo)}%` }} />
    </span>
  );
}

/** The forecast band on the same log axis as the effect bars, labelled as a forecast. */
export function ForecastBand({ f }: { f: Pick<Forecast, 'lift' | 'lo' | 'hi'> }) {
  const p = bandPos(f);
  return (
    <div className="fc-band" role="img" aria-label={forecastLabel(f)}>
      <span className="fc-axis"><i className="fx-mid" /><i className="fc-range" style={{ left: `${p.lo}%`, width: `${Math.max(1, p.hi - p.lo)}%` }} /><i className="fc-point" style={{ left: `${p.at}%` }} /></span>
      <span className="fc-ticks" aria-hidden="true"><span>0.25×</span><span>usual</span><span>4×</span></span>
    </div>
  );
}

/** Reach and engagement over the post's age: steps, because each reading replaces the last. */
export function SnapshotChart({ snaps }: { snaps: Snapshot[] }) {
  const id = useId();
  const W = 280, H = 72;
  const maxAge = Math.max(168, ...snaps.map((s) => s.ageHours));
  const aud = stepChart(snaps, audienceOf as never, W, H, maxAge);
  const eng = stepChart(snaps, engagementOf as never, W, H, maxAge);
  if (!aud.length && !eng.length) return null;
  const ticks = [24, 72, 168, 720].filter((t) => t <= maxAge);
  const x = (age: number) => (Math.sqrt(age) / Math.sqrt(maxAge)) * W;
  const last = (pts: typeof aud) => pts[pts.length - 1];
  return (
    <figure className="snap-chart">
      <svg viewBox={`-4 -6 ${W + 8} ${H + 22}`} role="img" aria-labelledby={`${id}-t`}>
        <title id={`${id}-t`}>{`Reach ${aud.length ? fmtCount(last(aud).v) : '—'} and weighted engagement ${eng.length ? fmtCount(last(eng).v) : '—'} at ${Math.round(Math.max(...snaps.map((s) => s.ageHours)))} hours`}</title>
        <line x1={0} x2={W} y1={H} y2={H} className="snap-axis" />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={0} y2={H} className="snap-grid" />
            <text x={x(t)} y={H + 13} className="snap-tick">{t < 168 ? `${t / 24}d` : t === 168 ? '7d' : '30d'}</text>
          </g>
        ))}
        {aud.length > 0 && <path d={stepPath(aud, H)} className="snap-line aud" />}
        {eng.length > 0 && <path d={stepPath(eng, H)} className="snap-line eng" />}
        {aud.map((p) => <circle key={`a${p.age}`} cx={p.x} cy={p.y} r={2.6} className="snap-dot aud" />)}
        {eng.map((p) => <circle key={`e${p.age}`} cx={p.x} cy={p.y} r={2.6} className="snap-dot eng" />)}
      </svg>
      <figcaption><span className="key aud">Reach</span><span className="key eng">Engagement (weighted)</span><span className="muted">· each scaled to its own top</span></figcaption>
    </figure>
  );
}

/** Weekday × time of day, coloured by lift; a real table so it reads with a screen reader. */
export function HeatMap({ cells, onCell }: { cells: HeatCell[]; onCell?: (c: HeatCell) => void }) {
  const grid = heatGrid(cells);
  return (
    <div className="heat-wrap">
      <table className="heat">
        <caption className="sr-only">Lift by weekday and time of day. Each cell: your posts in that slot compared with your usual.</caption>
        <thead>
          <tr>
            <td />
            {HOUR_BUCKETS.map((h) => <th key={h} scope="col"><span>{HOUR_LABEL[h]}</span><small>{HOUR_RANGE[h]}</small></th>)}
          </tr>
        </thead>
        <tbody>
          {WEEKDAYS.map((d, i) => (
            <tr key={d}>
              <th scope="row">{d}</th>
              {grid[i].map((c, j) => {
                if (!c) return <td key={j} className="heat-cell blank" aria-label="No posts" />;
                const l = heatLevel(c.lift);
                const text = `${fmtX(c.lift)}`;
                const label = `${d} ${HOUR_LABEL[c.hour].toLowerCase()}: ${fmtX(c.lift)} your usual over ${c.n} post${c.n === 1 ? '' : 's'}`;
                return (
                  <td key={j} className={`heat-cell t-${l.tone} l-${l.level}${c.n < 2 ? ' thin' : ''}`}>
                    {onCell ? <button onClick={() => onCell(c)} title={label} aria-label={label}><b>{text}</b><small>{c.n}</small></button> : <span title={label}><b>{text}</b><small>{c.n}</small></span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="heat-legend" aria-hidden="true">
        <span className="heat-cell t-down l-4" /><span className="heat-cell t-down l-2" /><span className="heat-cell t-flat l-0" /><span className="heat-cell t-up l-2" /><span className="heat-cell t-up l-4" />
        <span className="muted">below usual → above usual · small number = posts · faded = one post only</span>
      </p>
    </div>
  );
}
