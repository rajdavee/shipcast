import { useEffect, useState } from 'react';
import { ApiError, api, type Goal, type GoalInput, type Note, type ReportSchedule, type EmailSettings, type RollupItem, type ReportSummary } from '../api.ts';
import { CHANNEL_ORDER, type ChannelId } from '../calendar-model.ts';
import { go, toast, useLoad } from '../hooks.ts';
import { AUDIENCE_CHOICES, KPI_KEYS, METRIC_LABEL, PERIOD_CHOICES, WEBHOOK_LABEL, WEEKDAYS_LONG, ago, audienceLabel, channelLabel, createBody, customRangeProblem, fmtKpi, goalTitle, makingStep, parseEmails, periodLabel, reportGates, rollupOrder, timeSaved, webhookKind, type Audience, type PeriodKind, type WebhookKind } from '../reports-model.ts';
import { askFor } from '../auth-model.ts';
import { switchWorkspace, useAccess, useSession } from '../session.ts';
import { EmptyState, Loading, PageHeader } from '../components/ui.tsx';
import { Cal, Nav } from '../components/icons.tsx';
import { ChangePill } from '../components/ReportBits.tsx';

const notThere = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 405);
type Side = 'goals' | 'notes' | 'delivery';

/** Reports: make a new one, read past ones, and set the goals, notes and delivery they use. */
export function Reports({ startNew }: { startNew?: boolean }) {
  const a = useAccess();
  const can = reportGates(a);
  const list = useLoad(() => api.reports.list());
  const [creating, setCreating] = useState(!!startNew && can.create);
  const [side, setSide] = useState<Side>('goals');
  useEffect(() => {
    if (startNew && can.create) setCreating(true);
  }, [startNew]);
  const hours = (list.data ?? []).reduce((s, r) => s + timeSaved(r.kind), 0);

  return (
    <main className="page reports-page">
      <PageHeader
        title="Reports"
        description="What you shipped, how it did, why, and what to do next — written from your own numbers, ready to forward."
        actions={can.create && !creating ? <button className="btn primary" onClick={() => setCreating(true)}><Nav.plus />New report</button> : undefined}
      />
      <Rollup />
      <div className="rp-home">
        <div className="rp-home-main">
          {creating && <CreateReport onCancel={() => (setCreating(false), startNew && go('/reports'))} />}
          {list.error ? (
            <div className="banner" role="alert">Couldn't load reports: {list.error}</div>
          ) : !list.data ? (
            <Loading label="Loading reports…" />
          ) : !list.data.length ? (
            !creating && (
              <EmptyState icon={<Nav.report />} title="No reports yet" action={can.create ? <button className="btn primary" onClick={() => setCreating(true)}>Make your first report</button> : undefined}>
                A report is a one-page summary of what you shipped, how it did and what to do next, checked against your own numbers.
              </EmptyState>
            )
          ) : (
            <>
              <div className="rp-list-head">
                <h2>Past reports</h2>
                {hours > 0 && <span className="hint" title="Estimated from typical time spent writing reports by hand">About {Math.round(hours)} hours of reporting saved so far (estimate)</span>}
              </div>
              <ul className="rp-cards">
                {list.data.map((r) => <ReportCard key={r.id} r={r} />)}
              </ul>
            </>
          )}
        </div>
        <aside className="rp-home-side" aria-label="Report settings">
          <div className="seg rp-side-tabs" role="tablist" aria-label="Report settings">
            <button role="tab" aria-selected={side === 'goals'} aria-pressed={side === 'goals'} onClick={() => setSide('goals')}>Goals</button>
            <button role="tab" aria-selected={side === 'notes'} aria-pressed={side === 'notes'} onClick={() => setSide('notes')}>Timeline notes</button>
            {can.delivery && <button role="tab" aria-selected={side === 'delivery'} aria-pressed={side === 'delivery'} onClick={() => setSide('delivery')}>Delivery</button>}
          </div>
          <div className="rp-side-panel" role="tabpanel">
            {side === 'goals' ? <Goals /> : side === 'notes' ? <Notes /> : can.delivery ? <Delivery /> : null}
          </div>
          {can.website && (
            <a className="rp-side-link" href="#/settings/website">
              <Nav.globe />
              <span><b>Website numbers</b><small>Connect Google Analytics and Search Console so reports see visits and signups.</small></span>
            </a>
          )}
        </aside>
      </div>
    </main>
  );
}

function ReportCard({ r }: { r: ReportSummary }) {
  return (
    <li>
      <a className="rp-card" href={`#/reports/${r.id}`}>
        <span className="rp-card-top">
          <span className="rp-card-period">{r.period}</span>
          <span className="rp-chips">
            <span className="rp-chip">{audienceLabel(r.audience)}</span>
            {r.status === 'sent' ? <span className="rp-chip ok">Sent{r.sentAt ? ` ${ago(r.sentAt)}` : ''}</span> : r.status === 'draft' ? <span className="rp-chip">Draft</span> : null}
          </span>
        </span>
        <b className="rp-card-title">{r.title}</b>
        <span className="rp-card-headline">{r.headline}</span>
        {r.kpis.length > 0 && (
          <span className="rp-card-kpis">
            {r.kpis.slice(0, 4).map((k) => (
              <span key={k.key} className="rp-kchip">
                <small>{k.label}</small>
                <b className="tnum">{fmtKpi(k.value, k.unit)}</b>
                <ChangePill change={k.change} size="sm" />
              </span>
            ))}
          </span>
        )}
        <span className="rp-card-foot">{periodLabel(r.kind)} · made {ago(r.createdAt)}</span>
      </a>
    </li>
  );
}

function CreateReport({ onCancel }: { onCancel: () => void }) {
  const [kind, setKind] = useState<PeriodKind>('last7');
  const [audience, setAudience] = useState<Audience>('team');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [since, setSince] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (since === null) return;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [since]);
  const problem = kind === 'custom' ? customRangeProblem(start, end) : null;

  async function make() {
    setError(null);
    setSince(Date.now());
    try {
      const r = await api.reports.create(createBody(kind, audience, start, end));
      toast('Report ready');
      go(`/reports/${r.id}`);
    } catch (e) {
      setError((e as Error).message);
      setSince(null);
    }
  }

  if (since !== null) {
    const secs = Math.round((Date.now() - since) / 1000);
    return (
      <section className="rp-create making card" aria-live="polite">
        <span className="spinner big" aria-hidden="true" />
        <b>{makingStep(Date.now() - since)}</b>
        <span className="hint tnum">{secs}s · this can take a minute or two. You can leave this page; the report will be in the list.</span>
      </section>
    );
  }
  return (
    <section className="rp-create card" aria-labelledby="rp-create-h">
      <header>
        <h2 id="rp-create-h">New report</h2>
        <button className="btn ghost icon-btn" aria-label="Close" onClick={onCancel}><Nav.close /></button>
      </header>
      <div className="field">
        <span id="rp-period">Period</span>
        <div className="seg" role="radiogroup" aria-labelledby="rp-period">
          {PERIOD_CHOICES.map((p) => <button key={p.kind} role="radio" aria-checked={kind === p.kind} aria-pressed={kind === p.kind} title={p.hint} onClick={() => setKind(p.kind)}>{p.label}</button>)}
        </div>
      </div>
      {kind === 'custom' && (
        <div className="range-row">
          <label className="field"><span>From</span><input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label className="field"><span>To (including)</span><input className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        </div>
      )}
      <div className="field">
        <span id="rp-aud">Written for</span>
        <div className="rp-aud-pick" role="radiogroup" aria-labelledby="rp-aud">
          {AUDIENCE_CHOICES.map((x) => (
            <button key={x.id} className="chip-opt" role="radio" aria-checked={audience === x.id} aria-pressed={audience === x.id} onClick={() => setAudience(x.id)}>
              <b>{x.label}</b> <span className="muted">{x.hint}</span>
            </button>
          ))}
        </div>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      {kind === 'custom' && problem && (start || end) && <p className="hint">{problem}</p>}
      <footer>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={!!problem} onClick={make}>Make report</button>
      </footer>
    </section>
  );
}

/** For people in several workspaces: each one's latest report on one strip, the ones needing attention first. */
function Rollup() {
  const s = useSession();
  const a = useAccess();
  const many = (s.account?.workspaces.length ?? 0) > 1;
  const r = useLoad(() => (many ? api.reports.rollup().catch((e) => (notThere(e) ? [] : Promise.reject(e))) : Promise.resolve([] as RollupItem[])), [many]);
  if (!many || !r.data?.length) return null;
  const open = async (it: RollupItem) => {
    try {
      if (it.workspace.id !== a.workspace?.id) await switchWorkspace(it.workspace.id, true);
      go(it.report ? `/reports/${it.report.id}` : '/reports');
    } catch (e) {
      toast((e as Error).message);
    }
  };
  return (
    <section className="rp-rollup" aria-label="All your workspaces">
      {rollupOrder(r.data).map((it) => (
        <button key={it.workspace.id} className={`rp-roll${it.needsAttention ? ' attention' : ''}${it.workspace.id === a.workspace?.id ? ' here' : ''}`} onClick={() => open(it)}>
          <span className="rp-roll-top">
            <b>{it.workspace.name}</b>
            {it.needsAttention && <span className="rp-chip warn">Needs attention</span>}
          </span>
          {it.report ? (
            <>
              <span className="rp-roll-headline">{it.report.headline}</span>
              <span className="rp-roll-kpis">
                {it.report.kpis.slice(0, 2).map((k) => <span key={k.key}><small>{k.label}</small> <b className="tnum">{fmtKpi(k.value, k.unit)}</b> <ChangePill change={k.change} size="sm" /></span>)}
              </span>
            </>
          ) : (
            <span className="rp-roll-headline muted">No report yet</span>
          )}
          {it.why && <span className="rp-roll-why">{it.why}</span>}
        </button>
      ))}
    </section>
  );
}

// ── side panels ────────────────────────────────────────────────────────

const blankGoal = (): GoalInput => ({ metric: 'audience', target: 1000, per: 'month' });

function Goals() {
  const a = useAccess();
  const can = reportGates(a);
  const g = useLoad(() => api.reports.goals());
  const [draft, setDraft] = useState<GoalInput[] | null>(null);
  const [busy, setBusy] = useState(false);
  if (g.error) return <p className="hint" role="alert">Couldn't load goals: {g.error}</p>;
  if (!g.data) return <Loading />;
  const rows = draft ?? g.data;
  const set = (i: number, patch: Partial<GoalInput>) => setDraft(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const save = async () => {
    setBusy(true);
    try {
      g.setData(await api.reports.saveGoals(rows.filter((x) => x.target > 0)));
      setDraft(null);
      toast('Goals saved — the next report tracks them');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rp-panel">
      <p className="hint">Targets the report tracks with progress and pace. Up to 8.</p>
      {!rows.length && <p className="rp-panel-empty">No goals yet.{can.edit ? ' Add one, like “2,000 people reached a month on LinkedIn”.' : ''}</p>}
      {!can.edit ? (
        <ul className="rp-goal-list">{(g.data as Goal[]).map((x) => <li key={x.id}>{goalTitle(x)}</li>)}</ul>
      ) : (
        <ul className="rp-goal-edit">
          {rows.map((x, i) => (
            <li key={x.id ?? `new${i}`}>
              <div className="rp-goal-grid">
                <label className="field"><span>Metric</span>
                  <select className="select" value={x.metric} onChange={(e) => set(i, { metric: e.target.value as GoalInput['metric'] })}>
                    {KPI_KEYS.map((k) => <option key={k} value={k}>{METRIC_LABEL[k]}</option>)}
                  </select>
                </label>
                <label className="field"><span>Target{x.metric === 'rate' ? ' (%)' : ''}</span>
                  <input className="input tnum" type="number" min={0} step="any" value={Number.isFinite(x.target) ? x.target : ''} onChange={(e) => set(i, { target: Number(e.target.value) })} />
                </label>
                <label className="field"><span>Per</span>
                  <select className="select" value={x.per} onChange={(e) => set(i, { per: e.target.value as GoalInput['per'] })}>
                    <option value="week">Week</option><option value="month">Month</option><option value="quarter">Quarter</option>
                  </select>
                </label>
                <label className="field"><span>Channel</span>
                  <select className="select" value={x.channel ?? ''} onChange={(e) => set(i, { channel: (e.target.value || undefined) as ChannelId | undefined })}>
                    <option value="">All channels</option>
                    {CHANNEL_ORDER.map((c) => <option key={c} value={c}>{channelLabel(c)}</option>)}
                  </select>
                </label>
              </div>
              <div className="rp-goal-row-foot">
                <span className="hint">{goalTitle(x)}</span>
                <button className="linkish danger" onClick={() => setDraft(rows.filter((_, j) => j !== i))}>Remove</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {can.edit && (
        <div className="rp-panel-actions">
          <button className="btn sm" disabled={rows.length >= 8} onClick={() => setDraft([...rows, blankGoal()])}><Nav.plus />Add goal</button>
          {draft && <button className="btn sm ghost" onClick={() => setDraft(null)}>Discard</button>}
          {draft && <button className="btn sm primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save goals'}</button>}
        </div>
      )}
    </div>
  );
}

const today = () => new Date().toLocaleDateString('en-CA');

function Notes() {
  const can = reportGates(useAccess());
  const n = useLoad(() => api.reports.notes());
  const [date, setDate] = useState(today());
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  if (n.error) return <p className="hint" role="alert">Couldn't load notes: {n.error}</p>;
  if (!n.data) return <Loading />;
  const add = async () => {
    setBusy(true);
    try {
      const note = await api.reports.addNote(date, text.trim());
      n.setData([...(n.data ?? []), note]);
      setText('');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (x: Note) => {
    try {
      await api.reports.removeNote(x.id);
      n.setData((n.data ?? []).filter((y) => y.id !== x.id));
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const sorted = [...n.data].sort((x, y) => y.date.localeCompare(x.date));
  return (
    <div className="rp-panel">
      <p className="hint">Outside events — a launch, a pricing change, a conference week. They show on the report and help explain changes.</p>
      {can.edit && (
        <form className="rp-note-form" onSubmit={(e) => (e.preventDefault(), text.trim() && add())}>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" required />
          <input className="input" value={text} maxLength={200} onChange={(e) => setText(e.target.value)} placeholder="Pricing page launched" aria-label="What happened" />
          <button className="btn primary sm" disabled={busy || !text.trim()}>Add</button>
        </form>
      )}
      {!sorted.length ? (
        <p className="rp-panel-empty">No notes yet.</p>
      ) : (
        <ol className="rp-notes">
          {sorted.map((x) => (
            <li key={x.id}>
              <time dateTime={x.date}>{new Date(`${x.date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</time>
              <span>{x.text}</span>
              {can.edit && <button className="btn ghost icon-btn sm" aria-label={`Delete note: ${x.text}`} onClick={() => remove(x)}><Cal.trash /></button>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

const DEFAULT_SCHEDULE: ReportSchedule = { enabled: false, kind: 'last7', audience: 'boss', weekday: 5, time: '09:00', mode: 'review', emails: [], webhooks: [] };

/** Admins: when the report is made and where it goes. */
function Delivery() {
  const a = useAccess();
  // { v: null } means the server doesn't offer it yet; data null means still loading.
  const sch = useLoad(() => api.reports.schedule().then((v) => ({ v }), (e) => (notThere(e) ? { v: null } : Promise.reject(e))));
  const em = useLoad(() => api.reports.email().then((v) => ({ v }), (e) => (notThere(e) ? { v: null } : Promise.reject(e))));
  const [s, setS] = useState<ReportSchedule | null>(null);
  const [emails, setEmails] = useState('');
  const [hook, setHook] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (sch.data?.v && !s) {
      const v = { ...DEFAULT_SCHEDULE, ...sch.data.v };
      setS(v);
      setEmails(v.emails.join(', '));
    }
  }, [sch.data]);
  if (!a.manage) return <p className="role-note">{askFor(a, 'manage')}</p>;
  if (sch.error) return <p className="hint" role="alert">Couldn't load delivery: {sch.error}</p>;
  if (sch.data && !sch.data.v) return <p className="rp-panel-empty">Scheduled delivery isn't available on this server yet. Update Shipcast to send reports by email, Slack, Teams or Discord.</p>;
  if (!s) return <Loading />;
  const parsed = parseEmails(emails);
  const set = (patch: Partial<ReportSchedule>) => setS({ ...s, ...patch });
  const save = async () => {
    setBusy(true);
    try {
      const saved = await api.reports.saveSchedule({ ...s, emails: parsed.ok });
      setS({ ...DEFAULT_SCHEDULE, ...saved });
      setEmails((saved.emails ?? parsed.ok).join(', '));
      toast(s.enabled ? 'Schedule saved' : 'Saved — delivery is off');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const addHook = () => {
    const url = hook.trim();
    if (!/^https:\/\//.test(url)) return toast('Webhook addresses start with https://');
    set({ webhooks: [...s.webhooks, { kind: webhookKind(url), url }] });
    setHook('');
  };
  return (
    <div className="rp-panel">
      <label className="switch rp-switch-row">
        <input type="checkbox" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        Make a report on a schedule
      </label>
      <div className="rp-goal-grid">
        <label className="field"><span>Period</span>
          <select className="select" value={s.kind} onChange={(e) => set({ kind: e.target.value as PeriodKind })}>
            {PERIOD_CHOICES.filter((p) => p.kind !== 'custom').map((p) => <option key={p.kind} value={p.kind}>{p.label}</option>)}
          </select>
        </label>
        <label className="field"><span>Written for</span>
          <select className="select" value={s.audience} onChange={(e) => set({ audience: e.target.value as Audience })}>
            {AUDIENCE_CHOICES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </label>
        <label className="field"><span>Day</span>
          <select className="select" value={s.weekday} onChange={(e) => set({ weekday: Number(e.target.value) })}>
            {WEEKDAYS_LONG.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        </label>
        <label className="field"><span>Time</span>
          <input className="input" type="time" value={s.time} onChange={(e) => set({ time: e.target.value })} />
        </label>
      </div>
      <div className="field">
        <span id="rp-mode">When it's ready</span>
        <div className="seg" role="radiogroup" aria-labelledby="rp-mode">
          <button role="radio" aria-checked={s.mode === 'review'} aria-pressed={s.mode === 'review'} onClick={() => set({ mode: 'review' })}>Let me review first</button>
          <button role="radio" aria-checked={s.mode === 'auto'} aria-pressed={s.mode === 'auto'} onClick={() => set({ mode: 'auto' })}>Send it straight away</button>
        </div>
        <span className="hint">{s.mode === 'review' ? 'You get a nudge to read it and press Send.' : 'It goes to everyone below as soon as it’s made.'}</span>
      </div>
      <label className="field"><span>Email to</span>
        <textarea className="textarea" rows={2} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="boss@company.com, client@example.com" />
        {parsed.bad.length > 0 && <span className="hint down-text">Not an email address: {parsed.bad.join(', ')}</span>}
      </label>
      <div className="field">
        <span>Post to chat</span>
        {s.webhooks.length > 0 && (
          <ul className="rp-hooks">
            {s.webhooks.map((h, i) => (
              <li key={`${h.url}${i}`}>
                <select className="select" value={h.kind} aria-label="Kind" onChange={(e) => set({ webhooks: s.webhooks.map((x, j) => (j === i ? { ...x, kind: e.target.value as WebhookKind } : x)) })}>
                  {(Object.keys(WEBHOOK_LABEL) as WebhookKind[]).map((k) => <option key={k} value={k}>{WEBHOOK_LABEL[k]}</option>)}
                </select>
                <code title={h.url}>{h.url.replace(/^https:\/\//, '').slice(0, 34)}…</code>
                <button className="btn ghost icon-btn sm" aria-label="Remove webhook" onClick={() => set({ webhooks: s.webhooks.filter((_, j) => j !== i) })}><Cal.trash /></button>
              </li>
            ))}
          </ul>
        )}
        <div className="rp-note-form">
          <input className="input" value={hook} onChange={(e) => setHook(e.target.value)} placeholder="Slack, Teams or Discord webhook URL" aria-label="Webhook URL" onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addHook())} />
          <button className="btn sm" disabled={!hook.trim()} onClick={addHook}>Add</button>
        </div>
      </div>
      <div className="rp-panel-actions">
        <button className="btn sm primary" disabled={busy || parsed.bad.length > 0} onClick={save}>{busy ? 'Saving…' : 'Save delivery'}</button>
      </div>
      <EmailServer em={em.data?.v ?? null} onSaved={(x) => em.setData({ v: x })} />
    </div>
  );
}

function EmailServer({ em, onSaved }: { em: EmailSettings | null; onSaved: (e: EmailSettings) => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Partial<EmailSettings>>({});
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (em) setF({ host: em.host, port: em.port || 587, secure: em.secure, user: em.user, from: em.from });
  }, [em]);
  if (!em) return null;
  const save = async () => {
    setBusy(true);
    try {
      onSaved(await api.reports.saveEmail({ ...f, ...(f.pass ? { pass: f.pass } : {}) }));
      setF((x) => ({ ...x, pass: '' }));
      toast('Email settings saved');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    setBusy(true);
    try {
      await api.reports.testEmail(to.trim());
      toast(`Test email sent to ${to.trim()}`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="rp-email" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary><i className={`dot ${em.configured ? 'ok' : ''}`} /> Email server {em.configured ? <span className="muted">· set up</span> : <span className="muted">· needed for email</span>}</summary>
      <div className="rp-goal-grid">
        <label className="field"><span>SMTP host</span><input className="input" value={f.host ?? ''} onChange={(e) => setF({ ...f, host: e.target.value })} placeholder="smtp.example.com" /></label>
        <label className="field"><span>Port</span><input className="input tnum" type="number" value={f.port ?? 587} onChange={(e) => setF({ ...f, port: Number(e.target.value) })} /></label>
        <label className="field"><span>User</span><input className="input" autoComplete="off" value={f.user ?? ''} onChange={(e) => setF({ ...f, user: e.target.value })} /></label>
        <label className="field"><span>Password</span><input className="input" type="password" autoComplete="new-password" value={f.pass ?? ''} onChange={(e) => setF({ ...f, pass: e.target.value })} placeholder={em.configured ? 'Saved — type to replace' : ''} /></label>
        <label className="field rp-span2"><span>From</span><input className="input" value={f.from ?? ''} onChange={(e) => setF({ ...f, from: e.target.value })} placeholder="Reports <reports@company.com>" /></label>
      </div>
      <label className="switch"><input type="checkbox" checked={!!f.secure} onChange={(e) => setF({ ...f, secure: e.target.checked })} /> Use TLS from the start (port 465). Off uses STARTTLS.</label>
      <div className="rp-panel-actions">
        <button className="btn sm primary" disabled={busy || !f.host} onClick={save}>Save</button>
      </div>
      {em.configured && (
        <div className="rp-note-form">
          <input className="input" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@company.com" aria-label="Send a test email to" />
          <button className="btn sm" disabled={busy || !parseEmails(to).ok.length} onClick={test}>Send test</button>
        </div>
      )}
    </details>
  );
}
