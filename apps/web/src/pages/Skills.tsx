import { useState } from 'react';
import { api, type HubPackage, type SkillsView } from '../api.ts';
import { toast, useLoad } from '../hooks.ts';

const AREAS: [string, string][] = [
  ['motion', 'Motion & video'],
  ['editing', 'Editing & post'],
  ['design', 'Design & taste'],
  ['diagram', 'Diagrams & data'],
  ['social', 'Social & copy'],
  ['brand', 'Brand & research'],
  ['story', 'Story & scripts'],
  ['audio', 'Voice & audio'],
  ['core', 'Foundations'],
];

const ROLE_LABEL = (r: string) => r.replace(/-/g, ' ');

/**
 * The Skill Hub: the best upstream Claude skills, installed pinned and
 * isolated, mixed per role. Shipcast picks the strongest enabled skill for
 * each role; anything can be overridden here.
 */
export function Skills() {
  const v = useLoad(() => api.skills());
  const [busy, setBusy] = useState<string | null>(null);
  const [data, setData] = useState<SkillsView | null>(null);
  const view = data ?? v.data;

  const act = async (id: string, fn: () => Promise<SkillsView>, msg: string) => {
    setBusy(id);
    try {
      setData(await fn());
      toast(msg);
    } catch (e) {
      toast(String((e as Error).message));
    } finally {
      setBusy(null);
    }
  };

  if (!view) return <main className="page"><p className="muted">Loading…</p></main>;
  const byArea = AREAS.map(([a, label]) => ({ a, label, items: view.packages.filter((p) => p.area === a) })).filter((g) => g.items.length);

  return (
    <main className="page">
      <div className="camp-head">
        <div>
          <h1>Skills</h1>
          <p>The best Claude skills from the community, mixed per job. Installed from their own repos at a pinned version, into Shipcast only — your own Claude setup stays untouched.</p>
        </div>
      </div>


      {byArea.map((g) => (
        <section key={g.a} className="setup-section">
          <h2>{g.label}</h2>
          <div className="skill-grid">
            {g.items.map((p) => <SkillCard key={p.id} p={p} busy={busy === p.id} act={act} />)}
          </div>
        </section>
      ))}
      <details className="setup-section roles-adv">
        <summary>Advanced — choose who plays each role</summary>
        <p className="muted">Shipcast picks the strongest enabled skill for each part of the work. Override it where more than one can do the job.</p>
        <div className="roles-grid">
          {Object.entries(view.roles)
            .filter(([, r]) => r.candidates.length > 1)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([role, r]) => (
              <label key={role} className="field role-pick">
                <span>{ROLE_LABEL(role)}</span>
                <select className="select" value={r.chosen ?? ''} onChange={(e) => act(role, () => api.setSkillRole(role, e.target.value || null), `${ROLE_LABEL(role)}: updated`)}>
                  <option value="">Best available{r.effective && !r.chosen ? ` (${r.effective})` : ''}</option>
                  {r.candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            ))}
        </div>
      </details>
    </main>
  );
}

function SkillCard({ p, busy, act }: { p: HubPackage & { installed: boolean; enabled: boolean; permissive: boolean; accepted: boolean }; busy: boolean; act: (id: string, fn: () => Promise<SkillsView>, msg: string) => void }) {
  const [consent, setConsent] = useState(false);
  return (
    <article className={`skill-card ${p.installed && p.enabled ? 'on' : ''}`}>
      <header>
        <b>{p.name}</b>
        <span className="verdict" title={`${p.verdict}/5 for professional work`}>{'●'.repeat(p.verdict)}{'○'.repeat(5 - p.verdict)}</span>
      </header>
      {p.repo === 'local' ? <span className="repo">Built into Shipcast</span> : <a className="repo" href={`https://github.com/${p.repo}`} target="_blank" rel="noreferrer">{p.repo}{p.stars ? ` · ★ ${p.stars >= 1000 ? `${Math.round(p.stars / 100) / 10}k` : p.stars}` : ''}</a>}
      <p>{p.summary}</p>
      <div className="tags">
        <span className={`lic ${p.permissive ? 'ok' : 'warn'}`}>{p.licence === 'none' ? 'No licence' : p.licence}</span>
        {Object.keys(p.roles).slice(0, 5).map((r) => <span key={r} className="tag">{ROLE_LABEL(r)}</span>)}
        {(p.needs ?? []).map((n) => <span key={n} className="tag need">needs {n}</span>)}
      </div>
      <footer>
        <span className="muted">{p.paths.length} skill{p.paths.length > 1 ? 's' : ''}</span>
        {!p.installed ? (
          <>
            {!p.permissive && !p.accepted && (
              <label className="consent">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> I accept its licence
              </label>
            )}
            <button className="btn sm primary" disabled={busy || (!p.permissive && !p.accepted && !consent)} onClick={() => act(p.id, () => api.installSkill(p.id, consent), `${p.name} installed`)}>
              {busy ? 'Installing…' : 'Install'}
            </button>
          </>
        ) : (
          <label className="switch">
            <input type="checkbox" checked={p.enabled} disabled={busy} onChange={(e) => act(p.id, () => api.setSkill(p.id, e.target.checked), e.target.checked ? `${p.name} on` : `${p.name} off`)} />
            {p.enabled ? 'On' : 'Off'}
          </label>
        )}
      </footer>
    </article>
  );
}
