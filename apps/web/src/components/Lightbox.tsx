import { useEffect, useMemo, useState } from 'react';
import { api, fileUrl, fmtDuration, type Campaign, type CampaignEvent, type Pack, type Step } from '../api.ts';
import { toast, useLoad } from '../hooks.ts';
import { CopyKit, Docs, MediaStage, isImage, isText, isVideo, useText } from './OutputViewer.tsx';
import { SpecEditor } from './SpecEditor.tsx';
import { useAccess } from '../session.ts';
import { Notes, QualityReport } from './StepDetails.tsx';

type Panel = 'post' | 'edit' | 'checks' | 'activity' | 'takes';

/** The one file someone most likely wants to download. */
export function mainFile(step: Step): string | undefined {
  const o = step.outputs;
  return (
    o.find((f) => f.endsWith('infographic.gif')) ??
    o.find((f) => /(video|captioned|carousel)\.mp4$/.test(f)) ??
    o.find((f) => f.endsWith('carousel.pdf')) ??
    o.find((f) => f.endsWith('.mp4')) ??
    o.find((f) => /copy\.md$/.test(f))
  );
}

/** The text that goes with the visual when it's posted. */
function postFile(step: Step): string | undefined {
  return step.outputs.find((f) => /(^|\/)post\.txt$/.test(f)) ?? step.outputs.find((f) => /caption\.md$|share-copy\.md$/.test(f));
}

const label = (f: string) => {
  const b = f.split('/').pop()!;
  if (b.endsWith('.gif')) return 'GIF';
  if (b.endsWith('.mp4')) return 'Video';
  if (b.endsWith('.pdf')) return 'PDF';
  if (b.endsWith('.png') || b.endsWith('.jpg')) return 'Image';
  return b;
};

export function Lightbox({ campaign, step, pack, events, onClose, onChange, onPrev, onNext }: { campaign: Campaign; step: Step; pack?: Pack; events: CampaignEvent[]; onClose: () => void; onChange: (c: Campaign) => void; onPrev?: () => void; onNext?: () => void }) {
  const [panel, setPanel] = useState<Panel>('post');
  // Viewers can look, copy and download; making, editing and choosing takes is for editors.
  const write = useAccess().write;
  const takes = useLoad(() => (step.status === 'done' ? api.takes(campaign.id, step.id) : Promise.resolve([])), [step.id, step.status, step.endedAt]);
  const [note, setNote] = useState('');
  const prefix = `deliverables/${step.id}/`;
  const version = step.endedAt ?? '';
  const url = (f: string) => fileUrl(campaign.id, f) + `?v=${encodeURIComponent(version)}`;
  const name = (pack?.name ?? step.pack ?? '').replace(/ · (freeform|brag)$/, '');
  const busy = step.status === 'running' || step.status === 'queued';
  const files = step.outputs.map((o) => prefix + o);
  const media = files.filter((f) => isVideo(f) || isImage(f));
  const copyJson = files.find((f) => f.endsWith('copy.json'));
  const docs = files.filter((f) => isText(f) && !f.endsWith('.srt') && !f.endsWith('NOTES.md'));
  const post = postFile(step);
  const postText = useText(post ? url(prefix + post) : null, version);
  const main = mainFile(step);
  const downloads = useMemo(() => files.filter((f) => /\.(gif|mp4|pdf|png|jpg|zip)$/.test(f) && !f.includes('.sheet.') && !/(video|captioned)\.jpg$/.test(f)), [files.join()]);
  const editable = write && !!pack?.spec && pack.spec !== 'infographic' && step.outputs.length > 0;
  const hasQa = step.outputs.some((o) => o.endsWith('qa.json'));
  const images = files.filter((f) => f.startsWith(prefix + 'assets/'));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('textarea,input,select')) return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') onPrev?.();
      if (e.key === 'ArrowRight') onNext?.();
    };
    addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose, onPrev, onNext]);

  const act = async (fn: () => Promise<Campaign>, msg: string) => {
    try {
      onChange(await fn());
      toast(msg);
    } catch (e) {
      toast(String((e as Error).message));
    }
  };

  const last = [...events].reverse().find((e) => e.step === step.id && (e.type === 'text' || e.type === 'log'));
  const statusLine =
    step.status === 'done'
      ? `Ready${step.durationMs ? ` · made in ${fmtDuration(step.durationMs)}` : ''}${step.revisions.length ? ` · revised ${step.revisions.length}×` : ''}`
      : step.status === 'running'
        ? `${step.phase ?? 'Working'}…`
        : step.status === 'queued'
          ? 'Up next'
          : step.status === 'failed'
            ? "Didn't work this time"
            : step.status;

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={name}>
      <div className="lb-scrim" onClick={onClose} />
      <div className={`lb-frame ${panel === 'edit' ? 'wide' : ''}`}>
        {panel !== 'edit' && (
          <section className="lb-stage">
            {media.length > 0 ? (
              <MediaStage files={media} url={url} />
            ) : copyJson ? (
              <div className="lb-copy"><CopyKit url={url(copyJson)} version={version} /></div>
            ) : docs.length > 0 ? (
              <div className="lb-copy"><Docs files={docs} url={url} /></div>
            ) : (
              <div className="lb-wait">
                <b>{statusLine}</b>
                {step.status === 'running' && last?.text && <span>{last.text.slice(0, 180)}</span>}
                {step.status === 'failed' && step.error && <span>{step.error}</span>}
              </div>
            )}
            {(onPrev || onNext) && (
              <div className="lb-nav">
                <button className="btn ghost icon-btn" onClick={onPrev} disabled={!onPrev} aria-label="Previous">‹</button>
                <button className="btn ghost icon-btn" onClick={onNext} disabled={!onNext} aria-label="Next">›</button>
              </div>
            )}
          </section>
        )}

        <aside className="lb-side">
          <header className="lb-head">
            <div>
              <h2>{name}</h2>
              <p>{statusLine}</p>
            </div>
            <button className="btn ghost icon-btn" onClick={onClose} aria-label="Close">✕</button>
          </header>

          {step.status === 'done' && (
            <div className="lb-actions">
              {main && <a className="btn primary" href={url(prefix + main) + '&download'} download>Download {label(main)}</a>}
              {postText && <button className="btn" onClick={() => navigator.clipboard.writeText(postText).then(() => toast('Post text copied'))}>Copy post text</button>}
              {write && step.pack === 'youtube-video' && <button className="btn" onClick={() => act(() => api.addStep(campaign.id, 'shorts', { source: step.id }), 'Cutting 3 Shorts from this video')}>Cut 3 Shorts</button>}
              {editable && step.status === 'done' && !['ad-set', 'landing', 'print', 'infographic', 'hook-variants'].includes(step.pack ?? '') && (
                <button className="btn" title="The same piece with 4 different openings, rendered side by side for an A/B test" onClick={() => act(() => api.variants(campaign.id, step.id, 4), 'Writing 4 hook variants')}>Hook variants</button>
              )}
              {write && step.status === 'done' && step.outputs.some((o) => /\.(mp4|png|jpe?g)$/.test(o)) && !['platform-export', 'hook-variants', 'campaign-hub'].includes(step.pack ?? '') && (
                <button className="btn" title="Re-cut for TikTok, Reels, Shorts, LinkedIn and X with captions and an upload checklist" onClick={() => act(() => api.addStep(campaign.id, 'platform-export', { source: step.id, platforms: 'tiktok,reels,shorts,linkedin,x' }), 'Exporting for each platform')}>Export for platforms</button>
              )}
            </div>
          )}

          <nav className="lb-tabs" aria-label="Details">
            <button aria-pressed={panel === 'post'} onClick={() => setPanel('post')}>{post ? 'Post' : 'Details'}</button>
            {editable && <button aria-pressed={panel === 'edit'} onClick={() => setPanel('edit')}>Edit</button>}
            {hasQa && <button aria-pressed={panel === 'checks'} onClick={() => setPanel('checks')}>Checks</button>}
            {!!takes.data?.length && <button aria-pressed={panel === 'takes'} onClick={() => setPanel('takes')}>Takes</button>}
            <button aria-pressed={panel === 'activity'} onClick={() => setPanel('activity')}>Activity</button>
          </nav>

          <div className="lb-body">
            {panel === 'post' && (
              <>
                {postText ? <div className="post-text">{postText}</div> : <Notes campaign={campaign} step={step} />}
                {downloads.length > 1 && (
                  <div className="files">
                    {downloads.map((f) => (
                      <a key={f} className="file" href={url(f) + '&download'} download>{f.split('/').pop()}</a>
                    ))}
                  </div>
                )}
              </>
            )}
            {panel === 'edit' && pack?.spec && pack.spec !== 'infographic' && <SpecEditor campaign={campaign} step={step} kind={pack.spec} images={images} onSaved={(c) => { onChange(c); setPanel('post'); }} />}
            {panel === 'checks' && <QualityReport campaign={campaign} step={step} />}
            {panel === 'takes' && (
              <div className="takes">
                <p className="muted">Generated shots with alternatives. Pick a take and the piece re-renders with it — no new Claude run.</p>
                {takes.data?.map((t) => (
                  <div key={t.id} className="take-row">
                    <h4>{t.label}</h4>
                    <div className="take-grid">
                      {t.posters.map((poster, k) => (
                        <button key={k} className={`take ${k === t.chosen ? 'on' : ''}`} aria-pressed={k === t.chosen} disabled={step.status !== 'done' || !write} onClick={() => act(() => api.chooseTake(campaign.id, step.id, t.id, k), `Take ${k + 1} chosen — re-rendering`)}>
                          <img src={fileUrl(campaign.id, poster)} alt={`Take ${k + 1}`} loading="lazy" />
                          <span>{k === t.chosen ? 'In use' : `Use take ${k + 1}`}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {panel === 'activity' && (
              <>
                <Notes campaign={campaign} step={step} />
                <div className="activity">
                  {events.filter((e) => e.step === step.id && e.type !== 'result').map((e, i) => (
                    <div key={i} className={`t-${e.type}`}>
                      <time>{new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                      <span>{e.type === 'tool' ? `${e.tool}: ` : ''}{e.text}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <footer className="lb-foot">
            {write && (step.status === 'done' || step.status === 'failed') && (
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
                  rows={1}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      (e.currentTarget.form as HTMLFormElement).requestSubmit();
                    }
                  }}
                  placeholder="Ask for changes…"
                  aria-label="Ask for changes"
                />
                <button className="btn primary sm" disabled={!note.trim() || busy}>Send</button>
              </form>
            )}
            {write && <div className="lb-more">
              {step.status === 'running' && <button className="linkish danger" disabled={step.cancelRequested} onClick={() => act(() => api.cancel(campaign.id, step.id), 'Stopping…')}>Stop</button>}
              {(step.status === 'done' || step.status === 'failed' || step.status === 'canceled') && (
                <button className="linkish" onClick={() => act(() => api.retry(campaign.id, step.id), 'Making a fresh version')}>Make a fresh version</button>
              )}
            </div>}

          </footer>
        </aside>
      </div>
    </div>
  );
}
