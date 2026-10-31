import { fileUrl, type Campaign, type Step } from '../api.ts';
import { useLoad } from '../hooks.ts';

export function QualityReport({ campaign, step }: { campaign: Campaign; step: Step }) {
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
export function Notes({ campaign, step }: { campaign: Campaign; step: Step }) {
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
