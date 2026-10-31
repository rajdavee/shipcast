import { useEffect, useMemo, useRef, useState } from 'react';
import { api, fmtDuration, type Campaign, type CampaignEvent, type Pack, type Step } from '../api.ts';
import { go, toast, useLoad } from '../hooks.ts';
import { PackFrame } from '../components/PackFrame.tsx';
import { OutputViewer } from '../components/OutputViewer.tsx';
import { OptionInput } from '../components/OptionInput.tsx';
import { SpecEditor } from '../components/SpecEditor.tsx';
import { fileUrl } from '../api.ts';

const STATUS_TEXT: Record<Step['status'], string> = {
  queued: 'Queued',
  running: 'Making it now',
  done: 'Ready',
  failed: 'Failed',
  canceled: 'Stopped',
  blocked: 'Waiting on the brief',
};

/** Live campaign state + event log over one SSE connection. */
function useCampaignStream(id: string) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [events, setEvents] = useState<CampaignEvent[]>([]);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    setEvents([]);
    setCampaign(null);
    const es = new EventSource(`/api/campaigns/${id}/events`);
    es.addEventListener('campaign', (e) => setCampaign(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('log', (e) => setEvents((xs) => [...xs.slice(-1500), JSON.parse((e as MessageEvent).data)]));
    es.onerror = () => api.campaign(id).catch(() => setGone(true));
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

export function CampaignView({ id }: { id: string }) {
  const { campaign, events, gone, setCampaign } = useCampaignStream(id);
  const packs = useLoad(() => api.packs());
  const packMap = useMemo(() => new Map((packs.data ?? []).map((p) => [p.id, p])), [packs.data]);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<'result' | 'edit' | 'quality'>('result');
  const tree = useLoad(() => api.tree(id), [id]);
  useEffect(() => setTab('result'), [selected]);
  const images = (tree.data?.brief ?? []).filter((f) => f.startsWith('assets/') && /\.(png|jpe?g|webp|gif|svg)$/i.test(f));
  const running = campaign?.steps.some((s) => s.status === 'running') ?? false;
  const now = useNow(running);

  // Follow the action: select the running step unless the user picked one.
  const userPicked = useRef(false);
  useEffect(() => {
    if (!campaign || userPicked.current) return;
    const live = campaign.steps.find((s) => s.status === 'running');
    const firstDone = campaign.steps.find((s) => s.kind === 'pack' && s.status === 'done');
    setSelected((live ?? firstDone ?? campaign.steps[0]).id);
  }, [campaign]);

  if (gone) {
    return (
      <div className="empty">
        <h3>This campaign doesn't exist anymore</h3>
        <a className="btn" href="#/campaigns">Back to campaigns</a>
      </div>
    );
  }
  if (!campaign) return <p className="hint">Loading…</p>;

  const step = campaign.steps.find((s) => s.id === selected) ?? campaign.steps[0];
  const pack = step.pack ? packMap.get(step.pack) : undefined;
  const elapsed = (s: Step) => (s.status === 'running' && s.startedAt ? now - Date.parse(s.startedAt) : s.durationMs);
  const totalCost = campaign.steps.reduce((a, s) => a + (s.costUsd ?? 0), 0);

  const act = async (fn: () => Promise<Campaign>, msg?: string) => {
    try {
      setCampaign(await fn());
      if (msg) toast(msg);
    } catch (e) {
      toast(String((e as Error).message));
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="run-title">{campaign.name}</h1>
          <p className="run-source">
            {campaign.source.type === 'text' ? 'Written brief' : campaign.source.value}
            {campaign.goal ? ` · ${campaign.goal}` : ''}
          </p>
        </div>
        <div className="sheet-actions" style={{ marginTop: 0 }}>
          <a className="btn small" href={`/api/campaigns/${id}/export`}>Download all</a>
          <button className="btn small" onClick={() => api.reveal(id)}>Open folder</button>
        </div>
      </div>

      <div className="run">
        <aside className="sheet" aria-label="Run sheet">
          {campaign.steps.map((s, i) => {
            const p = s.pack ? packMap.get(s.pack) : undefined;
            return (
              <div key={s.id}>
                {i > 0 && <div className="cue-line" />}
                <button
                  className="cue"
                  aria-current={s.id === step.id}
                  onClick={() => {
                    userPicked.current = true;
                    setSelected(s.id);
                  }}
                >
                  <i className={`status-dot ${s.status}`} />
                  <span>
                    <span className="cue-name">{s.kind === 'brief' ? 'Research & brief' : (p?.name ?? s.pack)}</span>
                    <br />
                    <span className="cue-sub">
                      {STATUS_TEXT[s.status]}
                      {s.revisions.length ? ` · ${s.revisions.length} revision${s.revisions.length > 1 ? 's' : ''}` : ''}
                    </span>
                  </span>
                  <span className="cue-time tnum">{s.status === 'queued' || s.status === 'blocked' ? '' : fmtDuration(elapsed(s))}</span>
                </button>
              </div>
            );
          })}
          <div className="sheet-actions">
            <button className="btn small" onClick={() => setAdding(true)}>Add a format</button>
            <UploadButton id={id} />
          </div>
          <p className="hint" style={{ marginTop: 14 }}>
            {totalCost > 0 ? `Usage so far ≈ $${totalCost.toFixed(2)} of API-equivalent value, billed to your Claude plan. ` : ''}
            <button
              className="btn ghost small"
              style={{ padding: 0, height: 'auto' }}
              onClick={async () => {
                if (!confirm(`Delete "${campaign.name}" and all its files?`)) return;
                try {
                  await api.deleteCampaign(id);
                  go('/campaigns');
                } catch (e) {
                  toast(String((e as Error).message));
                }
              }}
            >
              Delete campaign
            </button>
          </p>
        </aside>

        <section className="stage" aria-live="polite">
          <div className="stage-head">
            <h2 className="stage-title">
              <i className={`status-dot ${step.status}`} />
              {step.kind === 'brief' ? 'Research & brief' : (pack?.name ?? step.pack)}
            </h2>
            <div className="sheet-actions" style={{ marginTop: 0 }}>
              {step.status === 'running' && (
                <button className="btn small danger" disabled={step.cancelRequested} onClick={() => act(() => api.cancel(id, step.id), 'Stopping…')}>
                  {step.cancelRequested ? 'Stopping…' : 'Stop'}
                </button>
              )}
              {step.status === 'queued' && (
                <button className="btn small" onClick={() => act(() => api.cancel(id, step.id))}>Skip</button>
              )}
              {(step.status === 'failed' || step.status === 'canceled' || step.status === 'done') && (
                <button className="btn small" onClick={() => act(() => api.retry(id, step.id), 'Queued a fresh run')}>
                  {step.status === 'done' ? 'Make a new take' : 'Try again'}
                </button>
              )}
              {step.kind === 'pack' && step.status !== 'running' && (
                <button className="btn small ghost" onClick={() => act(() => api.removeStep(id, step.id))}>Remove</button>
              )}
            </div>
          </div>

          {step.status === 'failed' && step.error && <div className="banner">{step.error}</div>}
          {step.status === 'blocked' && <div className="banner info">This starts once the research & brief step succeeds.</div>}
          {step.pendingNote && step.status === 'queued' && <div className="banner info">Revision queued: “{step.pendingNote}”</div>}

          {pack?.spec && step.outputs.length > 0 && (
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'result'} onClick={() => setTab('result')}>Result</button>
              <button role="tab" aria-selected={tab === 'edit'} onClick={() => setTab('edit')}>Edit {pack.spec === 'deck' ? 'slides' : pack.spec === 'graphics' ? 'graphics' : 'scenes'}</button>
              {step.outputs.some((o) => o.endsWith('qa.json')) && <button role="tab" aria-selected={tab === 'quality'} onClick={() => setTab('quality')}>Quality checks</button>}
            </div>
          )}

          {pack?.spec && tab === 'edit' && step.outputs.length > 0 ? (
            <SpecEditor campaign={campaign} step={step} kind={pack.spec} images={images} onSaved={(c) => { setCampaign(c); setTab('result'); }} />
          ) : pack?.spec && tab === 'quality' ? (
            <QualityReport campaign={campaign} step={step} />
          ) : (
            <OutputViewer campaign={campaign} step={step} events={events} />
          )}

          {(step.status === 'done' || step.status === 'failed') && <Revise onSubmit={(note) => act(() => api.revise(id, step.id, note), 'Revision queued')} kind={step.kind} />}

          <Feed events={events.filter((e) => e.step === step.id)} live={step.status === 'running'} />
        </section>
      </div>

      {adding && (
        <AddFormat
          packs={packs.data ?? []}
          campaign={campaign}
          onClose={() => setAdding(false)}
          onAdd={async (p, opts) => {
            setAdding(false);
            await act(() => api.addStep(id, p.id, opts), `${p.name} added`);
          }}
        />
      )}
    </div>
  );
}

function QualityReport({ campaign, step }: { campaign: Campaign; step: Step }) {
  const f = step.outputs.find((o) => o.endsWith('qa.json'));
  const qa = useLoad(() => (f ? fetch(fileUrl(campaign.id, `deliverables/${step.id}/${f}`) + `?v=${step.endedAt}`).then((r) => r.json()) : Promise.resolve(null)), [step.id, step.endedAt]);
  const r = qa.data as null | { pass: boolean; issues: { rule: string; severity: string; message: string; fix?: string }[]; facts: any };
  if (!r) return <p className="hint">Loading…</p>;
  const loud = r.facts?.loudness;
  const v = r.facts?.probe?.video;
  return (
    <div className="qa">
      <div className={`banner ${r.pass ? 'info' : ''}`}>{r.pass ? 'Passed every blocking check.' : 'Some checks failed — see below.'} {v ? `${v.width}×${v.height} · ${v.fps} fps · ${v.codec} · ${r.facts.probe.duration.toFixed(1)} s` : ''}{loud ? ` · ${loud.integrated.toFixed(1)} LUFS · peak ${loud.truePeak.toFixed(1)} dBTP` : ''}</div>
      {r.issues.length === 0 && <p className="hint">No issues: safe size and codec, target loudness, no black or frozen stretches.</p>}
      {r.issues.map((i, k) => (
        <div key={k} className={`qa-row ${i.severity}`}>
          <b>{i.severity}</b>
          <span>{i.message}{i.fix ? <span className="hint"> — {i.fix}</span> : null}</span>
        </div>
      ))}
    </div>
  );
}

function Revise({ onSubmit, kind }: { onSubmit: (note: string) => void; kind: Step['kind'] }) {
  const [note, setNote] = useState('');
  return (
    <form
      className="revise"
      onSubmit={(e) => {
        e.preventDefault();
        if (note.trim()) onSubmit(note.trim());
        setNote('');
      }}
    >
      <label className="field" style={{ flex: 1 }}>
        <span>Ask for changes</span>
        <textarea
          className="textarea"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={kind === 'brief' ? 'Focus on the API, not the dashboard. Our audience is CTOs.' : 'Make the hook punchier, slow down scene 3, use the dark logo.'}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit();
          }}
        />
      </label>
      <button className="btn primary" disabled={!note.trim()}>Request changes</button>
    </form>
  );
}

function Feed({ events, live }: { events: CampaignEvent[]; live: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
  }, [events.length]);
  const shown = events.filter((e) => e.type !== 'result');
  return (
    <div className="feed">
      <div className="feed-head">
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {live && <i className="lamp live" />}
          What Claude is doing
        </span>
        <button className="btn ghost small" onClick={() => setOpen(!open)}>{open ? 'Hide' : `Show ${shown.length}`}</button>
      </div>
      {open && (
        <div className="feed-body" ref={ref}>
          {shown.length === 0 && <p className="hint" style={{ padding: '6px 16px' }}>Nothing yet.</p>}
          {shown.map((e, i) => (
            <div key={i} className={`line ${e.type}`}>
              <time className="tnum">{new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
              <span className="tag">{e.type === 'tool' ? e.tool : e.type === 'text' ? 'Claude' : e.type === 'status' ? (e.status ?? '') : e.type === 'tool_result' ? 'tool error' : e.type}</span>
              <span className="msg">{e.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UploadButton({ id }: { id: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input
        ref={input}
        type="file"
        hidden
        multiple
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          setBusy(true);
          try {
            for (const f of files) await api.upload(id, f);
            toast(`Uploaded ${files.length} file${files.length > 1 ? 's' : ''} — Claude can use them in any format`);
          } catch (err) {
            toast(String((err as Error).message));
          } finally {
            setBusy(false);
            e.target.value = '';
          }
        }}
      />
      <button className="btn small" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? 'Uploading…' : 'Upload media'}
      </button>
    </>
  );
}

function AddFormat({ packs, campaign, onClose, onAdd }: { packs: Pack[]; campaign: Campaign; onClose: () => void; onAdd: (p: Pack, o: Record<string, string>) => void }) {
  const usable = packs.filter((p) => !p.sources.length || p.sources.includes(campaign.source.type));
  const [pick, setPick] = useState<Pack | null>(null);
  const [opts, setOpts] = useState<Record<string, string>>({});
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Add a format" onClick={(e) => e.stopPropagation()}>
        <h2 className="section-title">{pick ? pick.name : 'Add a format'}</h2>
        {!pick ? (
          <div className="list">
            {usable.map((p) => (
              <button key={p.id} className="row" style={{ gridTemplateColumns: '56px 1fr', textAlign: 'left', cursor: 'pointer' }} onClick={() => setPick(p)}>
                <PackFrame pack={p} height={44} />
                <div>
                  <h3 style={{ fontSize: 15 }}>{p.name}</h3>
                  <p>{p.tagline}</p>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="opts" style={{ gridTemplateColumns: '1fr' }}>
              {pick.options.map((o) => (
                <OptionInput key={o.key} field={o} value={opts[o.key] ?? o.default} onChange={(v) => setOpts({ ...opts, [o.key]: v })} />
              ))}
            </div>
            <div className="sheet-actions" style={{ justifyContent: 'flex-end' }}>
              <button className="btn ghost" onClick={() => setPick(null)}>Back</button>
              <button className="btn primary" onClick={() => onAdd(pick, opts)}>Add to campaign</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

