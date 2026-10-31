import { useEffect, useMemo, useState } from 'react';
import { fileUrl, type Campaign, type CampaignEvent, type Step } from '../api.ts';
import { toast } from '../hooks.ts';

const ext = (f: string) => f.split('.').pop()!.toLowerCase();
export const isVideo = (f: string) => ['mp4', 'webm', 'mov'].includes(ext(f));
export const isImage = (f: string) => ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext(f)) && !f.includes('.sheet.');
export const isText = (f: string) => ['md', 'txt', 'srt'].includes(ext(f));
const base = (f: string) => f.split('/').pop()!;

export function useText(url: string | null, version: string) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return setText(null);
    let on = true;
    fetch(url)
      .then((r) => (r.ok ? r.text() : null))
      .then((t) => on && setText(t));
    return () => {
      on = false;
    };
  }, [url, version]);
  return text;
}

const CHANNELS: Record<string, string> = { linkedin: 'LinkedIn', x: 'X', twitter: 'X', youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok', producthunt: 'Product Hunt', hackernews: 'Hacker News', newsletter: 'Newsletter', ads: 'Ads' };
const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast('Copied'));

export function OutputViewer({ campaign, step, events }: { campaign: Campaign; step: Step; events: CampaignEvent[] }) {
  const prefix = step.kind === 'brief' ? 'brief/' : `deliverables/${step.id}/`;
  const files = step.outputs.map((o) => prefix + o);
  const version = step.endedAt ?? '';
  const url = (f: string) => fileUrl(campaign.id, f) + `?v=${encodeURIComponent(version)}`;

  if (!files.length) {
    const last = [...events].reverse().find((e) => e.step === step.id && (e.type === 'text' || e.type === 'log'));
    return (
      <div className="stage" style={{ minHeight: 320 }}>
        <div style={{ textAlign: 'center', padding: 32, color: '#c9cede', display: 'grid', gap: 8, maxWidth: '46ch' }}>
          <b style={{ fontSize: 17, color: '#fff' }}>{step.status === 'running' ? `${step.phase ?? 'Working'}…` : step.status === 'queued' ? 'Up next' : step.status === 'failed' ? 'Nothing was made' : 'Nothing here yet'}</b>
          {step.status === 'running' && last?.text && <span style={{ fontSize: 13, opacity: 0.75 }}>{last.text.slice(0, 160)}</span>}
        </div>
      </div>
    );
  }

  const media = files.filter((f) => isVideo(f) || isImage(f));
  // Claude's working notes belong in Activity, not in the preview.
  const docs = files.filter((f) => isText(f) && !f.endsWith('.srt') && !f.endsWith('NOTES.md'));
  const copyJson = files.find((f) => f.endsWith('copy.json'));
  const downloads = files.filter((f) => !f.endsWith('.json') && !f.endsWith('.html') && !f.includes('.sheet.'));

  return (
    <>
      {media.length > 0 && <MediaStage files={media} url={url} />}
      {copyJson ? <CopyKit url={url(copyJson)} version={version} /> : docs.length > 0 && <Docs files={docs} url={url} />}
      {downloads.length > 1 && (
        <div className="files">
          {downloads.map((f) => (
            <a key={f} className="file" href={url(f) + '&download'} download>
              {base(f)}
            </a>
          ))}
        </div>
      )}
    </>
  );
}

export function MediaStage({ files, url }: { files: string[]; url: (f: string) => string }) {
  const ordered = useMemo(() => [...files.filter((f) => f.endsWith('.gif')), ...files.filter(isVideo), ...files.filter(isImage).filter((f) => !f.endsWith('.gif')).filter((f) => !/(video|captioned)\.jpg$/.test(f))], [files]);
  const [cur, setCur] = useState(ordered[0]);
  const active = ordered.includes(cur) ? cur : ordered[0];
  return (
    <>
      <div className="stage">
        {isVideo(active) ? <video key={active} src={url(active) + '#t=0.1'} controls playsInline preload="metadata" autoPlay muted /> : <img src={url(active)} alt={base(active)} />}
      </div>
      {ordered.length > 1 && (
        <div className="thumbs" role="list">
          {ordered.map((f) => (
            <button key={f} className="thumb" role="listitem" aria-current={f === active} onClick={() => setCur(f)} title={base(f)}>
              {isImage(f) ? <img src={url(f)} alt="" loading="lazy" /> : <span style={{ padding: '0 12px' }}>▶ Video</span>}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export function Docs({ files, url }: { files: string[]; url: (f: string) => string }) {
  const ordered = [...files].sort((a, b) => Number(a.endsWith('NOTES.md')) - Number(b.endsWith('NOTES.md')));
  const [cur, setCur] = useState(ordered[0]);
  const active = ordered.includes(cur) ? cur : ordered[0];
  const text = useText(url(active), active);
  const label = (f: string) => (f.endsWith('NOTES.md') ? "Claude's notes" : /caption/.test(f) ? 'Post caption' : /share-copy|post/.test(f) ? 'Post text' : base(f));
  return (
    <div className="doc">
      <div className="copy-head" style={{ marginBottom: 12 }}>
        {ordered.length > 1 ? (
          <div className="seg">
            {ordered.map((f) => (
              <button key={f} aria-pressed={f === active} onClick={() => setCur(f)}>{label(f)}</button>
            ))}
          </div>
        ) : (
          <h4>{label(active)}</h4>
        )}
        {text && <button className="btn sm" onClick={() => copy(text)}>Copy</button>}
      </div>
      <pre>{text ?? 'Loading…'}</pre>
    </div>
  );
}

export function CopyKit({ url, version }: { url: string; version: string }) {
  const raw = useText(url, version);
  const data = useMemo(() => {
    try {
      return raw ? (JSON.parse(raw) as Record<string, { label: string; text: string }[]>) : null;
    } catch {
      return null;
    }
  }, [raw]);
  if (!data) return null;
  return (
    <div className="doc">
      {Object.entries(data).map(([channel, items]) => (
        <div key={channel}>
          <h3 className="copy-channel">{CHANNELS[channel.toLowerCase()] ?? channel}</h3>
          {(Array.isArray(items) ? items : []).map((it, i) => (
            <div key={i} className="copy-block">
              <div className="copy-head">
                <h4>{it.label}</h4>
                <button className="btn sm" onClick={() => copy(it.text)}>Copy</button>
              </div>
              <div className="copy-text">{it.text}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
