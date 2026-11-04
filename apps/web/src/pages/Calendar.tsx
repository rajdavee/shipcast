import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { api, type Campaign, type Forecast, type PendingNumbers, type Performance, type PublishConnections } from '../api.ts';
import { addDays, bucketByDay, CHANNEL_ORDER, filterPosts, localParts, minutesOf, monthGrid, moveToDay, shiftAnchor, slotTime, snapMinutes, startOfWeek, STATUS_LABEL, STATUSES, timeOf, todayIn, viewRange, weekDates, zonedToUtc, type ChannelId, type ChannelInfo, type ContentPlan, type Post, type PostStatus, type View } from '../calendar-model.ts';
import { toast, useEscape, useLoad, useMedia } from '../hooks.ts';
import { Dialog, EmptyState, Loading, PageHeader } from '../components/ui.tsx';
import { Cal, Nav } from '../components/icons.tsx';
import { channelName, ChannelIcon, StatusPill } from '../components/CalendarBits.tsx';
import { blankChannel, PostDrawer, type DrawerTab } from '../components/PostDrawer.tsx';
import { ExperimentTag, ForecastHint, LiftBadge } from '../components/PulseBits.tsx';
import { BUCKET_ADJ, heatStrength, liftTone, postHeadline } from '../pulse-model.ts';
import { ImportDialog, PlanMonthDialog, PlanSettingsDialog, plannable, SubscribeDialog, type PlanRun } from '../components/CalendarDialogs.tsx';
import { useAccess } from '../session.ts';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_START = 6 * 60;
const DAY_END = 23 * 60;
const HOUR_PX = 44;
const fmtDay = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { ...o, timeZone: 'UTC' });

// What is being dragged: a post id and where on the chip it was grabbed (so week drops land where the chip's top is).
let dragging: { id: string; grabY: number } | null = null;

type DrawerTarget = { post: Post; tab?: DrawerTab; addFor?: ChannelId } | null;
type DialogKind = 'plan' | 'settings' | 'subscribe' | 'import' | 'numbers' | null;
/** What a chip shows about results: the real lift once published, a forecast before. */
interface Pulse { lift: Map<string, Performance>; fc: Map<string, Forecast> }

/** The content calendar: month / week / list, an ideas backlog, and a drawer per post. */
export function Calendar({ sub, arg }: { sub?: string; arg?: string }) {
  const phone = useMedia('(max-width: 699px)');
  const wide = useMedia('(min-width: 1100px)');
  // Viewers see everything but change nothing: no adding, dragging or editing.
  const ro = !useAccess().write;
  const [view, setView] = useState<View>(() => (typeof matchMedia !== 'undefined' && matchMedia('(max-width: 699px)').matches ? 'list' : 'month'));
  const posts = useLoad(() => api.calendar.posts(), [], 20000);
  const channels = useLoad(() => api.calendar.channels());
  const plan = useLoad(() => api.calendar.plan());
  const conns = useLoad(() => api.publish.connections().catch(() => null as PublishConnections | null));
  const campaigns = useLoad(() => api.campaigns());
  const perf = useLoad(() => api.metrics.performance().catch(() => [] as Performance[]), [], 60000);
  const pending = useLoad(() => api.metrics.pending().catch(() => [] as PendingNumbers[]), [], 60000);
  const [forecasts, setForecasts] = useState<Map<string, Forecast>>(new Map());
  const tz = plan.data?.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = todayIn(tz);
  const [anchor, setAnchor] = useState(today);
  const [chFilter, setChFilter] = useState<ChannelId[]>([]);
  const [stFilter, setStFilter] = useState<PostStatus | ''>('');
  const [drawer, setDrawer] = useState<DrawerTarget>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [planning, setPlanning] = useState<PlanRun | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [pane, setPane] = useState<'calendar' | 'ideas'>('calendar');
  const ideaInput = useRef<HTMLInputElement>(null);

  // Deep links from the palette: #/calendar/idea, #/calendar/plan, #/calendar/new
  useEffect(() => {
    if (!sub) return;
    if (ro && ['idea', 'plan', 'new'].includes(sub)) return;
    if (sub === 'idea') {
      setPane('ideas');
      setTimeout(() => ideaInput.current?.focus(), 60);
    } else if (sub === 'plan') setDialog('plan');
    else if (sub === 'new') openNew();
    else if (sub === 'post' && arg) {
      // From Insights: open the post behind a finding, on its numbers.
      if (!posts.data) return;
      const p = posts.data.find((x) => x.id === arg);
      if (p) {
        if (p.at) setAnchor(localParts(p.at, tz).date);
        setDrawer({ post: p, tab: p.status === 'published' ? 'performance' : undefined });
      } else toast('That post is gone');
    }
    location.replace('#/calendar');
  }, [sub, arg, plan.data, !!posts.data]);

  const all = posts.data ?? [];
  const chInfo = channels.data ?? [];
  const shown = filterPosts(all, chFilter, stFilter ? [stFilter] : []);
  const dated = shown.filter((p) => p.at);
  const ideas = all.filter((p) => !p.at && (!chFilter.length || p.channels.some((c) => chFilter.includes(c.channel))));
  const byDay = useMemo(() => bucketByDay(dated, tz), [dated, tz]);
  const defaultChannel = (): ChannelId => chFilter[0] ?? (Object.keys(plan.data?.cadence ?? {}).find((k) => plan.data?.cadence[k as ChannelId]?.perWeek) as ChannelId) ?? 'linkedin';
  const chips = CHANNEL_ORDER.filter((id) => id === 'linkedin' || id === 'instagram' || all.some((p) => p.channels.some((c) => c.channel === id)) || plan.data?.cadence[id]?.perWeek);
  const account = conns.data?.linkedin.account || plannable(campaigns.data)[0]?.name || campaigns.data?.[0]?.name || 'Your name';

  const pulse = useMemo<Pulse>(() => {
    const lift = new Map<string, Performance>();
    for (const p of all)
      if (p.status === 'published') {
        const h = postHeadline(perf.data ?? [], p);
        if (h) lift.set(p.id, h);
      }
    return { lift, fc: forecasts };
  }, [all, perf.data, forecasts]);
  // Forecasts for upcoming posts, once there's a model to ask; refetched when one of them changes.
  const upcoming = all.filter((p) => p.at && p.status !== 'published' && p.status !== 'failed' && Date.parse(p.at) > Date.now() - 86_400_000).sort((a, b) => a.at!.localeCompare(b.at!)).slice(0, 40);
  const fcKey = upcoming.map((p) => `${p.id}@${p.updatedAt}`).join();
  useEffect(() => {
    if (!upcoming.length) return;
    let on = true;
    api.metrics.playbook().then(async (pb) => {
      if (!pb.channels.some((c) => c.ready)) return;
      const out = new Map<string, Forecast>();
      await Promise.all(upcoming.map(async (p) => {
        const f = (await api.metrics.forecast(p.id).catch(() => null))?.forecasts.find((x) => x.forecast)?.forecast;
        if (f) out.set(p.id, f);
      }));
      if (on) setForecasts(out);
    }).catch(() => {});
    return () => void (on = false);
  }, [fcKey]);

  const replace = (p: Post) => posts.setData((list) => (list ? (list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p]) : [p]));
  const drop = (id: string) => posts.setData((list) => list?.filter((x) => x.id !== id) ?? null);

  /** Optimistic move: the chip lands at once; on error it goes back and the reason shows. */
  async function move(id: string, date: string | null, minutes?: number) {
    const p = all.find((x) => x.id === id);
    if (!p || p.status === 'published' || ro) return;
    const at = date === null ? undefined : minutes !== undefined ? zonedToUtc(date, timeOf(minutes), tz) : p.at ? moveToDay(p.at, date, tz) : zonedToUtc(date, slotTime(plan.data, p.channels[0]?.channel, date), tz);
    if (at === p.at) return;
    replace({ ...p, at, status: at && p.status === 'idea' ? 'draft' : !at && ['draft', 'ready', 'scheduled'].includes(p.status) ? 'idea' : p.status });
    try {
      // A scheduled post is re-checked by the server at its new time (a past time is refused).
      replace(await api.calendar.save(id, { at: (at ?? null) as unknown as string, ...(p.status === 'scheduled' && at ? { status: 'scheduled' as const } : {}) }));
      if (!at) toast('Moved back to ideas');
    } catch (e) {
      replace(p);
      toast(`Couldn't move it: ${(e as Error).message}`);
    }
  }
  async function quickAdd(date: string | null, title: string) {
    if (ro) return;
    const ch = defaultChannel();
    try {
      const p = await api.calendar.create({ title, tz, status: date ? 'draft' : 'idea', ...(date ? { at: zonedToUtc(date, slotTime(plan.data, ch, date), tz) } : {}), channels: [blankChannel(ch)] });
      replace(p);
      toast(date ? `Added to ${fmtDay(date, { weekday: 'long', day: 'numeric', month: 'short' })}` : 'Idea added');
    } catch (e) {
      toast((e as Error).message);
    }
  }
  function openNew(date?: string) {
    const ch = defaultChannel();
    const now = new Date().toISOString();
    setDrawer({ post: { id: '', title: '', status: date ? 'draft' : 'idea', tz, notes: '', createdAt: now, updatedAt: now, channels: [blankChannel(ch)], ...(date ? { at: zonedToUtc(date, slotTime(plan.data, ch, date), tz) } : {}) } });
  }
  async function runPlan(r: { from: string; to: string; project?: string }) {
    setPlanning({ ...r, started: Date.now() });
    try {
      const out = await api.calendar.planMonth(r);
      await posts.reload();
      setFresh(new Set(out.created.map((p) => p.id)));
      setAnchor(r.from);
      setDialog((d) => (d === 'plan' ? null : d));
      toast(out.created.length ? `Planned ${out.created.length} drafts${out.skipped ? ` (${out.skipped} slots came back empty)` : ''}` : out.slots ? 'The plan came back empty — try again' : 'Every slot in that range already has a post');
    } catch (e) {
      toast(`Planning failed: ${(e as Error).message}`);
    } finally {
      setPlanning(null);
    }
  }
  useEffect(() => {
    if (!fresh.size) return;
    const t = setTimeout(() => setFresh(new Set()), 12000);
    return () => clearTimeout(t);
  }, [fresh]);

  const range = viewRange(view, anchor);
  const title = view === 'month' ? fmtDay(anchor, { month: 'long', year: 'numeric' }) : `${fmtDay(range.from, { day: 'numeric', month: 'short' })} – ${fmtDay(range.to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const loading = !posts.data || !channels.data || !plan.data;
  const empty = !loading && all.length === 0;
  const open = (p: Post) => setDrawer({ post: p });
  const ctx: ViewCtx = { tz, today, chInfo, fresh, pulse, onOpen: open, onMove: move, onQuickAdd: quickAdd };
  const wanted = pending.data ?? [];
  // New ideas from a winner land highlighted in the backlog, where the user can see them.
  const created = (ps: Post[], what: string) => {
    ps.forEach(replace);
    setFresh(new Set(ps.map((p) => p.id)));
    setDrawer(null);
    if (!wide) setPane('ideas');
    toast(what);
  };

  const backlog = <Backlog ideas={ideas} chInfo={chInfo} fresh={fresh} inputRef={ideaInput} onAdd={(t) => quickAdd(null, t)} onOpen={open} onDropBack={(id) => move(id, null)} />;

  return (
    <main className="page cal-page">
      <PageHeader
        title="Calendar"
        description="Plan every post for every channel, make it with Shipcast, and get it out."
        actions={
          <>
            {ro ? (
              <span className="view-only" title="Viewers can look but not change things — ask an editor."><Nav.eye />View only</span>
            ) : (
              <>
                <button className="btn" onClick={() => setDialog('plan')} disabled={loading}>{planning ? <><span className="spinner" aria-hidden="true" />Planning…</> : <><Cal.spark />Plan my month</>}</button>
                <button className="btn primary" onClick={() => openNew()} disabled={loading}><Cal.plus />New post</button>
              </>
            )}
            <MoreMenu items={[
              { label: 'Subscribe in Google/Apple Calendar', run: () => setDialog('subscribe') },
              { label: 'Export CSV', href: api.calendar.csvUrl() },
              ...(ro ? [] : [{ label: 'Import CSV', run: () => setDialog('import') }, { label: 'Content plan settings', run: () => setDialog('settings') }]),
            ]} />
          </>
        }
      />

      {loading ? (
        posts.error ? <div className="banner" role="alert">Couldn't load the calendar: {posts.error}</div> : <Loading label="Loading the calendar…" />
      ) : (
        <>
          <div className="cal-toolbar">
            <div className="cal-nav">
              <button className="btn sm" onClick={() => setAnchor(today)}>Today</button>
              <button className="btn icon-btn sm" aria-label={`Previous ${view === 'list' ? '4 weeks' : view}`} onClick={() => setAnchor(shiftAnchor(view, anchor, -1))}><Cal.prev /></button>
              <button className="btn icon-btn sm" aria-label={`Next ${view === 'list' ? '4 weeks' : view}`} onClick={() => setAnchor(shiftAnchor(view, anchor, 1))}><Cal.next /></button>
              <h2 className="cal-title" aria-live="polite">{title}</h2>
              {wanted.length > 0 && (
                <button className="numbers-pill" onClick={() => setDialog('numbers')} aria-haspopup="dialog" title="Published posts waiting for their numbers">
                  <i className="dot warn" />Numbers wanted <span className="count-badge">{wanted.length}</span>
                </button>
              )}
            </div>
            <div className="seg cal-views" role="radiogroup" aria-label="View">
              {(['month', 'week', 'list'] as View[]).map((v) => (
                <button key={v} role="radio" aria-checked={view === v} aria-pressed={view === v} onClick={() => setView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>
              ))}
            </div>
            <div className="cal-filters">
              <div className="chips-row cal-chips-filter" role="group" aria-label="Channels">
                {chips.map((id) => (
                  <button key={id} className="chip-opt ch-chip" aria-pressed={chFilter.includes(id)} onClick={() => setChFilter((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]))}>
                    <ChannelIcon id={id} />{channelName(chInfo, id)}
                  </button>
                ))}
              </div>
              <select className="select st-filter" value={stFilter} aria-label="Status" onChange={(e) => setStFilter(e.target.value as PostStatus | '')}>
                <option value="">All statuses</option>
                {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </div>
          </div>

          {!wide && (
            <div className="tabs cal-panes" role="tablist" aria-label="Calendar or ideas">
              <a role="tab" href="#/calendar" aria-selected={pane === 'calendar'} aria-current={pane === 'calendar' ? 'page' : undefined} onClick={(e) => (e.preventDefault(), setPane('calendar'))}>Calendar</a>
              <a role="tab" href="#/calendar" aria-selected={pane === 'ideas'} aria-current={pane === 'ideas' ? 'page' : undefined} onClick={(e) => (e.preventDefault(), setPane('ideas'))}>Ideas <span className="count-badge">{ideas.length}</span></a>
            </div>
          )}

          <div className={`cal-layout${wide ? ' wide' : ''}`}>
            {(wide || pane === 'calendar') && (
              <div className="cal-main">
                {empty ? (
                  <EmptyState
                    icon={<Nav.calendar />}
                    title={ro ? 'Nothing planned yet' : 'Your content calendar is empty'}
                    action={ro ? undefined :
                      <>
                        <button className="btn primary" onClick={() => setDialog('plan')}><Cal.spark />Plan my month</button>
                        <button className="btn" onClick={() => openNew()}><Cal.plus />New post</button>
                      </>
                    }
                  >
                    {ro ? (
                      <>When editors in this workspace plan posts, they show up here.</>
                    ) : campaigns.data && !plannable(campaigns.data).length ? (
                      <>Plan my month writes a month of post ideas from your product's research — <a href="#/new">create a project first</a> so they're about your product, or start with a single post.</>
                    ) : (
                      <>Let Shipcast fill the next four weeks with drafts balanced across your pillars ({plan.data!.pillars.map((p) => p.name).join(', ')}), or add a post yourself. Ideas from the Ideas page land in the backlog.</>
                    )}
                  </EmptyState>
                ) : view === 'month' ? (
                  <MonthView {...ctx} anchor={anchor} byDay={byDay} onAnchor={setAnchor} onMore={(d) => (setAnchor(d), setView('week'))} onNew={openNew} phone={phone} />
                ) : view === 'week' ? (
                  <WeekView {...ctx} anchor={anchor} byDay={byDay} />
                ) : (
                  <ListView {...ctx} from={range.from} to={range.to} byDay={byDay} onNew={openNew} />
                )}
              </div>
            )}
            {(wide || pane === 'ideas') && backlog}
          </div>
        </>
      )}

      {drawer && (
        <PostDrawer
          key={drawer.post.id || 'new'}
          initial={drawer.post}
          tab={drawer.tab}
          addFor={drawer.addFor}
          onCreated={created}
          channels={chInfo}
          plan={plan.data}
          conns={conns.data}
          campaigns={campaigns.data}
          account={account}
          readOnly={ro}
          onSaved={(p) => {
            replace(p);
            void pending.reload();
            if (!drawer.post.id) setDrawer({ post: p });
          }}
          onDeleted={drop}
          onClose={() => {
            setDrawer(null);
            // Numbers may have been added inside the drawer.
            perf.reload();
            pending.reload();
          }}
        />
      )}
      {dialog === 'plan' && plan.data && <PlanMonthDialog plan={plan.data} channels={chInfo} posts={all} campaigns={campaigns.data} running={planning} onRun={runPlan} onClose={() => setDialog(null)} onSettings={() => setDialog('settings')} />}
      {dialog === 'settings' && plan.data && <PlanSettingsDialog plan={plan.data} channels={chInfo} onSaved={(p) => plan.setData(p)} onClose={() => setDialog(null)} />}
      {dialog === 'subscribe' && <SubscribeDialog onClose={() => setDialog(null)} />}
      {dialog === 'numbers' && (
        <NumbersWanted
          list={wanted}
          chInfo={chInfo}
          onClose={() => setDialog(null)}
          onAdd={(n) => {
            const p = all.find((x) => x.id === n.post);
            setDialog(null);
            if (p) setDrawer({ post: p, tab: 'performance', addFor: n.channel });
          }}
        />
      )}
      {dialog === 'import' && <ImportDialog onDone={posts.reload} onClose={() => setDialog(null)} />}
    </main>
  );
}

interface ViewCtx {
  tz: string;
  today: string;
  chInfo: ChannelInfo[];
  fresh: Set<string>;
  pulse: Pulse;
  onOpen: (p: Post) => void;
  onMove: (id: string, date: string | null, minutes?: number) => void;
  onQuickAdd: (date: string | null, title: string) => void;
}

function MoreMenu({ items }: { items: { label: string; run?: () => void; href?: string }[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEscape(open, () => (setOpen(false), box.current?.querySelector<HTMLElement>('button')?.focus()));
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', away);
    box.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const els = [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    els[(i + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length]?.focus();
  };
  return (
    <div className="menu" ref={box} onKeyDown={onKey}>
      <button className="btn icon-btn" aria-label="More calendar actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><Cal.more /></button>
      {open && (
        <div className="menu-pop" role="menu">
          {items.map((it) =>
            it.href ? (
              <a key={it.label} role="menuitem" href={it.href} download onClick={() => setOpen(false)}>{it.label}</a>
            ) : (
              <button key={it.label} role="menuitem" onClick={() => (setOpen(false), it.run?.())}>{it.label}</button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** Result or forecast for a chip, as words for its label. */
function pulseWords(p: Post, pulse: Pulse): string {
  const h = pulse.lift.get(p.id);
  if (h) return h.lift !== undefined ? `, ${h.lift.toFixed(1)} times your usual` : ', no baseline yet';
  const f = pulse.fc.get(p.id);
  return `${f ? `, forecast about ${f.lift.toFixed(1)} times your usual` : ''}${p.experiment ? ', experiment' : ''}`;
}

function PulseMarks({ p, pulse }: { p: Post; pulse: Pulse }) {
  const h = pulse.lift.get(p.id);
  const f = !h && pulse.fc.get(p.id);
  if (!h && !f && !p.experiment) return null;
  return (
    <span className="chip-pulse">
      {h && <LiftBadge lift={h.lift} />}
      {f && <ForecastHint f={f} />}
      {p.experiment && p.status !== 'published' && <ExperimentTag reason={p.experiment} compact />}
    </span>
  );
}

function PostChip({ p, tz, chInfo, fresh, pulse, onOpen, compact }: { p: Post; tz: string; chInfo: ChannelInfo[]; fresh: boolean; pulse: Pulse; onOpen: (p: Post) => void; compact?: boolean }) {
  const time = p.at ? localParts(p.at, tz).time : '';
  const names = p.channels.map((c) => channelName(chInfo, c.channel)).join(', ');
  const canDrag = useAccess().write;
  const h = pulse.lift.get(p.id);
  const tone = liftTone(h?.lift);
  return (
    <button
      className={`chip st-${p.status}${fresh ? ' fresh' : ''}${compact ? ' compact' : ''}${tone === 'up' || tone === 'down' ? ` heat-${tone}` : ''}`}
      // Subtle on purpose: half of all posts sit below the median, and the calendar shouldn't shout about it.
      style={h ? ({ '--heat': `${Math.round(heatStrength(h.lift) * (tone === 'up' ? 22 : 14))}%` } as CSSProperties) : undefined}
      draggable={p.status !== 'published' && canDrag}
      onDragStart={(e) => {
        dragging = { id: p.id, grabY: e.clientY - e.currentTarget.getBoundingClientRect().top };
        e.dataTransfer.setData('text/plain', p.title);
        e.dataTransfer.effectAllowed = 'move';
        e.currentTarget.classList.add('dragging');
      }}
      onDragEnd={(e) => {
        dragging = null;
        e.currentTarget.classList.remove('dragging');
      }}
      onClick={() => onOpen(p)}
      aria-label={`${p.title}${time ? `, ${time}` : ''}, ${STATUS_LABEL[p.status]}${names ? `, ${names}` : ''}${pulseWords(p, pulse)}`}
      title={`${p.title}${names ? ` · ${names}` : ''} · ${STATUS_LABEL[p.status]}${p.experiment ? `\n${p.experiment}` : ''}`}
    >
      <span className="chip-chs" aria-hidden="true">{p.channels.slice(0, 2).map((c) => <ChannelIcon key={c.channel} id={c.channel} />)}{p.channels.length > 2 && <small>+{p.channels.length - 2}</small>}</span>
      {time && <span className="chip-time tnum">{time}</span>}
      <PulseMarks p={p} pulse={pulse} />
      <span className="chip-title">{p.title}</span>
    </button>
  );
}

/** Drop-target props for a day (and optionally a time); highlight while something hovers it. */
function useDrop(onDrop: (id: string, e: DragEvent<HTMLElement>) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (e: DragEvent<HTMLElement>) => {
        if (!dragging) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!over) setOver(true);
      },
      onDragLeave: (e: DragEvent<HTMLElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      },
      onDrop: (e: DragEvent<HTMLElement>) => {
        e.preventDefault();
        setOver(false);
        if (dragging) onDrop(dragging.id, e);
        dragging = null;
      },
    },
  };
}

function QuickAdd({ onAdd, onCancel, label }: { onAdd: (t: string) => void; onCancel: () => void; label: string }) {
  const [t, setT] = useState('');
  return (
    <input
      className="input quick-add"
      autoFocus
      value={t}
      placeholder="Title, then Enter"
      aria-label={label}
      onChange={(e) => setT(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && t.trim()) {
          onAdd(t.trim());
          onCancel();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
      onBlur={() => (t.trim() ? (onAdd(t.trim()), onCancel()) : onCancel())}
    />
  );
}

function MonthView({ anchor, byDay, today, tz, chInfo, fresh, pulse, onOpen, onMove, onQuickAdd, onAnchor, onMore, onNew, phone }: ViewCtx & { anchor: string; byDay: Map<string, Post[]>; onAnchor: (d: string) => void; onMore: (d: string) => void; onNew: (d: string) => void; phone: boolean }) {
  const weeks = monthGrid(anchor);
  const month = anchor.slice(0, 7);
  const [focus, setFocus] = useState(anchor.slice(0, 7) === today.slice(0, 7) ? today : `${month}-01`);
  const [adding, setAdding] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const kbd = useRef(false);
  const inGrid = weeks.flat().includes(focus);
  useEffect(() => {
    if (!kbd.current) return;
    kbd.current = false;
    grid.current?.querySelector<HTMLElement>(`[data-date="${focus}"]`)?.focus();
  }, [focus, anchor]);
  const go = (d: string) => {
    kbd.current = true;
    setFocus(d);
    if (!weeks.flat().includes(d) || d.slice(0, 7) !== month) onAnchor(d);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>, d: string) => {
    if (e.target !== e.currentTarget) return;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step) return (e.preventDefault(), go(addDays(d, step)));
    if (e.key === 'Home') return (e.preventDefault(), go(startOfWeek(d)));
    if (e.key === 'End') return (e.preventDefault(), go(addDays(startOfWeek(d), 6)));
    if (e.key === 'PageUp' || e.key === 'PageDown') return (e.preventDefault(), go(addDays(d, e.key === 'PageUp' ? -28 : 28)));
    if (e.key === 'Enter' || e.key === 'n') return (e.preventDefault(), setAdding(d));
  };
  const max = phone ? 2 : 3;
  return (
    <div className="month" role="grid" aria-label={fmtDay(anchor, { month: 'long', year: 'numeric' })} ref={grid}>
      <div className="month-row month-head" role="row">
        {DOW.map((d) => <div key={d} role="columnheader" className="month-dow">{phone ? d[0] : d}</div>)}
      </div>
      {weeks.map((w) => (
        <div className="month-row" role="row" key={w[0]}>
          {w.map((d) => (
            <DayCell key={d} d={d} out={d.slice(0, 7) !== month} today={d === today} past={d < today} list={byDay.get(d) ?? []} max={max} tabIndex={(inGrid ? focus : `${month}-01`) === d ? 0 : -1} onFocus={() => setFocus(d)} onKey={(e) => onKey(e, d)} adding={adding === d} setAdding={(v) => setAdding(v ? d : null)} {...{ tz, chInfo, fresh, pulse, onOpen, onMove, onQuickAdd, onMore, onNew }} />
          ))}
        </div>
      ))}
      <p className="sr-only">Arrow keys move between days; Enter adds a post on the focused day. Open a post to move it to another date.</p>
    </div>
  );
}

function DayCell({ d, out, today, past, list, max, tabIndex, onFocus, onKey, adding, setAdding, tz, chInfo, fresh, pulse, onOpen, onMove, onQuickAdd, onMore, onNew }: {
  d: string; out: boolean; today: boolean; past: boolean; list: Post[]; max: number; tabIndex: number; onFocus: () => void; onKey: (e: KeyboardEvent<HTMLDivElement>) => void; adding: boolean; setAdding: (v: boolean) => void;
  tz: string; chInfo: ChannelInfo[]; fresh: Set<string>; pulse: Pulse; onOpen: (p: Post) => void; onMove: ViewCtx['onMove']; onQuickAdd: ViewCtx['onQuickAdd']; onMore: (d: string) => void; onNew: (d: string) => void;
}) {
  const drop = useDrop((id) => onMove(id, d));
  const label = fmtDay(d, { weekday: 'long', day: 'numeric', month: 'long' });
  const ro = !useAccess().write;
  return (
    <div
      role="gridcell"
      data-date={d}
      tabIndex={tabIndex}
      aria-label={`${label}${today ? ', today' : ''}, ${list.length ? `${list.length} post${list.length > 1 ? 's' : ''}` : 'no posts'}`}
      className={`day${out ? ' out' : ''}${today ? ' today' : ''}${past ? ' past' : ''}${drop.over ? ' over' : ''}`}
      onFocus={(e) => e.target === e.currentTarget && onFocus()}
      onKeyDown={onKey}
      onDoubleClick={(e) => !ro && e.target === e.currentTarget && onNew(d)}
      {...drop.props}
    >
      <div className="day-head">
        <span className="day-num">{Number(d.slice(8))}</span>
        {!ro && <button className="day-add" tabIndex={-1} aria-label={`Add a post on ${label}`} onClick={() => setAdding(true)}><Cal.plus /></button>}
      </div>
      {adding && <QuickAdd label={`New post on ${label}`} onAdd={(t) => onQuickAdd(d, t)} onCancel={() => setAdding(false)} />}
      <div className="day-chips">
        {list.slice(0, list.length > max ? max - 1 : max).map((p) => <PostChip key={p.id} p={p} tz={tz} chInfo={chInfo} fresh={fresh.has(p.id)} pulse={pulse} onOpen={onOpen} compact />)}
        {list.length > max && <button className="day-more" onClick={() => onMore(d)}>+{list.length - max + 1} more</button>}
      </div>
    </div>
  );
}

function WeekView({ anchor, byDay, today, tz, chInfo, fresh, pulse, onOpen, onMove }: ViewCtx & { anchor: string; byDay: Map<string, Post[]> }) {
  const days = weekDates(anchor);
  const hours = Array.from({ length: (DAY_END - DAY_START) / 60 }, (_, i) => DAY_START + i * 60);
  const scroller = useRef<HTMLDivElement>(null);
  const [ghost, setGhost] = useState<{ d: string; m: number } | null>(null);
  const [now, setNow] = useState(() => localParts(new Date().toISOString(), tz).time);
  useEffect(() => {
    const t = setInterval(() => setNow(localParts(new Date().toISOString(), tz).time), 60_000);
    return () => clearInterval(t);
  }, [tz]);
  useEffect(() => {
    scroller.current?.scrollTo({ top: ((8 * 60 - DAY_START) / 60) * HOUR_PX - 12 });
  }, []);
  const minuteAt = (e: DragEvent<HTMLElement>) => snapMinutes(DAY_START + ((e.clientY - e.currentTarget.getBoundingClientRect().top - (dragging?.grabY ?? 0)) / HOUR_PX) * 60, 15, DAY_START, DAY_END - 15);
  const top = (m: number) => ((Math.max(DAY_START, Math.min(DAY_END - 30, m)) - DAY_START) / 60) * HOUR_PX;

  return (
    <div className="week" role="grid" aria-label={`Week of ${fmtDay(days[0], { day: 'numeric', month: 'long' })}`}>
      <div className="week-head" role="row">
        <span className="week-gutter" />
        {days.map((d) => (
          <div key={d} role="columnheader" className={`week-dow${d === today ? ' today' : ''}`}>
            <span>{DOW[(new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7]}</span>
            <b>{Number(d.slice(8))}</b>
          </div>
        ))}
      </div>
      <div className="week-body" ref={scroller}>
        <div className="week-grid" style={{ height: hours.length * HOUR_PX }}>
          <div className="week-gutter">
            {hours.map((h) => <span key={h} style={{ top: ((h - DAY_START) / 60) * HOUR_PX }}>{timeOf(h)}</span>)}
          </div>
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            // Lanes: posts closer than 30 minutes sit side by side.
            const lanes: number[] = [];
            const placed = list.map((p) => {
              const m = minutesOf(localParts(p.at!, tz).time);
              let lane = lanes.findIndex((end) => end <= m);
              if (lane < 0) lane = lanes.push(0) - 1;
              lanes[lane] = m + 30;
              return { p, m, lane };
            });
            const n = Math.max(1, lanes.length);
            return (
              <div
                key={d}
                role="gridcell"
                aria-label={fmtDay(d, { weekday: 'long', day: 'numeric', month: 'long' })}
                className={`week-col${d === today ? ' today' : ''}${ghost?.d === d ? ' over' : ''}`}
                onDragOver={(e) => {
                  if (!dragging) return;
                  e.preventDefault();
                  const m = minuteAt(e);
                  if (ghost?.d !== d || ghost.m !== m) setGhost({ d, m });
                }}
                onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setGhost(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragging) onMove(dragging.id, d, minuteAt(e));
                  dragging = null;
                  setGhost(null);
                }}
              >
                {hours.map((h) => <i key={h} className="week-line" style={{ top: ((h - DAY_START) / 60) * HOUR_PX }} />)}
                {d === today && minutesOf(now) >= DAY_START && minutesOf(now) < DAY_END && <i className="now-line" style={{ top: ((minutesOf(now) - DAY_START) / 60) * HOUR_PX }} aria-hidden="true" />}
                {ghost?.d === d && <div className="week-ghost" style={{ top: top(ghost.m) }}><span>{timeOf(ghost.m)}</span></div>}
                {placed.map(({ p, m, lane }) => (
                  <div key={p.id} className="week-item" style={{ top: top(m), left: `calc(${(lane / n) * 100}% + 2px)`, width: `calc(${100 / n}% - 4px)` }}>
                    <PostChip p={p} tz={tz} chInfo={chInfo} fresh={fresh.has(p.id)} pulse={pulse} onOpen={onOpen} />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ListView({ from, to, byDay, today, tz, chInfo, fresh, pulse, onOpen, onNew }: ViewCtx & { from: string; to: string; byDay: Map<string, Post[]>; onNew: (d: string) => void }) {
  const days: string[] = [];
  const write = useAccess().write;
  for (let d = from; d <= to; d = addDays(d, 1)) if (byDay.get(d)?.length) days.push(d);
  if (!days.length) {
    return <EmptyState compact icon={<Nav.calendar />} title="Nothing planned in these four weeks" action={write ? <button className="btn" onClick={() => onNew(from < today ? today : from)}><Cal.plus />New post</button> : undefined}>{write ? 'Use the arrows to look further ahead, or add a post.' : 'Use the arrows to look further ahead.'}</EmptyState>;
  }
  return (
    <div className="list-view">
      {days.map((d) => (
        <section key={d} className={`list-day${d === today ? ' today' : ''}`} aria-labelledby={`ld-${d}`}>
          <h3 id={`ld-${d}`}>
            <span>{fmtDay(d, { weekday: 'long' })}</span>
            <b>{fmtDay(d, { day: 'numeric', month: 'long' })}</b>
            {d === today && <span className="tag">Today</span>}
          </h3>
          <ul>
            {byDay.get(d)!.map((p) => (
              <li key={p.id}>
                <button className={`list-row st-${p.status}${fresh.has(p.id) ? ' fresh' : ''}`} onClick={() => onOpen(p)} aria-label={`${p.title}, ${localParts(p.at!, tz).time}, ${STATUS_LABEL[p.status]}${pulseWords(p, pulse)}`}>
                  <span className="tnum list-time">{localParts(p.at!, tz).time}</span>
                  <span className="list-main">
                    <b>{p.title}</b>
                    <span className="list-meta">
                      {p.channels.map((c) => <span key={c.channel} className="list-ch"><ChannelIcon id={c.channel} />{channelName(chInfo, c.channel)}</span>)}
                      {p.pillar && <span className="muted">· {p.pillar}</span>}
                    </span>
                  </span>
                  <span className="list-end"><PulseMarks p={p} pulse={pulse} /><StatusPill status={p.status} small /></span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Backlog({ ideas, chInfo, fresh, inputRef, onAdd, onOpen, onDropBack }: { ideas: Post[]; chInfo: ChannelInfo[]; fresh: Set<string>; inputRef: RefObject<HTMLInputElement | null>; onAdd: (t: string) => void; onOpen: (p: Post) => void; onDropBack: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [t, setT] = useState('');
  const drop = useDrop((id) => onDropBack(id));
  const ro = !useAccess().write;
  const list = ideas.filter((p) => !q.trim() || `${p.title} ${p.notes} ${p.pillar ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <aside className={`backlog${drop.over ? ' over' : ''}`} aria-label="Ideas backlog" {...drop.props}>
      <header className="backlog-head">
        <h2>Ideas <span className="count-badge">{ideas.length}</span></h2>
        <p className="hint">{ro ? 'Post ideas without a date yet.' : 'No date yet. Drag one onto a day, or open it to pick a date.'}</p>
      </header>
      {!ro && (
        <form className="backlog-add" onSubmit={(e) => (e.preventDefault(), t.trim() && (onAdd(t.trim()), setT('')))}>
          <input ref={inputRef} className="input" value={t} placeholder="Add idea…" aria-label="Add idea" onChange={(e) => setT(e.target.value)} />
          <button className="btn icon-btn" aria-label="Add idea" disabled={!t.trim()}><Cal.plus /></button>
        </form>
      )}
      {ideas.length > 4 && <input className="input backlog-search" type="search" value={q} placeholder="Search ideas" aria-label="Search ideas" onChange={(e) => setQ(e.target.value)} />}
      {!ideas.length ? (
        <p className="backlog-empty">{ro ? 'No ideas yet.' : <>Ideas without a date live here — type one above, or use <a href="#/ideas">Add to calendar</a> on a trend.</>}</p>
      ) : !list.length ? (
        <p className="backlog-empty">No ideas match “{q}”.</p>
      ) : (
        <ul className="backlog-list">
          {list.map((p) => (
            <li key={p.id}>
              <IdeaCard p={p} chInfo={chInfo} fresh={fresh.has(p.id)} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function IdeaCard({ p, chInfo, fresh, onOpen }: { p: Post; chInfo: ChannelInfo[]; fresh: boolean; onOpen: (p: Post) => void }): ReactNode {
  const canDrag = useAccess().write;
  return (

    <button
      className={`idea${fresh ? ' fresh' : ''}`}
      draggable={canDrag}

      onDragStart={(e) => {
        dragging = { id: p.id, grabY: 10 };
        e.dataTransfer.setData('text/plain', p.title);
        e.dataTransfer.effectAllowed = 'move';
        e.currentTarget.classList.add('dragging');
      }}
      onDragEnd={(e) => {
        dragging = null;
        e.currentTarget.classList.remove('dragging');
      }}
      onClick={() => onOpen(p)}
    >
      <span className="idea-grip" aria-hidden="true"><Cal.grip /></span>
      <span className="idea-main">
        <b>{p.title}</b>
        <span className="list-meta">
          {p.channels.map((c) => <ChannelIcon key={c.channel} id={c.channel} label={channelName(chInfo, c.channel)} />)}
          {p.pillar && <span>{p.pillar}</span>}
          {p.trend && <span className="tag">From a trend</span>}
        </span>
      </span>
    </button>
  );
}

/** Published posts waiting for their numbers (no collector can read them), oldest ask first. */
function NumbersWanted({ list, chInfo, onAdd, onClose }: { list: PendingNumbers[]; chInfo: ChannelInfo[]; onAdd: (n: PendingNumbers) => void; onClose: () => void }) {
  const rows = [...list].sort((a, b) => a.since.localeCompare(b.since));
  return (
    <Dialog title="Numbers wanted" onClose={onClose} foot={<><span className="hint">Asked at 1, 3, 7 and 30 days where no connection can read them.</span><button className="btn" onClick={onClose}>Close</button></>}>
      <p className="dialog-lead">Type them, drop a screenshot of the post's stats, or import the platform's CSV — a few seconds each, and every one teaches the playbook.</p>
      <ul className="wanted">
        {rows.map((n) => (
          <li key={`${n.post}|${n.channel}|${n.bucket}`}>
            <ChannelIcon id={n.channel} label={channelName(chInfo, n.channel)} />
            <span className="wanted-main"><b>{n.title}</b><small className="muted">{channelName(chInfo, n.channel)} · the {BUCKET_ADJ[n.bucket]} reading</small></span>
            <button className="btn sm primary" onClick={() => onAdd(n)}>Add numbers</button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
