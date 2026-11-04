import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ApiError, api, apiHeaders, type AskAnswer, type Report, type Section, type ShareInfo } from '../api.ts';
import { go, toast, useLoad } from '../hooks.ts';
import {
  AUDIENCE_CHOICES, EXPIRY_CHOICES, WRITER_LABEL, ago, audienceLabel, channelLabel, coverageFixes, exportLinks, fmtExact, fmtKpi, linesFrom, makingStep, mapNavigate,
  periodLabel, reportGates, shareLink, splitSections, suggestedQuestions, timeSaved, timeSavedText, type Audience, type ReportGates, type SectionId,
} from '../reports-model.ts';
import { useAccess } from '../session.ts';
import { Dialog, Loading, PopMenu } from '../components/ui.tsx';
import { Cal, Nav } from '../components/icons.tsx';
import { ChannelIcon } from '../components/CalendarBits.tsx';
import { AskChartView, ChangePill, GoalRow, KpiTile, SplitBar, TopPost, Waterfall } from '../components/ReportBits.tsx';

const notThere = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 405);
const ORDER: SectionId[] = ['summary', 'results', 'why', 'work', 'website', 'goals', 'notable', 'next', 'coverage'];

/** One report, laid out like a page you'd forward: headline, numbers, why, and what to do next. */
export function ReportPage({ id }: { id: string }) {
  const a = useAccess();
  const can = reportGates(a);
  const r = useLoad(() => api.reports.get(id), [id]);
  const [busy, setBusy] = useState<{ what: string; since: number } | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);
  useEffect(() => {
    if (r.data) document.title = `${r.data.title} · Shipcast`;
  }, [r.data?.title]);

  if (r.error) {
    return (
      <main className="page rp-page">
        <a className="back" href="#/reports">← Reports</a>
        <div className="banner" role="alert">{/not found/i.test(r.error) ? 'This report doesn’t exist in this workspace — it may have been deleted.' : `Couldn't load this report: ${r.error}`}</div>
      </main>
    );
  }
  if (!r.data) return <main className="page rp-page"><Loading label="Opening the report…" /></main>;
  const rep = r.data;
  const save = async (patch: Parameters<typeof api.reports.edit>[1], done?: string) => {
    try {
      r.setData(await api.reports.edit(rep.id, patch));
      if (done) toast(done);
      return true;
    } catch (e) {
      toast((e as Error).message);
      return false;
    }
  };
  const long = async (what: string, fn: () => Promise<Report>, done: string) => {
    setBusy({ what, since: Date.now() });
    try {
      r.setData(await fn());
      toast(done);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="page rp-page">
      <Toolbar rep={rep} can={can} busy={!!busy} onReport={(x) => r.setData(x)} onLong={long} />
      {busy && (
        <div className="rp-busy no-print" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <b>{busy.what === 'rewrite' ? makingStep(Date.now() - busy.since).replace('Reading your numbers…', 'Rewriting for the new reader…') : 'Working…'}</b>
          <span className="hint tnum">{Math.round((Date.now() - busy.since) / 1000)}s</span>
        </div>
      )}
      <ReportBody rep={rep} can={can} save={save} onReport={(x) => r.setData(x)} />
      {can.ask ? <AskBox rep={rep} /> : null}
    </main>
  );
}

// ── toolbar ────────────────────────────────────────────────────────────

function Toolbar({ rep, can, busy, onReport, onLong }: { rep: Report; can: ReportGates; busy: boolean; onReport: (r: Report) => void; onLong: (what: string, fn: () => Promise<Report>, done: string) => void }) {
  const versions = useLoad(() => (can.edit ? api.reports.versions(rep.id).catch(() => []) : Promise.resolve([])), [rep.id, rep.version]);
  const [sharing, setSharing] = useState(false);
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const download = async (href: string, name: string) => {
    try {
      const res = await fetch(href, { headers: apiHeaders() });
      if (res.status === 404 || res.status === 405) return toast(`${name} export isn't available on this server yet`);
      if (!res.ok) return toast(`Couldn't export: ${(await res.json().catch(() => ({}))).error ?? res.statusText}`);
      const blob = await res.blob();
      const file = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get('content-disposition') ?? '')?.[1];
      const ext = href.endsWith('card.png') ? 'png' : href.split('/').pop();
      const url = URL.createObjectURL(blob);
      const el = Object.assign(document.createElement('a'), { href: url, download: file ? decodeURIComponent(file) : `${rep.title.replace(/[^\w\- ]+/g, '').trim() || 'report'}.${ext}` });
      document.body.append(el);
      el.click();
      el.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const others = (versions.data ?? []).filter((v) => v.version !== rep.version).sort((x, y) => y.version - x.version);
  return (
    <>
    <div className="rp-toolbar no-print">
      <a className="back" href="#/reports">← Reports</a>
      <div className="rp-tools">
        {can.edit ? (
          <div className="seg rp-aud-seg" role="radiogroup" aria-label="Written for">
            {AUDIENCE_CHOICES.map((x) => (
              <button key={x.id} role="radio" aria-checked={rep.audience === x.id} aria-pressed={rep.audience === x.id} title={x.hint} disabled={busy}
                onClick={() => x.id !== rep.audience && onLong('rewrite', () => api.reports.rewrite(rep.id, x.id as Audience), `Rewritten for ${x.label.toLowerCase()}`)}>
                {x.label}
              </button>
            ))}
          </div>
        ) : null}
        {can.edit && others.length > 0 && (
          <PopMenu label="Earlier versions" items={others.slice(0, 12).map((v) => ({ id: `v${v.version}`, label: <span className="rp-ver"><b>Version {v.version}</b><small>{v.headline}</small></span>, hint: ago(v.updatedAt), run: () => onLong('restore', () => api.reports.restore(rep.id, v.version), `Version ${v.version} restored`) }))}
            trigger={({ open, toggle, ref }) => <button ref={ref} className="btn sm" aria-haspopup="menu" aria-expanded={open} disabled={busy} onClick={toggle}><Cal.clock />Versions</button>} />
        )}
        <PopMenu label="Export" items={[
          ...exportLinks(rep.id).map((x) => ({ id: x.id, label: x.label, hint: x.hint, run: () => void download(x.href, x.label) })),
          'sep' as const,
          { id: 'print', label: 'Print', hint: 'A clean page from your browser', run: () => window.print() },
        ]} trigger={({ open, toggle, ref }) => <button ref={ref} className="btn sm" aria-haspopup="menu" aria-expanded={open} onClick={toggle}><Cal.download />Export</button>} />
        {can.share && <button className="btn sm" onClick={() => setSharing(true)}><Cal.link />Share</button>}
        {can.send && <button className="btn sm primary" disabled={busy} onClick={() => setSending(true)}><Cal.send />Send</button>}
        {can.remove && (
          <PopMenu label="More" items={[
            ...(can.edit ? [{ id: 'status', label: rep.status === 'draft' ? 'Mark as ready' : 'Mark as draft', run: () => void api.reports.edit(rep.id, { status: rep.status === 'draft' ? 'ready' : 'draft' }).then(onReport, (e) => toast(e.message)) }] : []),
            { id: 'delete', label: 'Delete report', danger: true, run: () => setDeleting(true) },
          ]} trigger={({ open, toggle, ref }) => <button ref={ref} className="btn sm ghost icon-btn" aria-label="More" aria-haspopup="menu" aria-expanded={open} onClick={toggle}><Cal.more /></button>} />
        )}
      </div>
    </div>
    {/* Outside the toolbar: its backdrop blur would otherwise trap the fixed dialogs inside it. */}
      {sharing && <ShareDialog id={rep.id} onClose={() => setSharing(false)} />}
      {sending && <SendDialog rep={rep} onClose={() => setSending(false)} onSent={() => api.reports.get(rep.id).then(onReport, () => {})} />}
      {deleting && (
        <Dialog title="Delete this report?" size="sm" onClose={() => setDeleting(false)} foot={<>
          <button className="btn ghost" onClick={() => setDeleting(false)}>Cancel</button>
          <button className="btn primary" onClick={async () => { try { await api.reports.remove(rep.id); toast('Report deleted'); go('/reports'); } catch (e) { toast((e as Error).message); } }}>Delete</button>
        </>}>
          <p className="dialog-lead">“{rep.title}” and its earlier versions go for good. Share links to it stop working.</p>
        </Dialog>
      )}
    </>
  );
}

function ShareDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const list = useLoad(() => api.reports.shares(id).then((v) => ({ v }), (e) => (notThere(e) ? { v: null } : Promise.reject(e))));
  const [days, setDays] = useState<number | null>(30);
  const [made, setMade] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const s = await api.reports.share(id, days ?? undefined);
      setMade(shareLink(location.origin, s.url));
      list.reload();
    } catch (e) {
      toast(notThere(e) ? 'Share links aren’t available on this server yet' : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (s: ShareInfo) => {
    try {
      await api.reports.revokeShare(id, s.id);
      list.setData({ v: (list.data?.v ?? []).filter((x) => x.id !== s.id) });
      toast('Link revoked — it stops working now');
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Link copied');
    } catch {
      toast('Select the link and copy it');
    }
  };
  return (
    <Dialog title="Share a read-only link" onClose={onClose} foot={<button className="btn" onClick={onClose}>Done</button>}>
      <p className="dialog-lead">Anyone with the link can read this report — nothing else in your workspace. You can revoke it any time.</p>
      {list.data && list.data.v === null ? (
        <p className="role-note">Share links aren't available on this server yet. Export a PDF in the meantime.</p>
      ) : (
        <>
          {made ? (
            <div className="rp-share-made">
              <label className="field"><span>Your link</span>
                <span className="rp-share-url">
                  <input className="input mono" readOnly value={made} onFocus={(e) => e.target.select()} aria-label="Share link" />
                  <button className="btn primary" onClick={() => copy(made)}>Copy</button>
                </span>
              </label>
              <p className="hint">Copy it now — for safety it's only shown once.</p>
            </div>
          ) : (
            <div className="field">
              <span id="rp-exp">Link works for</span>
              <div className="rp-share-row">
                <div className="seg" role="radiogroup" aria-labelledby="rp-exp">
                  {EXPIRY_CHOICES.map((x) => <button key={x.label} role="radio" aria-checked={days === x.days} aria-pressed={days === x.days} onClick={() => setDays(x.days)}>{x.label}</button>)}
                </div>
                <button className="btn primary" disabled={busy} onClick={create}><Cal.link />{busy ? 'Making…' : 'Create link'}</button>
              </div>
            </div>
          )}
          {list.error && <p className="hint" role="alert">{list.error}</p>}
          {!!list.data?.v?.length && (
            <div className="field">
              <span>Links to this report</span>
              <ul className="rp-shares">
                {list.data.v.map((s) => {
                  const expired = !!s.expiresAt && Date.parse(s.expiresAt) < Date.now();
                  return (
                    <li key={s.id}>
                      <span>
                        <b>Made {ago(s.createdAt)}</b>
                        <small className="muted">
                          {s.views} view{s.views === 1 ? '' : 's'}{s.lastViewedAt ? ` · last ${ago(s.lastViewedAt)}` : ''} · {s.expiresAt ? `${expired ? 'expired' : 'expires'} ${new Date(s.expiresAt).toLocaleDateString()}` : 'no expiry'}
                        </small>
                      </span>
                      <button className="btn sm danger" onClick={() => revoke(s)}>Revoke</button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}

function SendDialog({ rep, onClose, onSent }: { rep: Report; onClose: () => void; onSent: () => void }) {
  const sch = useLoad(() => api.reports.schedule().catch(() => null));
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ sent: string[]; failed: string[] } | null>(null);
  const to = [...(sch.data?.emails ?? []), ...(sch.data?.webhooks ?? []).map((w) => `${w.kind === 'generic' ? 'Webhook' : w.kind[0].toUpperCase() + w.kind.slice(1)}`)];
  const send = async () => {
    setBusy(true);
    try {
      const r = await api.reports.send(rep.id);
      setRes(r);
      onSent();
      if (!r.failed.length) toast(`Sent to ${r.sent.length} recipient${r.sent.length === 1 ? '' : 's'}`);
    } catch (e) {
      toast(notThere(e) ? 'Sending isn’t available on this server yet' : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="Send this report" size="sm" busy={busy} onClose={onClose} foot={res ? <button className="btn primary" onClick={onClose}>Done</button> : <>
      <a className="btn ghost" href="#/reports">Edit recipients</a>
      <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
      <button className="btn primary" disabled={busy || (!!sch.data && !to.length)} onClick={send}><Cal.send />{busy ? 'Sending…' : 'Send now'}</button>
    </>}>
      {res ? (
        <div className="rp-send-res">
          {res.sent.length > 0 && <p><b className="up-text">Sent</b> to {res.sent.join(', ')}.</p>}
          {res.failed.length > 0 && <p><b className="down-text">Didn't go</b> to {res.failed.join(', ')}. Check the address or the email server in Reports → Delivery.</p>}
          {!res.sent.length && !res.failed.length && <p>Nobody to send to — add recipients in Reports → Delivery.</p>}
        </div>
      ) : !sch.data && !sch.error ? (
        <Loading />
      ) : to.length ? (
        <p className="dialog-lead">“{rep.title}” goes to <b>{to.join(', ')}</b> — the recipients set in Reports → Delivery.{rep.status === 'sent' ? ' It was already sent once.' : ''}</p>
      ) : (
        <p className="dialog-lead">No recipients yet. Add emails or a Slack, Teams or Discord webhook in Reports → Delivery.</p>
      )}
    </Dialog>
  );
}

// ── the page itself ────────────────────────────────────────────────────

type SaveFn = (patch: Parameters<typeof api.reports.edit>[1], done?: string) => Promise<boolean>;

function ReportBody({ rep, can, save, onReport }: { rep: Report; can: ReportGates; save: SaveFn; onReport: (r: Report) => void }) {
  const f = rep.facts;
  const { shown, hidden } = splitSections(rep.sections);
  const byId = new Map(rep.sections.map((s) => [s.id, s]));
  const hours = timeSaved(rep.kind, f.period);
  const kpis = f.kpis;
  const visual = (id: SectionId): ReactNode => {
    switch (id) {
      case 'results':
        return null;
      case 'why':
        return (f.waterfall.length > 0 || f.split || f.top.length > 0) ? (
          <>
            {(f.waterfall.length > 0 || f.split) && (
              <div className="rp-why-grid">
                {f.waterfall.length > 0 && <figure className="rp-fig"><figcaption>Where the change in reach came from</figcaption><Waterfall rows={f.waterfall} /></figure>}
                {f.split && <figure className="rp-fig"><figcaption>More posts, or better posts?</figcaption><SplitBar split={f.split} /></figure>}
              </div>
            )}
            {f.top.length > 0 && (
              <div className="rp-fig">
                <h3 className="rp-sub">Top posts</h3>
                <ol className="rp-posts">{f.top.slice(0, 3).map((p, i) => <TopPost key={`${p.post}${p.channel}`} p={p} rank={i + 1} />)}</ol>
              </div>
            )}
          </>
        ) : null;
      case 'work':
        return f.work.published || f.work.campaigns.length ? (
          <div className="rp-work">
            <span className="rp-stat"><b className="tnum">{fmtExact(f.work.published)}</b> posts published</span>
            {(Object.entries(f.work.byChannel) as [string, number][]).map(([ch, n]) => <span key={ch} className="rp-stat sm"><ChannelIcon id={ch} />{channelLabel(ch)} <b className="tnum">{n}</b></span>)}
            {f.work.campaigns.length > 0 && <span className="rp-stat sm">{f.work.campaigns.length} campaign{f.work.campaigns.length === 1 ? '' : 's'}</span>}
            {f.work.experiments.length > 0 && <span className="rp-stat sm">{f.work.experiments.length} experiment{f.work.experiments.length === 1 ? '' : 's'}</span>}
            {f.work.upcoming > 0 && <span className="rp-stat sm">{f.work.upcoming} scheduled next</span>}
          </div>
        ) : null;
      case 'website':
        return f.site ? <SiteBlock site={f.site} /> : null;
      case 'goals':
        return f.goals.length ? <ul className="rp-goals">{f.goals.map((g) => <GoalRow key={g.id} g={g} />)}</ul> : null;
      case 'notable':
        return f.notable.length ? (
          <ul className="rp-notable">
            {f.notable.map((n, i) => (
              <li key={i} className={`k-${n.kind}`}>
                <span className="rp-notable-icon" aria-hidden="true">{n.kind === 'high' ? '▲' : n.kind === 'low' ? '▼' : n.kind === 'streak-up' ? '↗' : '↘'}</span>
                <span>{n.text}</span>
              </li>
            ))}
          </ul>
        ) : null;
      case 'next':
        return rep.recommendations.length ? <NextSteps rep={rep} can={can} onReport={onReport} /> : null;
      case 'coverage':
        return <Coverage rep={rep} quiet={!!byId.get('coverage')?.lines.length} />;
      default:
        return null;
    }
  };
  const block = (s: Section | undefined, id: SectionId, inHidden = false) => {
    const v = visual(id);
    if (!s && !v) return null;
    if (!s && id !== 'coverage') return null;
    // Next steps show as action cards; their text is only repeated when someone edited it.
    const quietLines = id === 'next' && rep.recommendations.length > 0 && !s?.edited;
    return <SectionBlock key={id} s={s} id={id} can={can} save={save} inHidden={inHidden} quietLines={quietLines}>{v}</SectionBlock>;
  };

  return (
    <article className="rp-paper">
      <header className="rp-head">
        <div className="rp-eyebrow">
          <span>{periodLabel(rep.kind)} · {f.period.label}</span>
          <span className="rp-chip">For {audienceLabel(rep.audience).toLowerCase()}</span>
          {rep.status === 'sent' && <span className="rp-chip ok">Sent{rep.sentAt ? ` ${ago(rep.sentAt)}` : ''}</span>}
          {rep.status === 'draft' && <span className="rp-chip">Draft</span>}
        </div>
        <Editable value={rep.title} can={can.edit} label="Title" onSave={(v) => save({ title: v })} render={(v) => <h1 className="rp-title">{v}</h1>} />
        <Editable value={rep.headline} can={can.edit} label="Headline" multiline onSave={(v) => save({ headline: v })} render={(v) => <p className="rp-headline">{v}</p>} />
        <Editable value={rep.intro ?? ''} can={can.edit} label="Intro" multiline placeholder="Add a short intro for your reader (optional)" onSave={(v) => save({ intro: v })} render={(v) => (v ? <p className="rp-intro">{v}</p> : null)} />
        <div className="rp-badges">
          <span className={`rp-writer w-${rep.writer}`} title="Every number in the text was checked against the fact sheet; sentences with numbers that aren't there are dropped.">
            <Nav.check />{rep.edited ? 'Edited by the team' : WRITER_LABEL[rep.writer]}
          </span>
          <span className="rp-asof">Numbers as of {new Date(f.asOf).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
        </div>
      </header>

      {kpis.length > 0 && (
        <section className="rp-kpis" aria-label="Key numbers">
          {kpis.slice(0, 8).map((k) => <KpiTile key={k.key} k={k} />)}
        </section>
      )}

      {ORDER.map((id) => {
        const s = byId.get(id);
        if (s?.hidden) return null;
        if (id === 'coverage' && !s && !f.coverage.messages.length && !f.coverage.missing.length && f.coverage.site !== 'none') return null;
        return block(s, id);
      })}
      {shown.filter((s) => !ORDER.includes(s.id)).map((s) => block(s, s.id))}

      {hidden.length > 0 && (
        <details className="rp-hidden no-print">
          <summary>Hidden from this audience <span className="muted">· {hidden.length} section{hidden.length === 1 ? '' : 's'}</span></summary>
          {hidden.map((s) => block(s, s.id, true))}
        </details>
      )}

      {f.notes.length > 0 && (
        <section className="rp-section rp-notes-sec">
          <h2>On the timeline</h2>
          <ul className="rp-tl">
            {f.notes.map((n) => <li key={n.id}><time>{new Date(`${n.date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</time>{n.text}</li>)}
          </ul>
        </section>
      )}

      <footer className="rp-foot">
        <span title="Estimated from typical time spent writing a report like this by hand">{timeSavedText(hours)}</span>
        <span>Compared with {f.prevPeriod.label}</span>
      </footer>
    </article>
  );
}

/** Click to edit, Enter (or Save) to keep, Escape to cancel. */
function Editable({ value, can, label, onSave, render, multiline, placeholder }: { value: string; can: boolean; label: string; onSave: (v: string) => Promise<boolean>; render: (v: string) => ReactNode; multiline?: boolean; placeholder?: string }) {
  const [edit, setEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  useEffect(() => {
    if (edit !== null) ref.current?.focus();
  }, [edit !== null]);
  if (edit === null) {
    const shown = render(value);
    if (!can) return <>{shown}</>;
    if (!value && placeholder) return <button className="rp-add-intro no-print" onClick={() => setEdit('')}><Nav.plus />{placeholder}</button>;
    return (
      <div className="rp-editable">
        {shown}
        <button className="rp-edit-btn no-print" aria-label={`Edit ${label.toLowerCase()}`} title={`Edit ${label.toLowerCase()}`} onClick={() => setEdit(value)}><Nav.pencil /></button>
      </div>
    );
  }
  const commit = async () => {
    const v = edit.trim();
    if (v === value.trim()) return setEdit(null);
    if (!v && label !== 'Intro') return toast(`${label} can't be empty`);
    setBusy(true);
    if (await onSave(v)) setEdit(null);
    setBusy(false);
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), setEdit(null));
    if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) (e.preventDefault(), commit());
  };
  return (
    <div className={`rp-editing ${label.toLowerCase()}`}>
      {multiline ? (
        <textarea ref={ref} className="textarea" rows={label === 'Intro' ? 3 : 2} value={edit} aria-label={label} placeholder={placeholder} onChange={(e) => setEdit(e.target.value)} onKeyDown={keys} />
      ) : (
        <input ref={ref} className="input" value={edit} aria-label={label} onChange={(e) => setEdit(e.target.value)} onKeyDown={keys} maxLength={140} />
      )}
      <div className="rp-edit-actions">
        <span className="hint">{multiline ? '⌘↵ to save · Esc to cancel' : '↵ to save · Esc to cancel'}</span>
        <button className="btn sm ghost" onClick={() => setEdit(null)}>Cancel</button>
        <button className="btn sm primary" disabled={busy} onClick={commit}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}

const SECTION_FALLBACK: Partial<Record<SectionId, string>> = { coverage: 'What this report can’t see' };

function SectionBlock({ s, id, can, save, inHidden, quietLines, children }: { s?: Section; id: SectionId; can: ReportGates; save: SaveFn; inHidden: boolean; quietLines?: boolean; children?: ReactNode }) {
  const [edit, setEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const title = s?.title ?? SECTION_FALLBACK[id] ?? id;
  const commit = async () => {
    if (!s || edit === null) return;
    setBusy(true);
    if (await save({ sections: [{ id: s.id, lines: linesFrom(edit) }] }, 'Section saved')) setEdit(null);
    setBusy(false);
  };
  const lead = id === 'summary';
  return (
    <section className={`rp-section s-${id}${lead ? ' lead' : ''}${s?.hidden ? ' is-hidden' : ''}`} aria-labelledby={`rp-s-${id}`}>
      <header className="rp-section-head">
        <h2 id={`rp-s-${id}`}>{title}{s?.edited && <span className="rp-edited">edited</span>}</h2>
        {s && can.edit && edit === null && (
          <span className="rp-section-tools no-print">
            <button className="btn sm ghost" onClick={() => setEdit(s.lines.join('\n'))}><Nav.pencil />Edit</button>
            <button className="btn sm ghost" onClick={() => save({ sections: [{ id: s.id, hidden: !s.hidden }] }, s.hidden ? 'Section shown' : 'Hidden from this audience')}>
              <Nav.eye />{inHidden ? 'Show' : 'Hide'}
            </button>
          </span>
        )}
      </header>
      {edit !== null ? (
        <div className="rp-editing">
          <textarea className="textarea" rows={Math.max(3, edit.split('\n').length + 1)} value={edit} autoFocus aria-label={`${title}: one point per line`} onChange={(e) => setEdit(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), setEdit(null)); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.preventDefault(), commit()); }} />
          <div className="rp-edit-actions">
            <span className="hint">One point per line. Keep numbers you can stand behind.</span>
            <button className="btn sm ghost" onClick={() => setEdit(null)}>Cancel</button>
            <button className="btn sm primary" disabled={busy} onClick={commit}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      ) : s && s.lines.length > 0 && !quietLines ? (
        s.lines.length === 1 || lead ? <div className="rp-lines">{s.lines.map((l, i) => <p key={i}>{l}</p>)}</div> : <ul className="rp-lines">{s.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
      ) : null}
      {children}
    </section>
  );
}

function SiteBlock({ site }: { site: NonNullable<Report['facts']['site']> }) {
  const ch = (a: number, b: number) => (b > 0 ? (a - b) / b : undefined);
  const tiles = [
    { label: 'Website visits', v: site.sessions, c: ch(site.sessions, site.prev.sessions) },
    { label: 'Visitors', v: site.users, c: ch(site.users, site.prev.users) },
    { label: 'Key events', v: site.keyEvents, c: ch(site.keyEvents, site.prev.keyEvents) },
    ...(site.search ? [{ label: 'Search clicks', v: site.search.clicks, c: ch(site.search.clicks, site.search.prev.clicks) }] : []),
  ];
  const maxSocial = Math.max(1, ...site.social.map((s) => s.sessions));
  return (
    <div className="rp-site">
      <div className="rp-site-tiles">
        {tiles.map((t) => (
          <div key={t.label} className="rp-site-tile">
            <small>{t.label}</small>
            <b className="tnum">{fmtKpi(t.v)}</b>
            <ChangePill change={t.c} size="sm" />
          </div>
        ))}
      </div>
      <div className="rp-site-cols">
        {site.social.length > 0 && (
          <div>
            <h3 className="rp-sub">Visits from social</h3>
            <ul className="rp-hbars">
              {site.social.map((s) => (
                <li key={s.channel}>
                  <span><ChannelIcon id={s.channel} />{channelLabel(s.channel)}</span>
                  <i style={{ width: `${(s.sessions / maxSocial) * 100}%` }} />
                  <b className="tnum">{fmtExact(s.sessions)}{s.keyEvents ? <small> · {fmtExact(s.keyEvents)} key events</small> : null}</b>
                </li>
              ))}
            </ul>
          </div>
        )}
        {site.topQueries.length > 0 && (
          <div>
            <h3 className="rp-sub">Top searches</h3>
            <ol className="rp-queries">
              {site.topQueries.slice(0, 5).map((q) => <li key={q.query}><span>{q.query}</span><b className="tnum">{fmtExact(q.clicks)}</b><small className="muted tnum">{fmtExact(q.impressions)} seen</small></li>)}
            </ol>
          </div>
        )}
      </div>
      {site.search?.position !== undefined && <p className="hint">Average search position {site.search.position.toFixed(1)}{site.search.ctr !== undefined ? ` · ${(site.search.ctr * 100).toFixed(1)}% of searchers clicked` : ''} · {site.days} days of website data</p>}
    </div>
  );
}

function NextSteps({ rep, can, onReport }: { rep: Report; can: ReportGates; onReport: (r: Report) => void }) {
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { text: string; to?: string }>>({});
  const run = async (recId: string) => {
    setRunning(recId);
    try {
      const out = await api.reports.act(rep.id, recId);
      onReport(out.report);
      const to = mapNavigate(out.navigate) ?? undefined;
      setResults((x) => ({ ...x, [recId]: { text: out.created?.length ? `${out.result}.` : out.result, to } }));
      if (to) go(to);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setRunning(null);
    }
  };
  return (
    <ol className="rp-next">
      {rep.recommendations.map((x, i) => {
        const res = results[x.id];
        const done = x.done ?? (res ? { result: res.text } : undefined);
        return (
          <li key={x.id} className={done ? 'done' : ''}>
            <span className="rp-next-n" aria-hidden="true">{done ? <Nav.check /> : i + 1}</span>
            <div className="rp-next-body">
              <b>{x.text}</b>
              {x.why && <span className="muted">{x.why}</span>}
              {done && <span className="rp-next-res" role="status">{done.result}{res?.to ? <> · <a href={`#${res.to}`}>Open</a></> : null}</span>}
            </div>
            {can.act && !done && (
              <button className="btn sm primary no-print" disabled={running !== null} onClick={() => run(x.id)}>
                {running === x.id ? 'Working…' : x.action.label}
              </button>
            )}
            {can.act && done && mapNavigate(x.action.navigate) && <a className="btn sm no-print" href={`#${mapNavigate(x.action.navigate)}`}>{x.action.label}</a>}
          </li>
        );
      })}
    </ol>
  );
}

/** The gaps and how to fix them; `quiet` when the section text already says what's missing. */
function Coverage({ rep, quiet }: { rep: Report; quiet?: boolean }) {
  const a = useAccess();
  const c = rep.facts.coverage;
  const fixes = coverageFixes(c, a.manage);
  if (!c.messages.length && !fixes.length) return <p className="rp-covered">Nothing missing — every published post has numbers{c.site === 'connected' ? ' and the website is connected' : ''}.</p>;
  return (
    <div className="rp-coverage">
      {c.messages.length > 0 && !quiet && <ul>{c.messages.map((m, i) => <li key={i}>{m}</li>)}</ul>}
      {c.missing.length > 0 && (
        <p className="hint">Without numbers: {c.missing.slice(0, 4).map((m) => m.title).join(', ')}{c.missing.length > 4 ? ` and ${c.missing.length - 4} more` : ''}.</p>
      )}
      {fixes.length > 0 && <div className="rp-cov-fixes no-print">{fixes.map((x) => <a key={x.href} className="btn sm" href={x.href}>{x.label}</a>)}</div>}
    </div>
  );
}

// ── ask ────────────────────────────────────────────────────────────────

function AskBox({ rep }: { rep: Report }) {
  const [q, setQ] = useState('');
  const [thread, setThread] = useState<{ q: string; a?: AskAnswer; error?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const ideas = suggestedQuestions(rep.facts).filter((x) => !thread.some((t) => t.q === x));
  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true);
    setQ('');
    setThread((t) => [...t, { q: text }]);
    try {
      const a = await api.reports.ask(rep.id, text);
      setThread((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a } : x)));
    } catch (e) {
      if (notThere(e)) setMissing(true);
      setThread((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error: notThere(e) ? 'Asking isn’t available on this server yet.' : (e as Error).message } : x)));
    } finally {
      setBusy(false);
      requestAnimationFrame(() => end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    }
  };
  return (
    <section className="rp-ask no-print" aria-labelledby="rp-ask-h">
      <h2 id="rp-ask-h"><Cal.spark />Ask this report</h2>
      <p className="hint">Answers come from this report's numbers and your data, and say which numbers they used.</p>
      {thread.length > 0 && (
        <div className="rp-thread">
          {thread.map((t, i) => (
            <div key={i} className="rp-qa">
              <p className="rp-q">{t.q}</p>
              {t.a ? (
                <div className="rp-a">
                  {t.a.answer.map((l, j) => <p key={j}>{l}</p>)}
                  {t.a.chart && <AskChartView chart={t.a.chart} />}
                </div>
              ) : t.error ? (
                <p className="rp-a error-text">{t.error}</p>
              ) : (
                <p className="rp-a loading"><span className="spinner" aria-hidden="true" />Looking through the numbers…</p>
              )}
            </div>
          ))}
          <div ref={end} />
        </div>
      )}
      {!missing && ideas.length > 0 && (
        <div className="chips-row rp-ask-ideas">
          {ideas.map((x) => <button key={x} className="chip-opt" disabled={busy} onClick={() => ask(x)}>{x}</button>)}
        </div>
      )}
      <form className="rp-ask-form" onSubmit={(e) => (e.preventDefault(), ask(q))}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Why did October dip? Which pillar brings signups?" aria-label="Your question" maxLength={300} disabled={missing} />
        <button className="btn primary" disabled={busy || !q.trim() || missing}>{busy ? 'Thinking…' : 'Ask'}</button>
      </form>
    </section>
  );
}
