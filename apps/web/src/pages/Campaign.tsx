import { useEffect, useMemo, useRef, useState } from 'react';
import { api, fileUrl, fmtDuration, type Campaign as C, type CampaignEvent, type Pack, type Step } from '../api.ts';
import { go, toast, useLoad } from '../hooks.ts';
import { FORMATS, PLAIN, isStudio, relTime, shape } from '../formats.ts';
import { Lightbox } from '../components/Lightbox.tsx';
import { OptionInput } from '../components/OptionInput.tsx';

/** Live campaign state + event log over one SSE connection. */
function useCampaign(id: string) {
  const [campaign, setCampaign] = useState<C | null>(null);
  const [events, setEvents] = useState<CampaignEvent[]>([]);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    setEvents([]);
    setCampaign(null);
    const es = new EventSource(`/api/campaigns/${id}/events`);
    es.addEventListener('campaign', (e) => setCampaign(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('log', (e) => setEvents((xs) => [...xs.slice(-1500), JSON.parse((e as MessageEvent).data)]));
    // EventSource reconnects by itself; only a real 404 means the campaign is gone.
    es.onerror = () => {
      api.campaign(id).catch((e: Error) => {
        if (/not found|404/i.test(String(e.message))) {
          setGone(true);
          es.close();
        }
      });
    };
    return () => es.close();
  }, [id]);
  return { campaign, events, gone, setCampaign };
}

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

interface Brand {
  name?: string;
  oneLiner?: string;
  colors?: Record<string, string>;
  logo?: string;
}

function BriefStrip({ campaign, step }: { campaign: C; step: Step }) {
  const has = (f: string) => step.outputs.includes(f);
  const brand = useLoad<Brand | null>(() => (has('brand.json') ? fetch(fileUrl(campaign.id, 'brief/brand.json') + `?v=${step.endedAt}`).then((r) => r.json()) : Promise.resolve(null)), [step.endedAt]);
  const colors = Object.values(brand.data?.colors ?? {}).filter((v) => /^#[0-9a-f]{3,8}$/i.test(v)).slice(0, 6);
  const source = campaign.source.type === 'text' ? 'your description' : campaign.source.value.replace(/^https?:\/\//, '');
  if (step.status === 'running' || step.status === 'queued')
    return (
      <div className="brief-strip working-strip">
        <span className="spinner" aria-hidden="true" />
        <div>
          <b>Studying {source}</b>
          <span>{step.phase ? `${step.phase}…` : 'Reading the product, collecting its colors, fonts, logo and screenshots…'}</span>
        </div>
      </div>
    );
  if (step.status !== 'done') return null;
  return (
    <div className="brief-strip">
      {brand.data?.logo && has(brand.data.logo) && <img className="blogo" src={fileUrl(campaign.id, `brief/${brand.data.logo}`)} alt="" />}
      <p>{brand.data?.oneLiner ?? 'Research complete.'}</p>
      {colors.length > 0 && (
        <span className="swatch-row" title="Brand colors">
          {colors.map((c, i) => <i key={i} style={{ background: c }} />)}
        </span>
      )}
      <a className="linkish" href={fileUrl(campaign.id, 'brief/brief.md')} target="_blank" rel="noreferrer">Read the brief</a>
    </div>
  );
}

const PlayIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg>
);

function thumbOf(step: Step): string | null {
  const order = [/infographic\.gif$/, /(^|\/)(video|captioned)\.jpg$/, /slide-01\.png$/, /youtube-[a-z]?\.?(jpg|png)$/i, /og-card\.png$/];
  for (const re of order) {
    const hit = step.outputs.find((o) => re.test(o));
    if (hit) return hit;
  }
  return step.outputs.find((o) => /\.(png|jpe?g)$/i.test(o) && !o.includes('sheet')) ?? null;
}

function CopyPreview({ campaign, step }: { campaign: C; step: Step }) {
  const f = step.outputs.find((o) => o.endsWith('copy.md')) ?? step.outputs.find((o) => o.endsWith('.md') && !o.endsWith('NOTES.md'));
  const text = useLoad(() => (f ? fetch(fileUrl(campaign.id, `deliverables/${step.id}/${f}`)).then((r) => r.text()) : Promise.resolve('')), [step.endedAt]);
  return <div className="copy-preview">{(text.data ?? '').replace(/^#+\s*/gm, '').slice(0, 600)}</div>;
}

function ResultCard({ campaign, step, pack, now, onOpen, onRetry }: { campaign: C; step: Step; pack?: Pack; now: number; onOpen: () => void; onRetry: () => void }) {
  const ratio = shape(pack, step);
  const thumb = step.status === 'done' ? thumbOf(step) : null;
  const isVideo = !thumb?.endsWith('.gif') && step.outputs.some((o) => o.endsWith('.mp4'));
  const name = (pack?.name ?? step.pack ?? '').replace(/ · (freeform|brag)$/, '');
  const elapsed = step.startedAt ? now - Date.parse(step.startedAt) : 0;
  const src = thumb ? fileUrl(campaign.id, `deliverables/${step.id}/${thumb}`) + `?v=${step.endedAt}` : '';
  return (
    <button className={`result s-${step.status}`} onClick={onOpen} aria-label={`${name}: ${step.status}`}>
      <div className="result-art" style={{ aspectRatio: String(Math.max(ratio, 0.8)) }}>
        {step.status === 'done' && thumb && <img className="fg" src={src} alt="" loading="lazy" />}
        {step.status === 'done' && !thumb && <CopyPreview campaign={campaign} step={step} />}
        {step.status === 'done' && isVideo && <span className="play"><PlayIcon /></span>}
        {step.status === 'running' && (
          <div className="working">
            <b>{step.phase ?? 'Working'}…</b>
            <span className="tnum">{fmtDuration(elapsed)}</span>
          </div>
        )}
        {step.status === 'queued' && <div className="waiting">{step.renderOnly ? 'Re-rendering soon' : 'Up next'}</div>}
        {step.status === 'blocked' && <div className="waiting">Starts after research</div>}
        {step.status === 'needs-input' && <div className="waiting ask-wait">Waiting for your answer above</div>}
        {step.status === 'canceled' && <div className="waiting">Stopped</div>}
        {step.status === 'failed' && (
          <div className="failed">
            <b>Didn't work this time</b>
            <span
              role="button"
              tabIndex={0}
              className="btn sm"
              onClick={(e) => {
                e.stopPropagation();
                onRetry();
              }}
            >
              Try again
            </span>
          </div>
        )}
      </div>
      <div className="result-meta">
        <h3>{step.options._title ?? name}</h3>
        <p>{step.options._title && step.status !== 'running' ? `${name} · ` : ''}{step.status === 'done' ? (step.revisions.length ? `Revised ${step.revisions.length}×` : 'Ready') : step.status === 'running' ? 'Making it now' : step.status === 'queued' ? 'Queued' : ''}</p>
      </div>
    </button>
  );
}


/** A step paused with a question from Claude: answer here and it picks up where it stopped. */
function NeedsInput({ campaign, step, packName, onChange }: { campaign: C; step: Step; packName: string; onChange: (c: C) => void }) {
  const q = step.question!;
  const [values, setValues] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      onChange(await api.answer(campaign.id, step.id, values, note));
      toast('Thanks — picking up where it stopped');
    } catch (e) {
      toast(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  const filled = Object.values(values).some((v) => v.trim()) || note.trim();
  return (
    <form className="ask-card" onSubmit={(e) => { e.preventDefault(); if (filled) send(); }}>
      <div className="ask-head">
        <span className="ask-badge">Needs you</span>
        <span className="muted">{packName} paused</span>
      </div>
      <h3>{q.text}</h3>
      {q.why && <p className="ask-why">{q.why}</p>}
      <div className="ask-fields">
        {q.fields.map((f) => (
          <label key={f.key} className="field">
            <span>{f.label}{f.secret && <small className="muted"> · stays on this computer, never shown again</small>}</span>
            <input className="input" type={f.secret ? 'password' : 'text'} autoComplete="off" placeholder={f.placeholder ?? (f.secret ? f.key : '')} value={values[f.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
          </label>
        ))}
        <label className="field">
          <span>Anything else Claude should know? <small className="muted">(optional)</small></span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. “skip payments, use the demo plan”" />
        </label>
      </div>
      <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
        <button className="btn primary" disabled={!filled || busy}>{busy ? 'Sending…' : 'Send and continue'}</button>
      </div>
    </form>
  );
}

export function Campaign({ id }: { id: string }) {
  const { campaign, events, gone, setCampaign } = useCampaign(id);
  const packs = useLoad(() => api.packs());
  const packMap = useMemo(() => new Map((packs.data ?? []).map((p) => [p.id, p])), [packs.data]);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const live = campaign?.steps.some((s) => s.status === 'running' || s.status === 'queued') ?? false;
  const now = useNow(live);
  const upload = useRef<HTMLInputElement>(null);

  if (gone)
    return (
      <main className="page narrow">
        <div className="empty">
          <h3>This project was deleted</h3>
          <a className="btn" href="#/library">Back to your projects</a>
        </div>
      </main>
    );
  if (!campaign) return <main className="page"><p className="muted">Loading…</p></main>;

  const brief = campaign.steps.find((s) => s.kind === 'brief')!;
  const items = campaign.steps.filter((s) => s.kind === 'pack');
  const ready = items.filter((s) => s.status === 'done').length;
  const failed = items.filter((s) => s.status === 'failed').length;
  const idx = items.findIndex((s) => s.id === open);
  const openStep = idx >= 0 ? items[idx] : undefined;

  const act = async (fn: () => Promise<C>, msg?: string) => {
    try {
      setCampaign(await fn());
      if (msg) toast(msg);
    } catch (e) {
      toast(String((e as Error).message));
    }
  };

  const asking = campaign.steps.some((s) => s.status === 'needs-input');
  const summary = asking
    ? 'Paused — Claude needs one thing from you (below), then it carries on.'
    : live
    ? brief.status !== 'done'
      ? 'Researching first — everything else builds on it.'
      : `${ready} of ${items.length} ready. The rest appear here as they finish.`
    : failed
      ? `${ready} ready, ${failed} didn't work — open it to try again.`
      : `All ${ready} ready. Click one to preview, copy the post and download.`;

  return (
    <main className="page">
      <a className="back" href="#/library">← Projects</a>
      <div className="camp-head">
        <div>
          <h1>{campaign.name}</h1>
          <p>{campaign.source.type === 'text' ? 'From your description' : campaign.source.value.replace(/^https?:\/\//, '')} · {relTime(campaign.createdAt)}</p>
        </div>
        <div className="actions">
          {ready > 0 && <a className="btn primary" href={`/api/campaigns/${id}/export`}>Download all</a>}
          <details className="menu">
            <summary className="btn ghost icon-btn" aria-label="More actions">⋯</summary>
            <div className="menu-pop">
              <button onClick={() => api.reveal(id)}>Open folder</button>
              <button onClick={() => upload.current?.click()}>Upload a clip or images</button>
              <button
                className="danger"
                onClick={async () => {
                  if (!confirm(`Delete "${campaign.name}" and all its files?`)) return;
                  try {
                    await api.deleteCampaign(id);
                    go('/library');
                  } catch (e) {
                    toast(String((e as Error).message));
                  }
                }}
              >
                Delete project
              </button>
            </div>
          </details>
        </div>
      </div>

      <p className="summary" aria-live="polite">{live && <i className="dot live" />}{summary}</p>

      {campaign.steps.filter((s) => s.status === 'needs-input' && s.question).map((s) => (
        <NeedsInput key={s.id} campaign={campaign} step={s} packName={(packMap.get(s.pack!)?.name ?? 'This step')} onChange={setCampaign} />
      ))}

      {campaign.steps.filter((s) => s.pack === 'campaign-hub' && s.status === 'done').slice(-1).map((s) => {
        const index = s.outputs.find((o) => /-campaign\/index\.html$/.test(o));
        const zip = s.outputs.find((o) => o.endsWith('.zip'));
        return (
          <div key={s.id} className="hub-ready">
            <div>
              <b>Your campaign is ready</b>
              <span>Every video, carousel, post, caption and the calendar in one folder — it works offline.</span>
            </div>
            <div className="row-actions">
              {index && <a className="btn primary" href={fileUrl(campaign.id, `deliverables/${s.id}/${index}`)} target="_blank" rel="noreferrer">Open the campaign</a>}
              {zip && <a className="btn" href={`${fileUrl(campaign.id, `deliverables/${s.id}/${zip}`)}?download`}>Download zip</a>}
            </div>
          </div>
        );
      })}

      <BriefStrip campaign={campaign} step={brief} />
      {brief.status === 'failed' && (
        <div className="banner">
          Research didn't finish: {brief.error}{' '}
          <button className="btn sm" onClick={() => act(() => api.retry(id, 'brief'), 'Trying again')}>Try again</button>
        </div>
      )}

      <div className="results">
        {items.map((s) => (
          <ResultCard key={s.id} campaign={campaign} step={s} pack={packMap.get(s.pack!)} now={now} onOpen={() => setOpen(s.id)} onRetry={() => act(() => api.retry(id, s.id), 'Trying again')} />
        ))}
        <button className="result add" onClick={() => setAdding(true)}>
          <span className="add-result"><b>+</b>Make something else<small>Uses the same research</small></span>
        </button>
      </div>

      <input
        ref={upload}
        type="file"
        hidden
        multiple
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          try {
            for (const f of files) await api.upload(id, f);
            toast(`Uploaded ${files.length} file${files.length > 1 ? 's' : ''}`);
          } catch (err) {
            toast(String((err as Error).message));
          }
          e.target.value = '';
        }}
      />

      {openStep && (
        <Lightbox
          campaign={campaign}
          step={openStep}
          pack={packMap.get(openStep.pack!)}
          events={events}
          onClose={() => setOpen(null)}
          onChange={setCampaign}
          onPrev={idx > 0 ? () => setOpen(items[idx - 1].id) : undefined}
          onNext={idx < items.length - 1 ? () => setOpen(items[idx + 1].id) : undefined}
        />
      )}
      {adding && <AddMore packs={packs.data ?? []} campaign={campaign} onClose={() => setAdding(false)} onAdd={(p, o) => { setAdding(false); act(() => api.addStep(id, p.id, o), `${p.name} added`); }} />}
    </main>
  );
}

function AddMore({ packs, campaign, onClose, onAdd }: { packs: Pack[]; campaign: C; onClose: () => void; onAdd: (p: Pack, o: Record<string, string>) => void }) {
  const usable = packs.filter((p) => ((!p.sources.length || p.sources.includes(campaign.source.type)) && isStudio(p)) || p.category === 'copy');
  const ordered = [...usable].sort((a, b) => {
    const ia = FORMATS.findIndex((f) => f.id === a.id), ib = FORMATS.findIndex((f) => f.id === b.id);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const [pick, setPick] = useState<Pack | null>(null);
  const [opts, setOpts] = useState<Record<string, string>>({});
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Make something else">
      <div className="lb-scrim" onClick={onClose} />
      <div className="modal-card">
        <header className="lb-head">
          <div>
            <h2>{pick ? pick.name.replace(/ · (freeform|brag)$/, '') : 'Make something else'}</h2>
            <p>{pick ? (PLAIN[pick.id] ?? pick.tagline) : 'Uses the research you already have.'}</p>
          </div>
          <button className="btn ghost icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        {!pick ? (
          <div className="add-grid">
            {ordered.map((p) => {
              const f = FORMATS.find((x) => x.id === p.id);
              return (
                <button key={p.id} className="add-item" onClick={() => (p.options.length ? setPick(p) : onAdd(p, {}))}>
                  {f?.img ? <img src={f.img} alt="" /> : <span className="add-ph" />}
                  <span>
                    <b>{f?.title ?? p.name.replace(/ · (freeform|brag)$/, '')}</b>
                    <small>{PLAIN[p.id] ?? p.tagline}</small>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="add-opts">
            {pick.options.map((o) => <OptionInput key={o.key} field={o} value={opts[o.key] ?? o.default} onChange={(v) => setOpts({ ...opts, [o.key]: v })} />)}
            <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
              <button className="btn ghost" onClick={() => setPick(null)}>Back</button>
              <button className="btn primary" onClick={() => onAdd(pick, opts)}>Make it</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
