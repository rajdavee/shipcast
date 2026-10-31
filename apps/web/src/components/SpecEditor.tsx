import { useEffect, useMemo, useState } from 'react';
import { api, fileUrl, type Campaign, type Step } from '../api.ts';
import { toast } from '../hooks.ts';

type FieldDoc = { id: string; type: string; label: string; optional?: boolean; max?: number; help?: string; choices?: string[] };
type LayoutDoc = { id: string; label: string; use: string; fields: FieldDoc[]; minSeconds?: number };

const asText = (v: unknown) => (Array.isArray(v) ? v.join('\n') : v === undefined || v === null ? '' : String(v));

function FieldInput({ f, value, onChange, images }: { f: FieldDoc; value: unknown; onChange: (v: unknown) => void; images: string[] }) {
  const text = asText(value);
  const over = f.max && f.type !== 'list' && text.replace(/[*=]/g, '').length > f.max;
  const label = (
    <span>
      {f.label}
      {f.optional ? <span className="hint"> · optional</span> : null}
      {f.max && f.type !== 'list' ? <span className={`hint tnum${over ? ' error-text' : ''}`} style={{ float: 'right' }}>{text.replace(/[*=]/g, '').length}/{f.max}</span> : null}
    </span>
  );
  if (f.type === 'image') {
    return (
      <label className="field">
        {label}
        <select className="select" value={text} onChange={(e) => onChange(e.target.value)}>
          <option value="">— none —</option>
          {[...new Set([text, ...images].filter(Boolean))].map((i) => (
            <option key={i} value={i}>{i.split('/').pop()}</option>
          ))}
        </select>
      </label>
    );
  }
  if (f.type === 'enum' && f.choices) {
    return (
      <label className="field">
        {label}
        <select className="select" value={text} onChange={(e) => onChange(e.target.value)}>
          {f.choices.map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
    );
  }
  const multi = f.type === 'list' || f.type === 'longtext';
  return (
    <label className="field">
      {label}
      {multi ? (
        <textarea className="textarea" rows={f.type === 'list' ? 4 : 3} value={text} onChange={(e) => onChange(f.type === 'list' ? e.target.value.split('\n') : e.target.value)} />
      ) : (
        <input className="input" type={f.type === 'number' ? 'number' : 'text'} step="0.05" value={text} onChange={(e) => onChange(f.type === 'number' ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value)} />
      )}
      {f.help && <span className="hint">{f.help}{f.type === 'list' ? ' One per line.' : ''}</span>}
    </label>
  );
}

interface Props {
  campaign: Campaign;
  step: Step;
  kind: 'deck' | 'graphics' | 'storyboard';
  images: string[];
  onSaved: (c: Campaign) => void;
}

/** Edits the JSON spec a studio format rendered from, then re-renders without Claude. */
export function SpecEditor({ campaign, step, kind, images, onSaved }: Props) {
  const [catalog, setCatalog] = useState<any>(null);
  const [spec, setSpec] = useState<any>(null);
  const [orig, setOrig] = useState('');
  const [sel, setSel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ frames: string[]; duration: number; at: string } | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    setSpec(null);
    setError(null);
    Promise.all([api.catalog(kind), api.getSpec(campaign.id, step.id)])
      .then(([c, s]) => {
        setCatalog(c);
        setSpec(s.spec);
        setOrig(JSON.stringify(s.spec));
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, [campaign.id, step.id, step.endedAt, kind]);

  const listKey = kind === 'deck' ? 'slides' : kind === 'graphics' ? 'items' : 'scenes';
  const layoutsFor = useMemo(() => {
    if (!catalog) return () => [] as LayoutDoc[];
    return (item: any): LayoutDoc[] =>
      kind === 'deck' ? catalog.carousel.layouts : kind === 'graphics' ? (item?.type === 'thumbnail' ? catalog.thumbnail.layouts : catalog.card.layouts) : catalog.scenes;
  }, [catalog, kind]);

  if (error) return <div className="banner">{error}</div>;
  if (!spec || !catalog) return <p className="hint">Loading editor…</p>;

  const items: any[] = spec[listKey] ?? [];
  const cur = items[sel];
  const layoutKey = kind === 'storyboard' ? 'scene' : 'layout';
  const layouts = layoutsFor(cur);
  const layout = layouts.find((l) => l.id === cur?.[layoutKey]);
  const dirty = JSON.stringify(spec) !== orig;

  const update = (fn: (draft: any) => void) => {
    const next = structuredClone(spec);
    fn(next);
    setSpec(next);
  };
  const setItem = (patch: Record<string, unknown>) => update((d) => Object.assign(d[listKey][sel], patch));
  const setField = (id: string, v: unknown) => update((d) => ((d[listKey][sel].fields ??= {})[id] = v));
  const move = (dir: -1 | 1) => {
    const j = sel + dir;
    if (j < 0 || j >= items.length) return;
    update((d) => ([d[listKey][sel], d[listKey][j]] = [d[listKey][j], d[listKey][sel]]));
    setSel(j);
  };

  const thumbFor = (i: number) => {
    if (kind === 'deck') return step.outputs.find((o) => o.endsWith(`slide-${String(i + 1).padStart(2, '0')}.png`));
    if (kind === 'graphics') return step.outputs.find((o) => o.endsWith(`/${items[i]?.name}`) || o.endsWith(`/${items[i]?.name}.png`));
    return undefined;
  };

  async function runPreview() {
    setPreviewing(true);
    try {
      const r = await api.preview(campaign.id, step.id, spec);
      setPreview({ frames: r.frames, duration: r.duration, at: String(Date.now()) });
    } catch (e) {
      toast(String((e as Error).message).slice(0, 160));
    } finally {
      setPreviewing(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      onSaved(await api.saveSpec(campaign.id, step.id, spec));
      setOrig(JSON.stringify(spec));
      toast('Saved — re-rendering');
    } catch (e) {
      toast(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="editor">
      <div className="editor-global">
        {kind === 'deck' && (
          <>
            <label className="field"><span>Theme</span>
              <select className="select" value={spec.theme} onChange={(e) => update((d) => (d.theme = e.target.value))}>
                {Object.entries(catalog.carousel.themes).map(([k, v]) => <option key={k} value={k}>{String(v).split(' — ')[0]}</option>)}
              </select>
            </label>
            <label className="field"><span>Animated MP4</span>
              <select className="select" value={spec.motion ? String(spec.motion) : ''} onChange={(e) => update((d) => (d.motion = e.target.value || undefined))}>
                <option value="">Off — slides and PDF only</option>
                {['chill', 'uplifting', 'tech', 'energetic', 'cinematic', 'playful'].map((m) => <option key={m} value={m}>On · {m} music</option>)}
              </select>
            </label>
            <label className="field"><span>Handle on every slide</span>
              <input className="input" value={spec.handle ?? ''} onChange={(e) => update((d) => (d.handle = e.target.value))} placeholder="@you" />
            </label>
          </>
        )}
        {kind === 'storyboard' && (
          <>
            <label className="field"><span>Format</span>
              <select className="select" value={spec.preset} onChange={(e) => update((d) => (d.preset = e.target.value))}>
                {catalog.presets.map((p: any) => <option key={p.id} value={p.id}>{p.label} · {p.width}×{p.height}</option>)}
              </select>
            </label>
            <label className="field"><span>Voice</span>
              <select className="select" value={spec.voice?.voice ?? ''} onChange={(e) => update((d) => (d.voice = e.target.value ? { voice: e.target.value, speed: d.voice?.speed ?? 1 } : null))}>
                <option value="">No voiceover</option>
                {['am_michael', 'af_heart', 'af_nova', 'af_sky', 'am_adam', 'bf_emma', 'bf_isabella', 'bm_george'].map((v) => <option key={v}>{v}</option>)}
              </select>
            </label>
            <label className="field"><span>Music</span>
              <select className="select" value={spec.music === null ? 'none' : spec.music?.file ? 'file' : (spec.music?.mood ?? 'uplifting')} onChange={(e) => update((d) => (d.music = e.target.value === 'none' ? null : e.target.value === 'file' ? d.music : { mood: e.target.value }))}>
                {['uplifting', 'tech', 'chill', 'energetic', 'cinematic', 'playful'].map((m) => <option key={m} value={m}>{m[0].toUpperCase() + m.slice(1)} (original score)</option>)}
                {spec.music?.file && <option value="file">Your track</option>}
                <option value="none">No music</option>
              </select>
            </label>
            <label className="field"><span>Captions</span>
              <select className="select" value={spec.captions ?? 'none'} onChange={(e) => update((d) => (d.captions = e.target.value))}>
                {Object.entries(catalog.captions).map(([k, v]) => <option key={k} value={k}>{String(v).split(' — ')[0]}</option>)}
              </select>
            </label>
          </>
        )}
      </div>

      <div className="editor-body">
        <ol className="editor-list">
          {items.map((it, i) => {
            const thumb = thumbFor(i);
            const l = layoutsFor(it).find((x) => x.id === it[layoutKey]);
            return (
              <li key={i}>
                <button className="editor-item" aria-current={i === sel} onClick={() => setSel(i)}>
                  {thumb ? <img src={fileUrl(campaign.id, `deliverables/${step.id}/${thumb}`) + `?v=${step.endedAt}`} alt="" /> : <span className="editor-num tnum">{i + 1}</span>}
                  <span>
                    <b>{l?.label ?? it[layoutKey] ?? it.block}</b>
                    <small>{asText(it.fields?.title ?? it.fields?.headline ?? it.fields?.text ?? it.fields?.quote ?? it.vo ?? it.name).slice(0, 60)}</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        {cur && (
          <div className="editor-form">
            <div className="editor-row">
              <label className="field" style={{ flex: 1 }}>
                <span>{kind === 'storyboard' ? 'Scene' : 'Layout'}</span>
                <select className="select" value={cur[layoutKey] ?? ''} onChange={(e) => setItem({ [layoutKey]: e.target.value })}>
                  {layouts.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
              </label>
              {kind === 'graphics' && (
                <label className="field"><span>Type</span>
                  <select className="select" value={cur.type} onChange={(e) => setItem({ type: e.target.value, layout: (e.target.value === 'thumbnail' ? catalog.thumbnail : catalog.card).layouts[0].id })}>
                    <option value="thumbnail">Thumbnail</option><option value="card">Card</option>
                  </select>
                </label>
              )}
            </div>
            {layout && <p className="hint">{layout.use}</p>}
            {layout?.fields.map((f) => <FieldInput key={f.id} f={f} value={cur.fields?.[f.id]} onChange={(v) => setField(f.id, v)} images={images} />)}
            {kind === 'storyboard' && (
              <>
                <label className="field"><span>Voice line</span>
                  <textarea className="textarea" rows={2} value={cur.vo ?? ''} onChange={(e) => setItem({ vo: e.target.value })} placeholder="What the narrator says over this scene" />
                </label>
                <div className="editor-row">
                  <label className="field"><span>Enters with</span>
                    <select className="select" value={cur.transition ?? 'wipe'} onChange={(e) => setItem({ transition: e.target.value })}>
                      {['cut', 'flash', 'wipe', 'fade', 'zoom'].map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </label>
                  <label className="field"><span>Hold at least (s)</span>
                    <input className="input" type="number" step="0.5" min={layout?.minSeconds ?? 1} value={cur.duration ?? ''} placeholder="auto" onChange={(e) => setItem({ duration: e.target.value ? Number(e.target.value) : undefined })} />
                  </label>
                </div>
              </>
            )}
            <div className="sheet-actions">
              <button className="btn sm" onClick={() => move(-1)} disabled={sel === 0}>Move up</button>
              <button className="btn sm" onClick={() => move(1)} disabled={sel === items.length - 1}>Move down</button>
              <button className="btn sm" onClick={() => { update((d) => d[listKey].splice(sel + 1, 0, structuredClone(cur))); setSel(sel + 1); }}>Duplicate</button>
              <button className="btn sm danger" disabled={items.length <= 1} onClick={() => { update((d) => d[listKey].splice(sel, 1)); setSel(Math.max(0, sel - 1)); }}>Delete</button>
            </div>
          </div>
        )}
      </div>

      {preview && (
        <div className="doc" style={{ padding: 14 }}>
          <div className="copy-head" style={{ marginBottom: 10 }}>
            <span className="hint">Preview · one frame per scene · {preview.duration.toFixed(1)} s total</span>
            <button className="btn sm ghost" onClick={() => setPreview(null)}>Close</button>
          </div>
          <div className="thumbs">
            {preview.frames.map((f, i) => (
              <button key={f} className="thumb" style={{ height: 180 }} onClick={() => setSel(i)} title={`Scene ${i + 1}`}>
                <img src={fileUrl(campaign.id, f) + `?v=${preview.at}`} alt={`Scene ${i + 1}`} style={{ height: 180 }} />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="editor-bar">
        <span className="hint">{dirty ? 'Unsaved changes' : 'Edit any field, then re-render — no Claude run needed.'}</span>
        <div className="sheet-actions" style={{ marginTop: 0 }}>
          {dirty && <button className="btn sm ghost" onClick={() => setSpec(JSON.parse(orig))}>Discard</button>}
          {kind === 'storyboard' && <button className="btn sm" disabled={previewing} onClick={runPreview}>{previewing ? 'Previewing…' : 'Preview frames'}</button>}
          <button className="btn primary" disabled={!dirty || busy || step.status === 'running'} onClick={save}>{busy ? 'Saving…' : 'Save & re-render'}</button>
        </div>
      </div>
    </div>
  );
}
