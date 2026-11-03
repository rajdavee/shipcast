import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { api, type BrandScore, type Campaign, type PublishConnections } from '../api.ts';
import { channelProblems, CHANNEL_ORDER, localParts, nextAction, parseHashtags, scheduleProblems, slotTime, withServerState, zonedToUtc, type ChannelId, type ChannelInfo, type ContentPlan, type Post, type PostChannel, type PublishVia } from '../calendar-model.ts';
import { formatTitle } from '../formats.ts';
import { toast, useEscape, useFocusTrap } from '../hooks.ts';
import { Cal, Nav } from './icons.tsx';
import { baseName, ChannelIcon, StatusPill, Thumb } from './CalendarBits.tsx';
import { PostPreview } from './PostPreview.tsx';

const VIA_LABEL: Record<PublishVia, string> = { manual: 'Manual', direct: 'Direct', postiz: 'Postiz' };
const VIA_HINT: Record<PublishVia, string> = { manual: 'You post it from a ready-made kit; Shipcast reminds you at the time.', direct: 'Shipcast posts it with your connected account.', postiz: 'Your Postiz instance posts it at the time.' };
const STATE_LABEL: Record<string, string> = { pending: 'Waiting for its time', sending: 'Sending…', sent: 'Posted', failed: 'Failed', due: 'Due — post it now' };
const TONE_CHANNELS = ['linkedin', 'x', 'instagram', 'tiktok', 'youtube', 'facebook'];

/** What the drawer edits; everything else is the server's (status, publisher bookkeeping, links to the made piece). */
const editable = (p: Post) => JSON.stringify([p.title, p.at ?? null, p.format ?? '', p.pillar ?? '', p.notes, p.channels.map((c) => [c.channel, c.title ?? '', c.caption, c.firstComment ?? '', c.hashtags, c.media, c.via])]);
const payload = (p: Post) => ({ title: p.title, at: (p.at ?? null) as unknown as string, tz: p.tz, format: p.format, pillar: p.pillar, notes: p.notes, channels: p.channels });

export const blankChannel = (channel: ChannelId): PostChannel => ({ channel, caption: '', hashtags: [], media: [], via: 'manual' });

export function viaOptions(info: ChannelInfo | undefined, conns: PublishConnections | null): PublishVia[] {
  return (info?.via ?? ['manual']).filter((v) => v === 'manual' || (v === 'postiz' ? !!conns?.postiz.configured : info?.id === 'linkedin' ? !!conns?.linkedin.connected : info?.id === 'youtube' ? !!conns?.youtube.connected : false));
}

export function PostDrawer({ initial, channels, plan, conns, campaigns, account, onSaved, onDeleted, onClose }: {
  initial: Post;
  channels: ChannelInfo[];
  plan: ContentPlan | null;
  conns: PublishConnections | null;
  campaigns: Campaign[] | null;
  account: string;
  onSaved: (p: Post) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
}) {
  const tz = plan?.tz ?? initial.tz;
  const [edit, setEdit] = useState<Post>(initial);
  const [server, setServer] = useState<Post | undefined>(initial.id ? initial : undefined);
  const [active, setActive] = useState<ChannelId | undefined>(initial.channels[0]?.channel);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const title = useRef<HTMLInputElement>(null);
  useFocusTrap(panel, true);
  useEscape(true, () => close());
  useEffect(() => {
    if (!initial.id) title.current?.focus();
    else panel.current?.querySelector<HTMLElement>('.drawer-close')?.focus();
  }, []);
  // Fresh copy on open: the publisher may have moved on since the calendar last loaded.
  useEffect(() => {
    if (!initial.id) return;
    api.calendar.posts().then((all) => {
      const p = all.find((x) => x.id === initial.id);
      if (p) {
        setServer(p);
        setEdit((e) => ({ ...withServerState(e, p), status: p.status, step: p.step, campaign: p.campaign }));
      }
    }).catch(() => {});
  }, [initial.id]);

  const dirty = !!edit.id && (!server || editable(edit) !== editable(server));
  const accept = (p: Post) => {
    setServer(p);
    setEdit((e) => ({ ...withServerState(e, p), id: p.id, status: p.status, step: p.step, campaign: p.campaign }));
    onSaved(p);
  };
  async function save(extra: Partial<Post> = {}): Promise<Post | null> {
    if (!edit.id) return null;
    setSaving('saving');
    try {
      const p = await api.calendar.save(edit.id, { ...payload(withServerState(edit, server)), ...extra });
      accept(p);
      setSaving('saved');
      return p;
    } catch (e) {
      setSaving('error');
      throw e;
    }
  }
  // Autosave a moment after typing stops.
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => save().catch((e) => setError((e as Error).message)), 700);
    return () => clearTimeout(t);
  }, [editable(edit), dirty]);

  function close() {
    if (dirty) save().catch(() => {});
    onClose();
  }
  const set = (patch: Partial<Post>) => setEdit((e) => ({ ...e, ...patch }));
  const setCh = (id: ChannelId, patch: Partial<PostChannel>) => setEdit((e) => ({ ...e, channels: e.channels.map((c) => (c.channel === id ? { ...c, ...patch } : c)) }));
  const ch = edit.channels.find((c) => c.channel === active) ?? edit.channels[0];
  const info = ch && channels.find((c) => c.id === ch.channel);
  const date = edit.at ? localParts(edit.at, tz).date : '';
  const time = edit.at ? localParts(edit.at, tz).time : '';
  const setWhen = (d: string, t: string) => set({ at: d ? zonedToUtc(d, t || slotTime(plan, edit.channels[0]?.channel, d), tz) : undefined });
  const formats = useMemo(() => [...new Set(edit.channels.flatMap((c) => channels.find((x) => x.id === c.channel)?.formats ?? []))], [edit.channels.map((c) => c.channel).join(), channels]);
  const action = edit.id ? nextAction(edit, channels) : null;
  const problems = scheduleProblems(edit, channels);
  const project = campaigns?.find((c) => c.id === edit.campaign);
  const locked = edit.status === 'published';

  async function run(name: string, fn: () => Promise<unknown>) {
    setBusy(name);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const create = () =>
    run('create', async () => {
      const p = await api.calendar.create({ ...payload(edit), at: edit.at, status: edit.at ? 'draft' : 'idea' });
      accept(p);
      toast(p.at ? 'Post added to the calendar' : 'Idea added to the backlog');
    });
  const make = () =>
    run('make', async () => {
      if (dirty) await save();
      const p = await api.calendar.make(edit.id, { format: edit.format || formats[0] });
      accept(p);
      toast(`Making it${campaigns?.find((c) => c.id === p.campaign) ? ` in ${campaigns.find((c) => c.id === p.campaign)!.name}` : ''} — files attach here when it's rendered`);
    });
  const schedule = () => run('schedule', async () => void (await save({ status: 'scheduled' }), toast('Scheduled')));
  const unschedule = () => run('unschedule', async () => void (await save({ status: 'ready' }), toast('Unscheduled — it stays on the calendar as ready')));
  const sendNow = () =>
    run('send', async () => {
      if (dirty) await save();
      const r = await api.calendar.sendNow(edit.id);
      accept(r.post);
      toast(r.note);
    });
  const retry = () =>
    run('retry', async () => {
      const soon = new Date(Date.now() + 2 * 60_000).toISOString();
      const at = edit.at && edit.at > soon ? edit.at : soon;
      set({ at });
      await save({ status: 'scheduled', at });
      toast('Queued to try again');
    });
  const markSent = (c: PostChannel, url?: string) =>
    run(`mark-${c.channel}`, async () => {
      accept(await api.calendar.markSent(edit.id, c.channel, url));
      toast(`Marked posted on ${channels.find((x) => x.id === c.channel)?.name ?? c.channel}`);
    });
  const markAll = () =>
    run('mark', async () => {
      let p: Post | null = null;
      for (const c of edit.channels.filter((x) => x.state !== 'sent')) p = await api.calendar.markSent(edit.id, c.channel);
      if (p) accept(p);
      toast('Marked posted');
    });
  const remove = () =>
    run('delete', async () => {
      await api.calendar.remove(edit.id);
      onDeleted(edit.id);
      toast('Post deleted');
      onClose();
    });

  const addChannel = (id: ChannelId) => {
    // A new channel starts from the copy already written, so adding Instagram to a LinkedIn post isn't a blank page.
    const from = edit.channels[0];
    setEdit((e) => ({ ...e, channels: [...e.channels, { ...blankChannel(id), caption: from?.caption ?? '', media: from?.media ?? [] }] }));
    setActive(id);
  };
  const removeChannel = (id: ChannelId) => {
    const rest = edit.channels.filter((c) => c.channel !== id);
    set({ channels: rest });
    setActive(rest[0]?.channel);
  };
  const free = CHANNEL_ORDER.filter((id) => !edit.channels.some((c) => c.channel === id) && channels.some((c) => c.id === id));

  const primary =
    action === 'make' ? <button className="btn primary" disabled={!!busy} onClick={make}><Cal.spark />{busy === 'make' ? 'Starting…' : 'Make it'}</button>
    : action === 'schedule' ? <button className="btn primary" disabled={!!busy || problems.length > 0} onClick={schedule} title={problems.length ? 'Fix the problems below first' : undefined}><Cal.clock />{busy === 'schedule' ? 'Scheduling…' : 'Schedule'}</button>
    : action === 'send' ? <button className="btn primary" disabled={!!busy} onClick={sendNow}><Cal.send />{busy === 'send' ? 'Queuing…' : 'Send now'}</button>
    : action === 'mark' ? <button className="btn primary" disabled={!!busy} onClick={markAll}>{busy === 'mark' ? 'Saving…' : 'Mark posted'}</button>
    : action === 'retry' ? <button className="btn primary" disabled={!!busy} onClick={retry}>{busy === 'retry' ? 'Queuing…' : 'Retry'}</button>
    : null;

  return (
    <div className="drawer-wrap">
      <div className="scrim" onClick={close} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={edit.id ? `Post: ${edit.title}` : 'New post'} ref={panel}>
        <header className="drawer-head">
          <StatusPill status={edit.id ? edit.status : edit.at ? 'draft' : 'idea'} />
          <input ref={title} className="drawer-title" value={edit.title} placeholder="What's the post about?" aria-label="Title" disabled={locked} onChange={(e) => set({ title: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && !edit.id && edit.title.trim() && create()} />
          <span className="drawer-saved" role="status">{saving === 'saving' ? 'Saving…' : saving === 'saved' && !dirty ? 'Saved' : saving === 'error' ? 'Not saved' : ''}</span>
          <button className="btn ghost icon-btn drawer-close" aria-label="Close" onClick={close}><Nav.close /></button>
        </header>

        <div className="drawer-body">
          <div className="drawer-edit">
            <div className="drawer-actions">
              {!edit.id ? (
                <button className="btn primary" disabled={!edit.title.trim() || !!busy} onClick={create}>{busy === 'create' ? 'Adding…' : edit.at ? 'Add to calendar' : 'Add to ideas'}</button>
              ) : (
                primary
              )}
              {edit.status === 'scheduled' && <button className="btn" disabled={!!busy} onClick={unschedule}>Unschedule</button>}
              {action === 'make' && <button className="btn" disabled={!!busy || problems.length > 0} onClick={schedule} title={problems.length ? 'Fix the problems below first' : 'Schedule without making media'}>Schedule</button>}
              {edit.id && (confirmDelete ? (
                <span className="confirm">Delete this post? <button className="btn sm danger" onClick={remove}>Delete</button><button className="btn sm ghost" onClick={() => setConfirmDelete(false)}>Keep</button></span>
              ) : (
                <button className="btn ghost icon-btn" aria-label="Delete post" title="Delete post" onClick={() => setConfirmDelete(true)}><Cal.trash /></button>
              ))}
            </div>
            {error && <div className="banner" role="alert">{error}</div>}
            {edit.id && action === 'schedule' && problems.length > 0 && (
              <ul className="problems" aria-label="Before it can be scheduled">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
            )}

            <div className="drawer-grid">
              <label className="field">
                <span>Date <small className="muted">· move to…</small></span>
                <input className="input" type="date" value={date} disabled={locked} onChange={(e) => setWhen(e.target.value, time)} />
              </label>
              <label className="field">
                <span>Time</span>
                <input className="input" type="time" step={900} value={time} disabled={!date || locked} onChange={(e) => e.target.value && setWhen(date, e.target.value)} />
              </label>
              <div className="field tz-note">
                <span>&nbsp;</span>
                <p className="hint">{tz.replace(/_/g, ' ')} time{date && <> · <button className="linkish" disabled={locked} onClick={() => set({ at: undefined })}>back to ideas</button></>}</p>
              </div>
              <label className="field">
                <span>Pillar</span>
                <select className="select" value={edit.pillar ?? ''} onChange={(e) => set({ pillar: e.target.value || undefined })}>
                  <option value="">—</option>
                  {(plan?.pillars ?? []).map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                  {edit.pillar && !plan?.pillars.some((p) => p.name === edit.pillar) && <option value={edit.pillar}>{edit.pillar}</option>}
                </select>
              </label>
              <label className="field">
                <span>Format</span>
                <select className="select" value={edit.format ?? ''} onChange={(e) => set({ format: e.target.value || undefined })}>
                  <option value="">—</option>
                  {[...new Set([...formats, ...(edit.format ? [edit.format] : [])])].map((f) => <option key={f} value={f}>{formatTitle(f)}</option>)}
                </select>
              </label>
              <div className="field">
                <span>Made in</span>
                <p className="hint made">{project ? <a href={`#/c/${project.id}`}>{project.name}</a> : edit.step ? 'a project' : 'Not made yet'}</p>
              </div>
            </div>
            <label className="field">
              <span>Notes</span>
              <textarea className="textarea notes" rows={2} value={edit.notes} placeholder="Angle, hook, links, who to tag…" onChange={(e) => set({ notes: e.target.value })} />
            </label>

            <section className="ch-section" aria-label="Channels">
              <div className="ch-tabs" role="tablist" aria-label="Channels">
                {edit.channels.map((c) => {
                  const bad = channelProblems(c, channels.find((x) => x.id === c.channel)).length;
                  return (
                    <button key={c.channel} role="tab" id={`tab-${c.channel}`} aria-controls="ch-panel" aria-selected={c.channel === ch?.channel} className="ch-tab" onClick={() => setActive(c.channel)}>
                      <ChannelIcon id={c.channel} />
                      {channels.find((x) => x.id === c.channel)?.name ?? c.channel}
                      {c.state === 'sent' ? <i className="dot ok" aria-label="posted" /> : bad ? <i className="dot warn" aria-label={`${bad} to fix`} /> : null}
                    </button>
                  );
                })}
                {free.length > 0 && !locked && (
                  <select className="select ch-add" value="" aria-label="Add a channel" onChange={(e) => e.target.value && addChannel(e.target.value as ChannelId)}>
                    <option value="">+ Channel</option>
                    {free.map((id) => <option key={id} value={id}>{channels.find((c) => c.id === id)?.name}</option>)}
                  </select>
                )}
              </div>
              {!ch ? (
                <p className="hint ch-empty">Pick at least one channel to write for.</p>
              ) : (
                <ChannelEditor key={ch.channel} post={edit} ch={ch} info={info} conns={conns} busy={busy} locked={locked || ch.state === 'sent' || ch.state === 'sending'} onChange={(patch) => setCh(ch.channel, patch)} onRemove={() => removeChannel(ch.channel)} onMake={action === 'make' ? make : undefined} onMark={(url) => markSent(ch, url)} onRetry={retry} />
              )}
            </section>
          </div>

          <div className="drawer-preview">
            <div className="pv-switch" role="group" aria-label="Preview channel">
              <span className="pv-label">Preview</span>
              {edit.channels.map((c) => (
                <button key={c.channel} aria-pressed={c.channel === ch?.channel} onClick={() => setActive(c.channel)} title={channels.find((x) => x.id === c.channel)?.name}>
                  <ChannelIcon id={c.channel} label={channels.find((x) => x.id === c.channel)?.name} />
                </button>
              ))}
            </div>
            {ch ? <PostPreview post={edit} ch={ch} info={info} account={account} /> : <p className="hint">Add a channel to see how it looks.</p>}
          </div>
        </div>
      </aside>
    </div>
  );
}

function ChannelEditor({ post, ch, info, conns, busy, locked, onChange, onRemove, onMake, onMark, onRetry }: {
  post: Post;
  ch: PostChannel;
  info?: ChannelInfo;
  conns: PublishConnections | null;
  busy: string | null;
  locked: boolean;
  onChange: (p: Partial<PostChannel>) => void;
  onRemove: () => void;
  onMake?: () => void;
  onMark: (url?: string) => void;
  onRetry: () => void;
}) {
  const [tag, setTag] = useState('');
  const [link, setLink] = useState('');
  const [score, setScore] = useState<BrandScore | null>(null);
  const text = [ch.caption.trim(), ch.hashtags.join(' ')].filter(Boolean).join('\n\n');
  const len = text.length;
  const max = info?.captionMax ?? 3000;
  const problems = channelProblems(ch, info);
  // The current choice stays visible even if its connection went away, so it's clear why it won't send.
  const vias = [...new Set([...viaOptions(info, conns), ch.via])];
  const missing = (info?.via ?? []).filter((v) => !vias.includes(v));

  // Brand score, a moment after typing stops.
  useEffect(() => {
    if (!text.trim()) return setScore(null);
    let on = true;
    const t = setTimeout(() => api.scoreCopy({ text, toneId: 'default', channel: TONE_CHANNELS.includes(ch.channel) ? ch.channel : undefined }).then((s) => on && setScore(s)).catch(() => {}), 600);
    return () => {
      on = false;
      clearTimeout(t);
    };
  }, [text, ch.channel]);
  const top = score?.issues.find((i) => i.severity === 'error') ?? score?.issues[0];

  const addTags = (v: string) => {
    const next = parseHashtags(v).filter((h) => !ch.hashtags.some((x) => x.toLowerCase() === h.toLowerCase()));
    if (next.length) onChange({ hashtags: [...ch.hashtags, ...next] });
    setTag('');
  };
  const onTagKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || e.key === ',' || e.key === ' ') && tag.trim()) {
      e.preventDefault();
      addTags(tag);
    } else if (e.key === 'Backspace' && !tag && ch.hashtags.length) onChange({ hashtags: ch.hashtags.slice(0, -1) });
  };

  return (
    <div className="ch-panel" id="ch-panel" role="tabpanel" aria-labelledby={`tab-${ch.channel}`}>
      {ch.state && (
        <div className={`pub-state ps-${ch.state}`}>
          <b>{STATE_LABEL[ch.state] ?? ch.state}</b>
          {ch.state === 'sent' && ch.url && <a href={ch.url} target="_blank" rel="noreferrer noopener"><Cal.link />Open the live post</a>}
          {ch.state === 'sent' && !ch.url && ch.sentAt && <span className="muted">{new Date(ch.sentAt).toLocaleString()}</span>}
          {ch.state === 'failed' && ch.error && <span>{ch.error}</span>}
          {ch.state === 'failed' && <button className="btn sm" disabled={!!busy} onClick={onRetry}>Retry</button>}
          {ch.note && <span className="muted">{ch.note}</span>}
        </div>
      )}

      {info?.titleMax ? (
        <label className="field">
          <span className="count-row">{ch.channel === 'newsletter' ? 'Subject line' : 'Title'}<Count n={(ch.title ?? '').length} max={info.titleMax} /></span>
          <input className="input" value={ch.title ?? ''} disabled={locked} onChange={(e) => onChange({ title: e.target.value })} />
        </label>
      ) : null}

      <label className="field">
        <span className="count-row">{ch.channel === 'youtube' ? 'Description' : ch.channel === 'newsletter' || ch.channel === 'blog' ? 'Body' : 'Caption'}<Count n={len} max={max} /></span>
        <textarea className="textarea caption" rows={7} value={ch.caption} disabled={locked} placeholder={info?.foldAt ? `Hook first — the first ${info.foldAt} characters show before “…see more”.` : 'Write the post.'} onChange={(e) => onChange({ caption: e.target.value })} />
      </label>
      {info?.foldAt && ch.caption.trim() && (
        <div className="fold-meter" aria-label={`Fold at ${info.foldAt} characters`}>
          <div className="fold-bar"><i style={{ width: `${Math.min(100, (ch.caption.length / Math.max(info.foldAt * 2, ch.caption.length)) * 100)}%` }} /><b style={{ left: `${(info.foldAt / Math.max(info.foldAt * 2, ch.caption.length)) * 100}%` }} title="…see more" /></div>
          <p className="hint">{ch.caption.length <= info.foldAt ? 'All of it shows without “…see more”.' : <>Shown before “…see more”: <q>{ch.caption.slice(0, info.foldAt).split('\n')[0].slice(0, 90)}…</q></>}</p>
        </div>
      )}

      {info && info.hashtagsMax > 0 && (
        <div className="field">
          <span className="count-row">Hashtags<Count n={ch.hashtags.length} max={info.hashtagsMax} /></span>
          <div className="tag-input" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}>
            {ch.hashtags.map((h) => (
              <span key={h} className="hashtag">{h}{!locked && <button aria-label={`Remove ${h}`} onClick={() => onChange({ hashtags: ch.hashtags.filter((x) => x !== h) })}>×</button>}</span>
            ))}
            {!locked && <input value={tag} placeholder={ch.hashtags.length ? '' : '#launch #buildinpublic'} aria-label="Add hashtags" onChange={(e) => setTag(e.target.value)} onKeyDown={onTagKey} onBlur={() => tag.trim() && addTags(tag)} />}
          </div>
        </div>
      )}

      {info?.firstComment && (
        <label className="field">
          <span>First comment <small className="muted">· posted right after, good for links</small></span>
          <textarea className="textarea" rows={2} value={ch.firstComment ?? ''} disabled={locked} onChange={(e) => onChange({ firstComment: e.target.value || undefined })} />
        </label>
      )}

      <div className="field">
        <span>Media <small className="muted">· {info?.media}</small></span>
        {ch.media.length ? (
          <div className="media-strip">
            {ch.media.map((m) => (
              <figure key={m} className="media-item" title={baseName(m)}>
                <Thumb path={m} />
                {!locked && <button aria-label={`Remove ${baseName(m)}`} onClick={() => onChange({ media: ch.media.filter((x) => x !== m) })}>×</button>}
              </figure>
            ))}
          </div>
        ) : post.step ? (
          <p className="hint">Being made{post.campaign ? <> in <a href={`#/c/${post.campaign}`}>its project</a></> : ''} — the files attach here when it's rendered.</p>
        ) : (
          <div className="media-empty">
            <span className="hint">{info?.needsMedia ? 'This channel needs media.' : 'Optional for this channel.'}</span>
            {onMake && <button className="btn sm" disabled={!!busy} onClick={onMake}><Cal.spark />Make it</button>}
          </div>
        )}
      </div>

      <div className="field">
        <span>Publish via</span>
        <div className="seg" role="radiogroup" aria-label="Publish via">
          {vias.map((v) => (
            <button key={v} role="radio" aria-checked={ch.via === v} aria-pressed={ch.via === v} disabled={locked} onClick={() => onChange({ via: v })}>{VIA_LABEL[v]}</button>
          ))}
        </div>
        <p className="hint">{VIA_HINT[ch.via]}{missing.length > 0 && <> {missing.map((m) => VIA_LABEL[m]).join(' or ')} needs a connection — <a href="#/settings/connections">set it up in Settings</a>.</>}</p>
      </div>

      <div className="ch-checks">
        {score && (
          <div className={`brand-line ${score.score >= 85 ? 'ok' : score.score >= 65 ? 'mid' : 'bad'}`}>
            <b>Brand {score.score}</b>
            <span>{top ? `${top.detail}${top.fix ? ` → “${top.fix}”` : ''}` : 'On brand.'}</span>
          </div>
        )}
        {problems.length > 0 ? (
          <ul className="problems">{problems.map((p) => <li key={p}>{p.replace(/^[^:]+: /, '')}</li>)}</ul>
        ) : (
          <p className="ok-line">Good to go on {info?.name}.</p>
        )}
      </div>

      {post.id && (
        <div className="ch-foot">
          {ch.via === 'manual' && <a className="btn sm" href={api.calendar.kitUrl(post.id, ch.channel)} download><Cal.download />Download post kit</a>}
          {ch.state !== 'sent' && (post.status === 'scheduled' || ch.state === 'due' || ch.state === 'failed') && ch.via === 'manual' && (
            <form className="mark-form" onSubmit={(e) => (e.preventDefault(), onMark(link.trim() || undefined))}>
              <input className="input" type="url" placeholder="Link to the live post (optional)" value={link} onChange={(e) => setLink(e.target.value)} aria-label="Link to the live post" />
              <button className="btn sm" disabled={!!busy}>Mark posted</button>
            </form>
          )}
          {!locked && <button className="linkish danger" onClick={onRemove}>Remove {info?.name}</button>}
        </div>
      )}
      {!post.id && <div className="ch-foot"><button className="linkish danger" onClick={onRemove}>Remove {info?.name}</button></div>}
    </div>
  );
}

function Count({ n, max }: { n: number; max: number }) {
  return <small className={`count ${n > max ? 'over' : n > max * 0.9 ? 'near' : ''}`}>{n.toLocaleString()} / {max.toLocaleString()}</small>;
}
