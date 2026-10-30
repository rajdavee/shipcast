import { useEffect, useMemo, useState } from 'react';
import { fileUrl, type Campaign, type CampaignEvent, type Step } from '../api.ts';
import { toast } from '../hooks.ts';

const ext = (f: string) => f.split('.').pop()!.toLowerCase();
const isVideo = (f: string) => ['mp4', 'webm', 'mov'].includes(ext(f));
const isImage = (f: string) => ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext(f));
const isText = (f: string) => ['md', 'txt', 'srt', 'vtt'].includes(ext(f));
const base = (f: string) => f.split('/').pop()!;

function useText(url: string | null, version: string) {
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

export function OutputViewer({ campaign, step, events }: { campaign: Campaign; step: Step; events: CampaignEvent[] }) {
  const prefix = step.kind === 'brief' ? 'brief/' : `deliverables/${step.id}/`;
  const files = step.outputs.map((o) => prefix + o);
  const version = step.endedAt ?? '';
  const url = (f: string) => fileUrl(campaign.id, f) + `?v=${encodeURIComponent(version)}`;

  if (step.kind === 'brief') return <BriefView campaign={campaign} step={step} events={events} url={url} files={files} />;

  const media = files.filter((f) => isVideo(f) || isImage(f));
  const docs = files.filter((f) => isText(f) && !f.endsWith('.srt') && !f.endsWith('.vtt'));
  const copyJson = files.find((f) => f.endsWith('copy.json'));
  const others = files.filter((f) => !media.includes(f) && !docs.includes(f) && f !== copyJson);

  if (!files.length) return <Waiting step={step} events={events} />;

  return (
    <>
      {media.length > 0 && <MediaStage files={media} url={url} />}
      {copyJson && <CopyKit url={url(copyJson)} version={version} />}
      {!copyJson && docs.length > 0 && <Docs files={docs} url={url} />}
      <div className="files">
        {files.map((f) => (
          <a key={f} className="file-chip" href={url(f) + '&download'} download>
            {base(f)}
          </a>
        ))}
        {others.some((f) => f.endsWith('.pdf')) && (
          <a className="file-chip" href={url(others.find((f) => f.endsWith('.pdf'))!)} target="_blank" rel="noreferrer">
            Preview PDF
          </a>
        )}
      </div>
      {copyJson && docs.some((f) => f.endsWith('NOTES.md')) && <Docs files={docs.filter((f) => f.endsWith('NOTES.md'))} url={url} />}
    </>
  );
}

function Waiting({ step, events }: { step: Step; events: CampaignEvent[] }) {
  const last = [...events].reverse().find((e) => e.step === step.id && (e.type === 'tool' || e.type === 'text' || e.type === 'log'));
  const msg =
    step.status === 'running'
      ? 'Claude is on it'
      : step.status === 'queued'
        ? 'In the queue'
        : step.status === 'blocked'
          ? 'Waiting for the brief'
          : step.status === 'failed'
            ? 'No files came out of this run'
            : 'Nothing here yet';
  return (
    <div className="monitor">
      <div className="monitor-empty">
        {step.status === 'running' && <i className="lamp live" />}
        <h3>{msg}</h3>
        <p>{step.status === 'running' && last?.text ? last.text.slice(0, 160) : step.status === 'queued' ? 'Steps run one at a time so renders get the whole machine.' : ''}</p>
      </div>
    </div>
  );
}

function MediaStage({ files, url }: { files: string[]; url: (f: string) => string }) {
  // Lead with the video (not the poster), then images in order.
  const ordered = useMemo(() => [...files.filter(isVideo), ...files.filter(isImage)], [files]);
  const [cur, setCur] = useState(ordered[0]);
  const active = ordered.includes(cur) ? cur : ordered[0];
  return (
    <>
      <div className="monitor">
        {isVideo(active) ? <video key={active} src={url(active) + '#t=0.1'} controls playsInline preload="metadata" /> : <img src={url(active)} alt={base(active)} />}
      </div>
      {ordered.length > 1 && (
        <div className="thumbs" role="list">
          {ordered.map((f) => (
            <button key={f} className="thumb" role="listitem" aria-current={f === active} onClick={() => setCur(f)} title={base(f)}>
              {isImage(f) ? <img src={url(f)} alt="" loading="lazy" /> : <span>▶ {base(f)}</span>}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function Docs({ files, url }: { files: string[]; url: (f: string) => string }) {
  // Show the user-facing text first; NOTES.md last.
  const ordered = [...files].sort((a, b) => Number(a.endsWith('NOTES.md')) - Number(b.endsWith('NOTES.md')));
  const [cur, setCur] = useState(ordered[0]);
  const active = ordered.includes(cur) ? cur : ordered[0];
  const text = useText(url(active), active);
  return (
    <div className="doc">
      {ordered.length > 1 && (
        <div className="seg" style={{ marginBottom: 14 }}>
          {ordered.map((f) => (
            <button key={f} aria-pressed={f === active} onClick={() => setCur(f)}>
              {base(f)}
            </button>
          ))}
        </div>
      )}
      <div className="copy-head" style={{ marginBottom: 8 }}>
        <span className="hint">{base(active)}</span>
        {text && (
          <button className="btn small" onClick={() => navigator.clipboard.writeText(text).then(() => toast('Copied'))}>
            Copy
          </button>
        )}
      </div>
      <pre>{text ?? 'Loading…'}</pre>
    </div>
  );
}

function CopyKit({ url, version }: { url: string; version: string }) {
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
          <h3 className="copy-channel">{channel}</h3>
          {(Array.isArray(items) ? items : []).map((it, i) => (
            <div key={i} className="copy-block">
              <div className="copy-head">
                <h4>{it.label}</h4>
                <button className="btn small" onClick={() => navigator.clipboard.writeText(it.text).then(() => toast('Copied'))}>
                  Copy
                </button>
              </div>
              <div className="copy-text">{it.text}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

interface Brand {
  name?: string;
  oneLiner?: string;
  colors?: Record<string, string>;
  fonts?: Record<string, string>;
  logo?: string;
  hooks?: string[];
}

function BriefView({ campaign, step, events, url, files }: { campaign: Campaign; step: Step; events: CampaignEvent[]; url: (f: string) => string; files: string[] }) {
  const has = (f: string) => files.includes('brief/' + f);
  const md = useText(has('brief.md') ? url('brief/brief.md') : null, step.endedAt ?? '');
  const brandRaw = useText(has('brand.json') ? url('brief/brand.json') : null, step.endedAt ?? '');
  const brand = useMemo<Brand | null>(() => {
    try {
      return brandRaw ? JSON.parse(brandRaw) : null;
    } catch {
      return null;
    }
  }, [brandRaw]);
  if (!md) return <Waiting step={step} events={events} />;
  const shots = files.filter((f) => f.startsWith('brief/assets/') && isImage(f));
  const colors = Object.entries(brand?.colors ?? {}).filter(([, v]) => /^#[0-9a-f]{3,8}$/i.test(v));
  return (
    <>
      {brand && (
        <div className="inspect-card">
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            {brand.logo && has(brand.logo) && <img src={url('brief/' + brand.logo)} alt="" style={{ height: 40, maxWidth: 160, objectFit: 'contain' }} />}
            <div>
              <h3 style={{ fontSize: 18 }}>{brand.name ?? campaign.name}</h3>
              {brand.oneLiner && <p className="hint">{brand.oneLiner}</p>}
            </div>
          </div>
          {colors.length > 0 && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {colors.map(([k, v]) => (
                <div key={k} style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                  <span style={{ width: 64, height: 40, borderRadius: 6, background: v, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.12)' }} />
                  <span>{k}</span>
                  <span className="hint tnum">{v}</span>
                </div>
              ))}
            </div>
          )}
          {brand.fonts && (
            <p className="hint">
              Type: {Object.entries(brand.fonts).filter(([, v]) => v).map(([k, v]) => `${v} (${k})`).join(', ')}
            </p>
          )}
        </div>
      )}
      {shots.length > 0 && <MediaStage files={shots} url={url} />}
      <div className="doc">
        <pre>{md}</pre>
      </div>
    </>
  );
}
