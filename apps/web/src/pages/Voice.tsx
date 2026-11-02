import { useEffect, useState } from 'react';
import { api, type BrandScore, type ToneProfile, type ToneSliders } from '../api.ts';
import { toast, useLoad } from '../hooks.ts';

const SLIDERS: { key: keyof ToneSliders; lo: string; hi: string }[] = [
  { key: 'formalCasual', lo: 'Formal', hi: 'Casual' },
  { key: 'seriousPlayful', lo: 'Serious', hi: 'Playful' },
  { key: 'reservedBold', lo: 'Reserved', hi: 'Bold' },
  { key: 'technicalSimple', lo: 'Technical', hi: 'Simple' },
  { key: 'humor', lo: 'No humour', hi: 'Lots of humour' },
];
const CHANNELS = ['linkedin', 'x', 'instagram', 'tiktok', 'youtube', 'facebook', 'email', 'web', 'ads', 'print', 'deck'];
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

/** Tone & Voice: how each brand sounds, applied to every material Shipcast writes. */
export function Voice() {
  const tones = useLoad(() => api.tones());
  const [sel, setSel] = useState('default');
  const [draft, setDraft] = useState<ToneProfile | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [samples, setSamples] = useState('');
  const current = tones.data?.find((t) => t.id === sel) ?? tones.data?.[0];
  useEffect(() => setDraft(current ? structuredClone(current) : null), [current?.id, current?.updatedAt]);
  if (!tones.data || !draft) return <main className="page narrow"><p className="muted">Loading…</p></main>;
  const set = (patch: Partial<ToneProfile>) => setDraft({ ...draft, ...patch });

  async function save() {
    setBusy('save');
    try {
      const t = await api.saveTone(draft!);
      await tones.reload();
      setSel(t.id);
      toast(`Saved “${t.name}”`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function learn(asNew: boolean) {
    setBusy('learn');
    try {
      const t = await api.learnTone({ samples: samples.split(/\n{2,}|\n(?=https?:)/).map((x) => x.trim()).filter(Boolean), id: asNew ? undefined : draft!.id === 'default' ? undefined : draft!.id, name: asNew ? undefined : draft!.name });
      await tones.reload();
      setSel(t.id);
      setSamples('');
      toast(`Learned “${t.name}”`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="page narrow voice-page">
      <div className="camp-head">
        <div>
          <h1>Brand voice</h1>
          <p>How your brand sounds. Every post, deck, PDF, ad, email and script follows the voice you pick, and each one is scored against it.</p>
        </div>
      </div>

      <section className="setup-section">
        <div className="seg" role="group" aria-label="Voices">
          {tones.data.map((t) => (
            <button key={t.id} aria-pressed={t.id === draft.id} onClick={() => setSel(t.id)}>{t.name}</button>
          ))}
          <button onClick={() => { setSel('default'); setDraft({ ...structuredClone(tones.data!.find((t) => t.id === 'default')!), id: '', name: 'New voice', samples: [] }); }}>+ New voice</button>
        </div>
      </section>

      <section className="setup-section">
        <h2>Learn it from your copy</h2>
        <p>Paste a few paragraphs you’re proud of, or links to your site, blog or a great post. Shipcast listens for the voice and fills in everything below.</p>
        <textarea className="textarea" rows={4} value={samples} onChange={(e) => setSamples(e.target.value)} placeholder={'https://yourproduct.com\n\nOr paste copy here — separate samples with a blank line.'} aria-label="Sample copy or links" />
        <div className="row-actions" style={{ marginTop: 10 }}>
          <button className="btn primary" disabled={!samples.trim() || !!busy} onClick={() => learn(true)}>{busy === 'learn' ? 'Listening…' : 'Learn a new voice'}</button>
          {draft.id && draft.id !== 'default' && <button className="btn" disabled={!samples.trim() || !!busy} onClick={() => learn(false)}>Update “{draft.name}”</button>}
        </div>
      </section>

      <section className="setup-section">
        <h2>The voice</h2>
        <div className="voice-grid">
          <label className="field"><span>Name</span><input className="input" value={draft.name} onChange={(e) => set({ name: e.target.value })} /></label>
          <label className="field"><span>Personality (up to 5 words)</span><input className="input" value={draft.personality.join(', ')} onChange={(e) => set({ personality: e.target.value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 5) })} /></label>
          <label className="field wide"><span>In a sentence or two</span><textarea className="textarea" rows={2} value={draft.description} onChange={(e) => set({ description: e.target.value })} /></label>
        </div>
        <div className="sliders">
          {SLIDERS.map((s) => (
            <label key={s.key} className="slider">
              <span>{s.lo}</span>
              <input type="range" min={0} max={100} value={draft.sliders[s.key]} onChange={(e) => set({ sliders: { ...draft.sliders, [s.key]: Number(e.target.value) } })} aria-label={`${s.lo} to ${s.hi}`} />
              <span>{s.hi}</span>
            </label>
          ))}
        </div>
        <div className="voice-grid">
          <label className="field"><span>Reading level</span>
            <select className="select" value={draft.readingLevel} onChange={(e) => set({ readingLevel: e.target.value as ToneProfile['readingLevel'] })}>
              <option value="grade6">Easy (grade 6)</option><option value="grade8">Plain (grade 8)</option><option value="grade10">Considered (grade 10)</option><option value="expert">Expert</option>
            </select>
          </label>
          <label className="field"><span>Speaks as</span>
            <select className="select" value={draft.person} onChange={(e) => set({ person: e.target.value as ToneProfile['person'] })}>
              <option value="we">“We”</option><option value="I">“I” (founder)</option><option value="you">“You” (to the reader)</option>
            </select>
          </label>
          <label className="field"><span>Emoji</span>
            <select className="select" value={draft.emoji} onChange={(e) => set({ emoji: e.target.value as ToneProfile['emoji'] })}>
              <option value="none">None</option><option value="sparing">Sparing</option><option value="native">Native to the platform</option>
            </select>
          </label>
          <label className="field"><span>Call to action</span>
            <select className="select" value={draft.cta} onChange={(e) => set({ cta: e.target.value as ToneProfile['cta'] })}>
              <option value="soft">Soft</option><option value="direct">Direct</option><option value="urgent">Urgent (real deadlines only)</option>
            </select>
          </label>
          <label className="field"><span>Hashtags (max)</span><input className="input" type="number" min={0} max={30} value={draft.hashtags.max} onChange={(e) => set({ hashtags: { ...draft.hashtags, max: Number(e.target.value) } })} /></label>
          <label className="field"><span>Locale</span><input className="input" value={draft.locale} onChange={(e) => set({ locale: e.target.value })} placeholder="en-US" /></label>
          <label className="field wide"><span>Audience</span><input className="input" value={draft.audience.role} onChange={(e) => set({ audience: { ...draft.audience, role: e.target.value } })} placeholder="e.g. trust officers at family offices" /></label>
          <label className="field"><span>Do (one per line)</span><textarea className="textarea" rows={4} value={draft.do.join('\n')} onChange={(e) => set({ do: lines(e.target.value) })} /></label>
          <label className="field"><span>Don’t (one per line)</span><textarea className="textarea" rows={4} value={draft.dont.join('\n')} onChange={(e) => set({ dont: lines(e.target.value) })} /></label>
          <label className="field"><span>Never say (one per line)</span><textarea className="textarea" rows={4} value={draft.lexicon.banned.join('\n')} onChange={(e) => set({ lexicon: { ...draft.lexicon, banned: lines(e.target.value) } })} /></label>
          <label className="field"><span>Say this, not that (“client → partner”)</span><textarea className="textarea" rows={4} value={Object.entries(draft.lexicon.preferred).map(([a, b]) => `${a} → ${b}`).join('\n')} onChange={(e) => set({ lexicon: { ...draft.lexicon, preferred: Object.fromEntries(lines(e.target.value).map((l) => l.split(/\s*(?:→|->)\s*/)).filter((x) => x.length === 2 && x[0] && x[1])) } })} /></label>
          <label className="field"><span>Approved stats (claims you can back)</span><textarea className="textarea" rows={3} value={draft.claims.allowedStats.join('\n')} onChange={(e) => set({ claims: { ...draft.claims, allowedStats: lines(e.target.value) } })} /></label>
          <label className="field"><span>Never claim</span><textarea className="textarea" rows={3} value={draft.claims.forbidden.join('\n')} onChange={(e) => set({ claims: { ...draft.claims, forbidden: lines(e.target.value) } })} /></label>
        </div>
        <label className="check" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={draft.claims.requireSource} onChange={(e) => set({ claims: { ...draft.claims, requireSource: e.target.checked } })} /> Every number needs a source
        </label>
        <label className="check">
          <input type="checkbox" checked={draft.aiDisclosure} onChange={(e) => set({ aiDisclosure: e.target.checked })} /> Label AI-generated people and voices
        </label>
        <div className="row-actions" style={{ marginTop: 16 }}>
          <button className="btn primary" disabled={!!busy || !draft.name.trim()} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save voice'}</button>
          {draft.id && draft.id !== 'default' && (
            <button className="btn ghost danger" onClick={async () => { await api.deleteTone(draft.id); await tones.reload(); setSel('default'); toast('Voice deleted'); }}>Delete</button>
          )}
        </div>
      </section>

      <TryIt toneId={draft.id || 'default'} />
    </main>
  );
}

/** Paste any copy: score it against the voice, then fix it. */
function TryIt({ toneId }: { toneId: string }) {
  const [text, setText] = useState('');
  const [channel, setChannel] = useState('linkedin');
  const [score, setScore] = useState<BrandScore | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!text.trim()) return setScore(null);
    const t = setTimeout(() => void api.scoreCopy({ text, toneId, channel }).then(setScore).catch(() => {}), 350);
    return () => clearTimeout(t);
  }, [text, toneId, channel]);
  return (
    <section className="setup-section">
      <h2>Check any copy</h2>
      <p>Paste a post, an email or a headline. You get a brand score and can rewrite it in this voice.</p>
      <div className="seg" role="group" aria-label="Channel" style={{ marginBottom: 10 }}>
        {CHANNELS.map((c) => <button key={c} aria-pressed={c === channel} onClick={() => setChannel(c)}>{c}</button>)}
      </div>
      <textarea className="textarea" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste copy to check…" aria-label="Copy to check" />
      {score && (
        <div className="score-box">
          <div className={`score ${score.score >= 85 ? 'ok' : score.score >= 60 ? 'mid' : 'bad'}`}><b>{score.score}</b><span>brand score</span></div>
          <ul>
            {score.issues.length ? score.issues.map((i, n) => <li key={n} className={i.severity}>{i.detail}</li>) : <li className="ok">On voice. Reading grade {score.stats.grade}.</li>}
          </ul>
          <button className="btn" disabled={busy} onClick={async () => { setBusy(true); try { const r = await api.rewriteCopy({ text, toneId, channel }); setText(r.text); toast(`Rewritten — ${r.score.score}%`); } catch (e) { toast((e as Error).message); } finally { setBusy(false); } }}>{busy ? 'Rewriting…' : 'Fix it'}</button>
        </div>
      )}
    </section>
  );
}
