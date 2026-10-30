import { useState } from 'react';
import { api } from '../api.ts';
import { toast, useLoad } from '../hooks.ts';
import { PackFrame } from '../components/PackFrame.tsx';

export function Packs() {
  const packs = useLoad(() => api.packs());
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <div style={{ maxWidth: 960 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">Formats</h1>
          <p className="lede">
            Each format is a folder in <code>packs/</code>: a manifest and a prompt. Some build on open-source skills that Shipcast installs from their own repositories the first time you use them.
          </p>
        </div>
      </div>
      <div className="pack-rows">
        {packs.data?.map((p) => {
          const missing = p.skills.filter((s) => !s.installed);
          return (
            <div key={p.id} className="pack-row">
              <PackFrame pack={p} height={52} />
              <div>
                <h3>{p.name}</h3>
                <p>{p.tagline}</p>
                <div className="skill-list">
                  {p.skills.length ? `Skill: ${p.skills.map((s) => `${s.name} (${s.source})`).join(', ')}` : 'Built into Shipcast'}
                  {p.tools.length ? ` · needs ${p.tools.join(', ')}` : ''}
                </div>
              </div>
              {missing.length ? (
                <button
                  className="btn small"
                  disabled={busy === p.id}
                  onClick={async () => {
                    setBusy(p.id);
                    try {
                      const r = await api.installPack(p.id);
                      toast(r.results.every((x) => x.ok) ? `${p.name} is ready` : 'Install failed — see the terminal running Shipcast');
                      packs.reload();
                    } catch (e) {
                      toast(String((e as Error).message));
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {busy === p.id ? 'Installing…' : 'Install skill'}
                </button>
              ) : (
                <span className="hint">Ready</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
