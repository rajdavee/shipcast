import { useEffect, useMemo, useRef, useState } from 'react';
import { api, fileUrl, fmtDuration, type Campaign as C, type CampaignEvent, type Pack, type Step } from '../api.ts';
import { go, toast, useLoad } from '../hooks.ts';
import { PLAIN, isStudio, relTime, shape } from '../formats.ts';
import { ResultDrawer } from '../components/ResultDrawer.tsx';
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

function BriefCard({ campaign, step }: { campaign: C; step: Step }) {
  const has = (f: string) => step.outputs.includes(f);
  const brand = useLoad<Brand | null>(() => (has('brand.json') ? fetch(fileUrl(campaign.id, 'brief/brand.json') + `?v=${step.endedAt}`).then((r) => r.json()) : Promise.resolve(null)), [step.endedAt]);
  const shots = step.outputs.filter((o) => /^assets\/.*\.(png|jpe?g|webp)$/i.test(o) && !/favicon|icon|logo|wordmark|\.pdf\./i.test(o)).slice(0, 3);
  const colors = Object.values(brand.data?.colors ?? {}).filter((v) => /^#[0-9a-f]{3,8}$/i.test(v)).slice(0, 6);
  const source = campaign.source.type === 'text' ? 'your description' : campaign.source.value.replace(/^https?:\/\//, '');

  if (step.status === 'running' || step.status === 'queued')
    return (
      <div className="card brief-card" style={{ position: 'relative', overflow: 'hidden', minHeight: 110 }}>
        <div className="working" style={{ placeContent: 'center start', paddingLeft: 20, textAlign: 'left' }}>
          <b>Studying {source}</b>
          <span>Reading the product, collecting its colors, fonts, logo and screenshots…</span>
        </div>
      </div>
    );
  if (step.status !== 'done') return null;
  return (
    <div className="card brief-card">
      <div>
        <h3>What we learned about {brand.data?.name ?? source}</h3>
        <p className="line">{brand.data?.oneLiner ?? 'Research complete.'}</p>
        <div className="brand-row">
          {brand.data?.logo && has(brand.data.logo) && <img className="blogo" src={fileUrl(campaign.id, `brief/${brand.data.logo}`)} alt="" />}
          {colors.length > 0 && (
            <span className="chips" title="Brand colors">
              {colors.map((c, i) => <i key={i} style={{ background: c }} />)}
            </span>
          )}
          <a className="btn ghost sm" href={fileUrl(campaign.id, 'brief/brief.md')} target="_blank" rel="noreferrer">Read the brief</a>
        </div>
      </div>
      {shots.length > 0 && (
        <div className="shots">
          {shots.map((s) => <img key={s} src={fileUrl(campaign.id, `brief/${s}`)} alt="" loading="lazy" />)}
        </div>
      )}
    </div>
  );
}

const PlayIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg>
);

function thumbOf(step: Step): string | null {
  const order = [/(^|\/)(video|captioned)\.jpg$/, /slide-01\.png$/, /youtube-[a-z]?\.?(jpg|png)$/i, /og-card\.png$/];
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
  const isVideo = step.outputs.some((o) => o.endsWith('.mp4'));
  const name = (pack?.name ?? step.pack ?? '').replace(/ · (freeform|brag)$/, '');
  const elapsed = step.startedAt ? now - Date.parse(step.startedAt) : 0;
  const meta =
    step.status === 'done' ? (isVideo ? 'Video' : pack?.category === 'copy' ? 'Text' : `${step.outputs.filter((o) => /\.(png|jpe?g)$/.test(o) && !o.includes('sheet')).length} images`) : step.status === 'running' ? fmtDuration(elapsed) : '';
  return (
    <button className="result" onClick={onOpen} aria-label={`${name}: ${step.status}`}>
      <div className="result-art">
        {step.status === 'done' && thumb && (
          <>
            <img className="backdrop" src={fileUrl(campaign.id, `deliverables/${step.id}/${thumb}`) + `?v=${step.endedAt}`} alt="" aria-hidden="true" loading="lazy" />
            <img className="fg" src={fileUrl(campaign.id, `deliverables/${step.id}/${thumb}`) + `?v=${step.endedAt}`} alt="" loading="lazy" />
          </>
        )}
        {step.status !== 'done' && <span className="ghost-shape" style={{ aspectRatio: String(ratio) }} aria-hidden="true" />}
        {step.status === 'done' && !thumb && <CopyPreview campaign={campaign} step={step} />}
        {step.status === 'done' && isVideo && <span className="play"><PlayIcon /></span>}
        {step.status === 'running' && (
          <div className="working">
            <b>{step.phase ?? 'Working'}…</b>
            <span>{step.renderOnly ? 'Re-rendering your edits' : 'This updates live'}</span>
          </div>
        )}
        {step.status === 'queued' && <div className="waiting">{step.renderOnly ? 'Re-rendering soon' : 'Up next'}</div>}
        {step.status === 'blocked' && <div className="waiting">Waiting for research</div>}
        {step.status === 'canceled' && <div className="waiting">Stopped</div>}
        {step.status === 'failed' && (
          <div className="failed">
            <b>Didn't work this time</b>
            <span
              role="button"
              tabIndex={0}
              className="btn sm"
              style={{ marginTop: 8 }}
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
        <div>
          <h3>{name}</h3>
          <p>{step.status === 'done' ? (step.revisions.length ? `Revised ${step.revisions.length}×` : PLAIN[step.pack ?? ''] ?? pack?.tagline) : step.status === 'running' ? 'In progress' : ''}</p>
        </div>
        {meta && <span className="tag tnum">{meta}</span>}
      </div>
    </button>
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
          <a className="btn" href="#/library">Back to the library</a>
        </div>
      </main>
    );
  if (!campaign) return <main className="page"><p className="muted">Loading…</p></main>;

  const brief = campaign.steps.find((s) => s.kind === 'brief')!;
  const items = campaign.steps.filter((s) => s.kind === 'pack');
  const total = campaign.steps.length;
  const done = campaign.steps.filter((s) => s.status === 'done').length;
  const running = campaign.steps.find((s) => s.status === 'running');
  const runningName = running ? (running.kind === 'brief' ? 'Research' : (packMap.get(running.pack!)?.name ?? running.pack)) : '';
  const failed = campaign.steps.filter((s) => s.status === 'failed').length;
  const openStep = campaign.steps.find((s) => s.id === open);

  const act = async (fn: () => Promise<C>, msg?: string) => {
    try {
      setCampaign(await fn());
      if (msg) toast(msg);
    } catch (e) {
      toast(String((e as Error).message));
    }
  };

  return (
    <main className="page">
      <div className="camp-head">
        <div>
          <h1>{campaign.name}</h1>
          <p>{campaign.source.type === 'text' ? 'From your description' : campaign.source.value} · started {relTime(campaign.createdAt)}</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => setAdding(true)}>Add more</button>
          {done > (brief.status === 'done' ? 1 : 0) ? <a className="btn" href={`/api/campaigns/${id}/export`}>Download all</a> : <button className="btn" disabled title="Nothing is ready yet">Download all</button>}
          <button className="btn ghost" onClick={() => api.reveal(id)}>Open folder</button>
        </div>
      </div>

      <div className="progress" aria-live="polite">
        <div className="progress-bar"><i style={{ width: `${Math.round((done / total) * 100)}%` }} /></div>
        <div className="progress-text">
          <span>
            {running ? (running.kind === 'brief' ? <><b>{running.phase ?? 'Researching'}…</b></> : <><b>{runningName}</b> · {(running.phase ?? 'working').toLowerCase()}…</>) : live ? 'Starting the next one…' : failed ? `Finished — ${failed} didn't work, you can try again.` : 'All done. Click anything to preview, edit or download.'}
          </span>
          <span className="tnum muted">{done} of {total}</span>
        </div>
      </div>

      <BriefCard campaign={campaign} step={brief} />
      {brief.status === 'failed' && (
        <div className="banner" style={{ marginTop: 14 }}>
          Research didn't finish: {brief.error}{' '}
          <button className="btn sm" onClick={() => act(() => api.retry(id, 'brief'), 'Trying again')}>Try again</button>
        </div>
      )}

      <div className="results">
        {items.map((s) => (
          <ResultCard key={s.id} campaign={campaign} step={s} pack={packMap.get(s.pack!)} now={now} onOpen={() => setOpen(s.id)} onRetry={() => act(() => api.retry(id, s.id), 'Trying again')} />
        ))}
        <button className="result" onClick={() => setAdding(true)}>
          <span className="add-result">+ Add more</span>
        </button>
      </div>

      <div style={{ marginTop: 48, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
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
        <button className="btn ghost sm" onClick={() => upload.current?.click()}>Upload a clip or images</button>
        <button
          className="btn ghost sm danger"
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

      {openStep && (
        <ResultDrawer campaign={campaign} step={openStep} pack={packMap.get(openStep.pack!)} events={events} onClose={() => setOpen(null)} onChange={setCampaign} />
      )}
      {adding && <AddMore packs={packs.data ?? []} campaign={campaign} onClose={() => setAdding(false)} onAdd={(p, o) => { setAdding(false); act(() => api.addStep(id, p.id, o), `${p.name} added`); }} />}
    </main>
  );
}

function AddMore({ packs, campaign, onClose, onAdd }: { packs: Pack[]; campaign: C; onClose: () => void; onAdd: (p: Pack, o: Record<string, string>) => void }) {
  const usable = packs.filter((p) => (!p.sources.length || p.sources.includes(campaign.source.type)) && isStudio(p) || p.category === 'copy');
  const [pick, setPick] = useState<Pack | null>(null);
  const [opts, setOpts] = useState<Record<string, string>>({});
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer" style={{ width: 'min(560px, 100vw)' }} role="dialog" aria-modal="true" aria-label="Add more">
        <div className="drawer-head">
          <div>
            <h2>{pick ? pick.name : 'Add more'}</h2>
            <p>{pick ? (PLAIN[pick.id] ?? pick.tagline) : 'Uses the research you already have — no need to start over.'}</p>
          </div>
          <button className="btn ghost icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div />
        <div className="drawer-body">
          {!pick ? (
            <div style={{ display: 'grid', gap: 8 }}>
              {usable.map((p) => (
                <button key={p.id} className="fmt" style={{ gridTemplateColumns: '1fr' }} onClick={() => setPick(p)}>
                  <span>
                    <b>{p.name.replace(/ · (freeform|brag)$/, '')}</b>
                    <small>{PLAIN[p.id] ?? p.tagline}</small>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <>
              {pick.options.map((o) => <OptionInput key={o.key} field={o} value={opts[o.key] ?? o.default} onChange={(v) => setOpts({ ...opts, [o.key]: v })} />)}
              <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                <button className="btn ghost" onClick={() => setPick(null)}>Back</button>
                <button className="btn primary" onClick={() => onAdd(pick, opts)}>Make it</button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
