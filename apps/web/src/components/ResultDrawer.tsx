import { useEffect, useRef, useState } from 'react';
import { api, fileUrl, fmtDuration, type Campaign, type CampaignEvent, type Pack, type Step } from '../api.ts';
import { toast, useLoad } from '../hooks.ts';
import { OutputViewer } from './OutputViewer.tsx';
import { SpecEditor } from './SpecEditor.tsx';

type Tab = 'preview' | 'edit' | 'checks' | 'activity';

/** The one file someone most likely wants to download. */
function mainFile(step: Step): string | undefined {
  return step.outputs.find((o) => /(video|captioned|carousel)\.mp4$/.test(o)) ?? step.outputs.find((o) => o.endsWith('infographic.gif')) ?? step.outputs.find((o) => o.endsWith('carousel.pdf')) ?? step.outputs.find((o) => o.endsWith('.mp4')) ?? step.outputs.find((o) => /copy\.md$/.test(o));
}

export function ResultDrawer({ campaign, step, pack, events, onClose, onChange }: { campaign: Campaign; step: Step; pack?: Pack; events: CampaignEvent[]; onClose: () => void; onChange: (c: Campaign) => void }) {
  const [tab, setTab] = useState<Tab>('preview');
  const [note, setNote] = useState('');
  const tree = useLoad(() => api.tree(campaign.id), [campaign.id]);
  const images = (tree.data?.brief ?? []).filter((f) => f.startsWith('assets/') && /\.(png|jpe?g|webp|gif|svg)$/i.test(f));
  const name = (pack?.name ?? step.pack ?? 'Research').replace(/ · (freeform|brag)$/, '');
  const hasQa = step.outputs.some((o) => o.endsWith('qa.json'));
  const main = mainFile(step);
  const ask = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);

  const act = async (fn: () => Promise<Campaign>, msg: string) => {
    try {
      onChange(await fn());
      toast(msg);
    } catch (e) {
      toast(String((e as Error).message));
    }
  };

  const busy = step.status === 'running' || step.status === 'queued';
  const tabs: [Tab, string][] = [['preview', 'Preview'], ...(pack?.spec && pack.spec !== 'infographic' && step.outputs.length ? [['edit', pack.spec === 'deck' ? 'Edit slides' : pack.spec === 'graphics' ? 'Edit graphics' : 'Edit scenes'] as [Tab, string]] : []), ...(hasQa ? [['checks', 'Quality checks'] as [Tab, string]] : []), ['activity', 'Activity']];

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={name}>
        <div className="drawer-head">
          <div>
            <h2>{name}</h2>
            <p>
              {step.status === 'done' ? `Ready${step.durationMs ? ` · made in ${fmtDuration(step.durationMs)}` : ''}${step.revisions.length ? ` · revised ${step.revisions.length}×` : ''}` : step.status === 'running' ? `${step.phase ?? 'Working'}…` : step.status === 'queued' ? 'Up next' : step.status === 'failed' ? "Didn't work this time" : step.status}
            </p>
          </div>
          <div className="row-actions">
            {main && step.status === 'done' && (
              <a className="btn primary" href={fileUrl(campaign.id, `deliverables/${step.id}/${main}`) + '?download'} download>
                Download
              </a>
            )}
            {step.status === 'running' && <button className="btn danger" disabled={step.cancelRequested} onClick={() => act(() => api.cancel(campaign.id, step.id), 'Stopping…')}>Stop</button>}
            {(step.status === 'done' || step.status === 'failed' || step.status === 'canceled') && (
              <button className="btn" onClick={() => act(() => api.retry(campaign.id, step.id), 'Making a fresh version')} title="Start this one over from scratch">
                New version
              </button>
            )}
            <button className="btn ghost icon-btn" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>
        <div className="drawer-tabs" role="tablist">
          {tabs.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
        <div className="drawer-body">
          {step.status === 'failed' && step.error && <div className="banner">{step.error}</div>}

          {tab === 'preview' && (
            <>
              <OutputViewer campaign={campaign} step={step} events={events} />
              {(step.status === 'done' || step.status === 'failed') && (
                <form
                  className="ask"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!note.trim()) return;
                    act(() => api.revise(campaign.id, step.id, note.trim()), 'Got it — working on your changes');
                    setNote('');
                  }}
                >
                  <textarea
                    ref={ask}
                    rows={1}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        (e.currentTarget.form as HTMLFormElement).requestSubmit();
                      }
                    }}
                    placeholder={step.kind === 'brief' ? 'Anything we got wrong? E.g. “The audience is CTOs, not founders.”' : 'Ask for changes… e.g. “punchier hook”, “use the dark logo”, “slower on the chart”'}
                    aria-label="Ask for changes"
                  />
                  <button className="btn primary" disabled={!note.trim() || busy}>Send</button>
                </form>
              )}
            </>
          )}

          {tab === 'edit' && pack?.spec && pack.spec !== 'infographic' && <SpecEditor campaign={campaign} step={step} kind={pack.spec} images={images} onSaved={(c) => { onChange(c); setTab('preview'); }} />}

          {tab === 'checks' && <QualityReport campaign={campaign} step={step} />}

          {tab === 'activity' && <Notes campaign={campaign} step={step} />}
          {tab === 'activity' && (
            <div className="activity">
              {events.filter((e) => e.step === step.id && e.type !== 'result').map((e, i) => (
                <div key={i} className={`t-${e.type}`}>
                  <time>{new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                  <span>{e.type === 'tool' ? `${e.tool}: ` : ''}{e.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function QualityReport({ campaign, step }: { campaign: Campaign; step: Step }) {
  const f = step.outputs.find((o) => o.endsWith('qa.json'));
  const qa = useLoad(() => (f ? fetch(fileUrl(campaign.id, `deliverables/${step.id}/${f}`) + `?v=${step.endedAt}`).then((r) => r.json()) : Promise.resolve(null)), [step.id, step.endedAt]);
  const r = qa.data as null | { pass: boolean; issues: { rule: string; severity: string; message: string; fix?: string }[]; facts: any };
  if (!r) return <p className="muted">Loading…</p>;
  const loud = r.facts?.loudness;
  const v = r.facts?.probe?.video;
  const blocking = r.issues.filter((i) => i.severity === 'error');
  return (
    <div className="qa-list">
      <div className={`banner ${r.pass ? 'info' : ''}`}>
        {r.pass ? 'Passed every blocking check.' : `${blocking.length} problem${blocking.length > 1 ? 's' : ''} to look at.`}{' '}
        {v ? `${v.width}×${v.height} · ${v.fps} fps · ${r.facts.probe.duration.toFixed(1)} s` : ''}
        {loud ? ` · ${loud.integrated.toFixed(1)} LUFS (target −14)` : ''}
      </div>
      {r.issues.length === 0 && <p className="muted">Right size and codec, mastered loudness, nothing hidden behind platform buttons, no black or frozen moments.</p>}
      {r.issues.map((i, k) => (
        <div key={k} className={`qa-row ${i.severity}`}>
          <b>{i.severity === 'error' ? 'Fix' : i.severity === 'warn' ? 'Note' : 'Info'}</b>
          <span>{i.message}{i.fix ? <span className="muted"> — {i.fix}</span> : null}</span>
        </div>
      ))}
    </div>
  );
}

/** Claude's notes for this item, shown as plain text (markdown markers stripped). */
function Notes({ campaign, step }: { campaign: Campaign; step: Step }) {
  const f = step.outputs.find((o) => o.endsWith('NOTES.md'));
  const text = useLoad(() => (f ? fetch(fileUrl(campaign.id, `deliverables/${step.id}/${f}`) + `?v=${step.endedAt}`).then((r) => r.text()) : Promise.resolve('')), [step.id, step.endedAt]);
  if (!text.data) return null;
  const clean = text.data
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '• ');
  return (
    <div className="doc">
      <div className="copy-head" style={{ marginBottom: 10 }}>
        <h4>Notes from Claude</h4>
      </div>
      <pre>{clean}</pre>
    </div>
  );
}
